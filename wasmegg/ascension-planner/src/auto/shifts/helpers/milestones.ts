import type { Action } from '@/types/actions/meta';
import { createSimAction } from '@/types/actions/meta';
import type { NotificationPayload } from '@/types';
import type { EngineState, SimulationContext, ShiftResult } from '../../types';
import { getResearchById, isTierUnlocked, type ResearchCostModifiers } from '../../../calculations/commonResearch';
import { findSmartBuyCandidate } from '../../../calculations/smartBuyCandidate';
import {
  computeTierMilestoneChain,
  computeResearchMilestoneChain,
  computeMilestoneBaseline,
  computeMilestoneSummaryCore,
  isCheapestTierPurchaseAffordable,
  type MilestoneChainItem,
} from '../../../calculations/milestoneChain';
import { getSaleAwareTimeToSave, shouldDeferToNextSale } from '../../../calculations/researchROI';
import { calculateArtifactModifiers } from '../../../lib/artifacts';
import { computeSnapshot } from '../../../engine/compute';
import { applyAction, boostTransitionsFrom } from '../../../engine/apply';
import { advanceTimeWithBoundaries } from './advanceTime';
import { isResearchSaleActive, getNextSaleStart, getNextSaleEnd } from '@/lib/events';
import { buildQuickBuyNotePayload, buildMilestoneNotePayload } from '@/lib/actions/notes';
import { runWithEarningsEventDeferral } from './earningsEventDeferral';

/**
 * Shared mutable-simulation plumbing for the milestone/smart-buy helpers below.
 *
 * `advanceTime` uses the same boundary-aware stepping as `c1.ts`/`c3.ts` (see AGENT.md's
 * "advanceTime must manually credit bankValue" gotcha) rather than the simplified flat wait
 * every other shift file uses: milestone chains (especially tier-unlock chains early in an
 * ascension, when earnings are low) can plausibly take long enough to cross a weekly sale or
 * earnings-boost boundary, so skipping boundary detection here would silently mis-price
 * purchases made after a boundary is crossed mid-wait.
 */
export function createMilestoneShiftHelpers(
  startState: EngineState,
  context: SimulationContext,
  // Forwarded to `shouldDeferToNextSale`'s own `roiDeadline` (via `buyResearch`'s `checkRoiGate`
  // re-check) — see `computeResearchMilestoneChain`'s identical parameter for the full explanation.
  // Omitted for every caller except C3's step 2 (Tier 13/Multiversal Layering), which already knows
  // how many sales it's riding out and wants execution-time re-checks to stay consistent with what
  // planning (`computeTierMilestoneChain`/`computeResearchMilestoneChain`) already decided was fine.
  roiDeadlineOverride?: number
) {
  let currentState: EngineState = { ...startState };
  let elapsedSeconds = 0;
  const actions: Action[] = [];

  const baseAbsTime = context.ascensionStartTime + ((startState.lastStepTime || 0) - context.planStartOffset);
  const getAbsTime = () => baseAbsTime + elapsedSeconds;

  const getModifiers = (): ResearchCostModifiers => {
    const artifactMods = calculateArtifactModifiers(currentState.artifactLoadout);
    return {
      labUpgradeLevel: context.epicResearchLevels['cheaper_research'] || 0,
      researchCostMultiplier: context.colleggtibleModifiers.researchCost || 1,
      puzzleCubeMultiplier: artifactMods.researchCost.totalMultiplier,
    };
  };

  const advanceTime = (totalSeconds: number) => {
    const result = advanceTimeWithBoundaries(currentState, actions, elapsedSeconds, context, baseAbsTime, totalSeconds);
    currentState = result.currentState;
    elapsedSeconds = result.elapsedSeconds;
  };

  /**
   * Buy a single research level, deciding its own price/wait from the current state.
   *
   * `checkRoiGate` (only passed `true` by `executeChainItem`, mirroring the manual planner's
   * `syncEventStateForItem`/`handleBuyMilestoneChain`) additionally defers a purchase that isn't
   * already timed to land during a real sale out to the next sale's start, when buying now at full
   * price wouldn't earn back 70% of its own cost by then — see `shouldDeferToNextSale`'s own doc
   * comment for why this needs to be the exact same check the manual side uses rather than a second
   * independent one.
   */
  const buyResearch = (researchId: string, timeLimit: number, checkRoiGate = false): boolean => {
    const research = getResearchById(researchId);
    if (!research) return false;
    const currentLevel = currentState.researchLevels[researchId] || 0;
    if (currentLevel >= research.levels) return false;
    if (!isTierUnlocked(currentState.researchLevels, research.tier)) return false;

    const snapshot = computeSnapshot(currentState, context, { skipGrowth: true });
    const absTime = getAbsTime();
    const isSaleActive = isResearchSaleActive(absTime);
    const transitions = boostTransitionsFrom(snapshot, absTime);
    const purchase = getSaleAwareTimeToSave(research, currentLevel, getModifiers(), isSaleActive, absTime, snapshot, transitions);

    if (snapshot.offlineEarnings <= 0) return false;

    // `Math.max`, not a plain `??` — see `rankResearchByROI`'s identical comment: `roiDeadlineOverride`
    // is a fixed point computed once up front and can go stale relative to the calendar's own next
    // sale as real execution time advances, so it should only ever grant MORE runway, never less.
    const calendarNextSaleStart = getNextSaleStart(absTime);
    const roiDeadline =
      roiDeadlineOverride !== undefined ? Math.max(roiDeadlineOverride, calendarNextSaleStart) : calendarNextSaleStart;

    if (
      checkRoiGate &&
      !purchase.duringSale &&
      shouldDeferToNextSale(
        research,
        currentLevel,
        getModifiers(),
        snapshot,
        context,
        absTime,
        roiDeadline,
        getNextSaleEnd(absTime),
        isSaleActive,
        transitions,
        purchase.duringSale
      )
    ) {
      const deferSeconds = getNextSaleStart(absTime) - absTime;
      if (elapsedSeconds + deferSeconds > timeLimit) return false;
      advanceTime(deferSeconds);
      // Re-price from scratch now that we're actually at the sale — same reasoning as the manual
      // planner's `advanceToDeadline` followed by a fresh `buyOneLevel` call, just folded into one
      // recursive call here since this function (unlike the manual side) owns both the wait and the
      // purchase together. `purchase.duringSale` will be true on this retry (we're now inside the
      // sale we just waited for), so `shouldDeferToNextSale`'s own during-sale bypass guarantees this
      // never recurses more than once.
      return buyResearch(researchId, timeLimit, checkRoiGate);
    }

    const timeToSave = purchase.waitSeconds;
    if (elapsedSeconds + timeToSave > timeLimit) return false;

    advanceTime(timeToSave);

    const action = createSimAction(
      'buy_research',
      {
        researchId,
        fromLevel: currentLevel,
        toLevel: currentLevel + 1,
      },
      purchase.price
    );

    currentState = applyAction(currentState, action);

    const finalSnap = computeSnapshot(currentState, context, { skipGrowth: true });
    action.endState = finalSnap;
    action.totalTimeSeconds = 0;
    action.bankDelta = -purchase.price;

    actions.push(action);
    return true;
  };

  /**
   * Read-only preview of `buyResearch`'s own sale-aware pricing (research validity, tier unlock,
   * current level, `getSaleAwareTimeToSave`) — same computation, minus the wait/mutate/checkRoiGate
   * machinery, since callers here only want "how long would this take right now," not to actually
   * commit to it. Kept as its own small function (duplicating `buyResearch`'s first half) rather
   * than factored out of it, since `buyResearch` already has more branches (`checkRoiGate`'s
   * defer-and-recurse path) than this needs, and refactoring it risks disturbing that delicate
   * logic. Returns `null` for the same "can't ever buy this" reasons `buyResearch` bails out early
   * for. Used by C3's silo-mode purchase deferral (`executePlanToLevels`) to decide whether a
   * planned purchase would naturally complete before an upcoming earnings boost starts, without
   * actually committing to it.
   */
  const previewPurchase = (researchId: string): { waitSeconds: number } | null => {
    const research = getResearchById(researchId);
    if (!research) return null;
    const currentLevel = currentState.researchLevels[researchId] || 0;
    if (currentLevel >= research.levels) return null;
    if (!isTierUnlocked(currentState.researchLevels, research.tier)) return null;

    const snapshot = computeSnapshot(currentState, context, { skipGrowth: true });
    if (snapshot.offlineEarnings <= 0) return null;
    const absTime = getAbsTime();
    const isSaleActive = isResearchSaleActive(absTime);
    const transitions = boostTransitionsFrom(snapshot, absTime);
    const purchase = getSaleAwareTimeToSave(research, currentLevel, getModifiers(), isSaleActive, absTime, snapshot, transitions);
    return { waitSeconds: purchase.waitSeconds };
  };

  /**
   * Execute one already-planned milestone-chain item by re-deriving its actual price/wait from the
   * CURRENT state via `buyResearch`, rather than trusting `item`'s own precomputed `price`/
   * `timeToBuySeconds` — those were priced once during planning and can go stale by the time this
   * replays. In particular, `computeResearchMilestoneChain`'s `idleForwardTo` calls advance its
   * internal planning clock/bank to skip past a dead stretch (e.g. riding out to the next sale) but
   * leave no entry of their own in the returned `items` — so an item priced right after one of those
   * gaps shows a `timeToBuySeconds` of ~0 (correct at planning time, since the gap had already been
   * spent), and blindly replaying that number here would skip the gap entirely: the real elapsed
   * time — and the bank accrual that gap was supposed to produce — would never actually happen,
   * leaving this replay charging post-gap prices against a pre-gap bank (confirmed against a live
   * export: exactly this pattern drove `bankValue` deeply negative across a run of "0 second wait"
   * purchases). `item` here only decides WHICH research to buy next; the real price/wait comes from
   * `buyResearch`, exactly the way `executePlanToLevels` (`c3.ts`) already replays ITS OWN
   * precomputed research-ID order rather than trusting its plan's numbers directly.
   *
   * Returns the actual price paid, or `false` if the purchase didn't happen (unaffordable within
   * `timeLimit`).
   *
   * Passes `checkRoiGate: true` to `buyResearch` — matching `handleBuyMilestoneChain`
   * (`ResearchActions.vue`), the manual planner's own "Buy Entire Chain" replay, which is the only
   * flow that enforces this gate on its side too. Every other `buyResearch` caller here (sale-riding
   * buy-plan replay, Smart Buy sweeps) leaves it off, matching their own manual-planner counterparts.
   */
  const executeChainItem = (item: MilestoneChainItem, timeLimit: number): number | false => {
    if (!buyResearch(item.research.id, timeLimit, true)) return false;
    return actions[actions.length - 1].cost;
  };

  /**
   * Insert a zero-cost, zero-time inline note at the FRONT of the action list, dated to
   * `startState` rather than wherever the sweep has gotten to by the time this is called — callers
   * typically only know what to say (e.g. "N purchases over Xs") after running their loop, but the
   * note should still read as having happened before the actions it's describing. Generic across
   * every milestone/smart-buy helper above, not just `runSmartBuyForSeconds`.
   */
  const addNotification = (payload: NotificationPayload) => {
    const action = createSimAction('notification', payload, 0);
    action.endState = computeSnapshot(startState, context, { skipGrowth: true });
    action.totalTimeSeconds = 0;
    actions.unshift(action);
  };

  /**
   * Execute an already-planned milestone chain item-by-item and, if anything actually landed, add
   * the summarizing inline note ahead of it — the "run a whole planned chain" counterpart to
   * `runSmartBuyForSeconds`'s own inline note-on-completion, factored out here so every
   * chain-buying shift (`runTierUnlockMilestone`, `runResearchMilestoneIfWorthwhile`, and whatever
   * gets added later) gets a correctly-annotated plan just by calling this instead of each
   * separately re-deriving the same executed-count/gems-spent/note bookkeeping. Mirrors the manual
   * planner's `handleBuyMilestoneChain` (`ResearchActions.vue`), which builds the same
   * `buildMilestoneNotePayload` note for its own "Buy Entire Chain" button — this is the
   * auto-engine side of that same shape.
   *
   * `timeSavedSeconds` is the baseline comparison for the FULL planned chain — dropped from the
   * note if `timeLimit` cuts the sweep off before every item lands, since the comparison assumes
   * the whole chain completed (same reasoning as `buildMilestoneNotePayload`'s own doc comment).
   *
   * Returns the number of items actually executed (may be less than `items.length` if `timeLimit`
   * was hit).
   *
   * `deferForEarningsMode` (only ever passed `true` by C3's Tier 13 unlock step — see its own call
   * site's comment) opts into the same defer-for-earnings-mode purchase deferral
   * `executePlanToLevels` (c3.ts) uses for its own sweep: an item that would otherwise complete
   * within the pre-boost silo window is skipped and bought instead right after the boost starts,
   * where the same price is reached in less real time. Multiversal Layering is exempt (and
   * protects anything scheduled before it in this same chain) since it meaningfully raises the
   * earn rate and should start compounding ASAP. Defaults to `false` so C1/C2's own
   * `runTierUnlockMilestone` calls — tightly time-boxed budgets unrelated to riding out a boost
   * cycle — are unaffected regardless of `context.deferForEarningsMode`.
   */
  const executeChain = (
    items: MilestoneChainItem[],
    targetLabel: string,
    timeLimit: number,
    timeSavedSeconds?: number,
    deferForEarningsMode = false
  ): number => {
    // Actual price paid, not `item.price` — see `executeChainItem`'s doc comment for why the
    // plan's own precomputed price can no longer be trusted as of whatever real state replay has
    // reached by this point.
    const { executedCount, totalGemsSpent } = deferForEarningsMode
      ? runWithEarningsEventDeferral(
          items,
          item => item.research.id,
          executeChainItem,
          { getAbsTime, previewPurchase, advanceTime, getElapsedSeconds: () => elapsedSeconds, getState: () => currentState },
          context,
          timeLimit
        )
      : (() => {
          let executedCount = 0;
          let totalGemsSpent = 0;
          for (const item of items) {
            const paid = executeChainItem(item, timeLimit);
            if (paid === false) break;
            executedCount++;
            totalGemsSpent += paid;
          }
          return { executedCount, totalGemsSpent };
        })();

    if (executedCount > 0) {
      const notePayload = buildMilestoneNotePayload(
        targetLabel,
        executedCount,
        elapsedSeconds,
        totalGemsSpent,
        executedCount === items.length ? timeSavedSeconds : undefined
      );
      if (notePayload) addNotification(notePayload);
    }

    return executedCount;
  };

  return {
    getAbsTime,
    getModifiers,
    buyResearch,
    previewPurchase,
    advanceTime,
    executeChainItem,
    executeChain,
    addNotification,
    getState: () => currentState,
    getElapsedSeconds: () => elapsedSeconds,
    getActions: () => actions,
  };
}

/**
 * C1 bullet 1: "buy everything you can in a specific number of seconds" — repeatedly buys the
 * cheapest unlocked research level that can be saved up for in `<= thresholdSeconds`, ignoring
 * existing bank/gems (same semantics as the manual planner's Smart Buy button), until nothing
 * qualifies or `timeLimit` is reached.
 */
export function runSmartBuyForSeconds(
  startState: EngineState,
  context: SimulationContext,
  thresholdSeconds: number,
  timeLimit: number
): ShiftResult {
  const helpers = createMilestoneShiftHelpers(startState, context);
  let purchaseCount = 0;
  let totalGemsSpent = 0;

  while (helpers.getElapsedSeconds() <= timeLimit) {
    const snapshot = computeSnapshot(helpers.getState(), context, { skipGrowth: true });
    const isSale = isResearchSaleActive(helpers.getAbsTime());
    const candidate = findSmartBuyCandidate(
      helpers.getState().researchLevels,
      helpers.getModifiers(),
      isSale,
      snapshot,
      thresholdSeconds,
      helpers.getAbsTime()
    );
    if (!candidate) break;
    if (!helpers.buyResearch(candidate.research.id, timeLimit)) break;
    purchaseCount++;
    totalGemsSpent += candidate.price;
  }

  // Elapsed time here doubles as "total time to save" — unlike the manual planner's dry-run
  // preview, this sweep really does advance the clock between purchases (see `buyResearch`), so the
  // two are the same number.
  const notePayload = buildQuickBuyNotePayload(
    thresholdSeconds,
    purchaseCount,
    helpers.getElapsedSeconds(),
    totalGemsSpent
  );
  if (notePayload) helpers.addNotification(notePayload);

  return {
    actions: helpers.getActions(),
    elapsedSeconds: helpers.getElapsedSeconds(),
    endState: helpers.getState(),
  };
}

/**
 * C1 bullet 2: unlock a tier via the ROI-optimal milestone chain (rather than C1's own simpler
 * `findTierUnlockCandidate` heuristic). Plans the whole chain once up front against `startState`,
 * then executes it item-by-item, stopping early if `timeLimit` would be exceeded — the remaining
 * (unexecuted) plan is simply dropped, since each item's cost only depends on state up to that
 * point, not on later items.
 */
export function runTierUnlockMilestone(
  startState: EngineState,
  context: SimulationContext,
  targetTier: number,
  timeLimit: number,
  // Forwarded to `computeTierMilestoneChain`'s own `roiDeadlineOverride` (planning) and
  // `createMilestoneShiftHelpers`'s (execution-time re-check) — see that parameter's doc comment.
  roiDeadlineOverride?: number,
  // Forwarded to `executeChain`'s own `deferForEarningsMode` — see that parameter's doc comment.
  // Defaults to `false`: C1/C2's own tier-unlock calls don't pass this, so they're unaffected
  // regardless of `context.deferForEarningsMode`.
  deferForEarningsMode = false
): ShiftResult {
  const helpers = createMilestoneShiftHelpers(startState, context, roiDeadlineOverride);

  const startSnapshot = computeSnapshot(startState, context, { skipGrowth: true });
  const absoluteSimTimeAtStart = helpers.getAbsTime();
  const mods = helpers.getModifiers();

  // Cheap short-circuit before the expensive chain build: if even the single cheapest currently
  // available research purchase can't fit in the remaining budget, nothing in the full chain could
  // either — no purchase (ROI-motivated or not) can cost less, in wait time, than the cheapest
  // option available right now, so if that alone doesn't fit, literally zero purchases are possible
  // and `computeTierMilestoneChain`'s full detour search is guaranteed to find nothing.
  //
  // Deliberately NOT "would plain cheapest-first reach the whole tier in time" (a broader, cheaper
  // check that was here before this comment): that's unsound. A pricier detour that raises the
  // earnings rate can make every purchase AFTER it complete faster, so "cheapest-first can't finish
  // the full chain" does NOT prove "nothing can finish it" — `findRoiDetour` exists precisely
  // because that kind of rate-boosting detour is sometimes exactly what makes an otherwise-out-of-
  // reach chain reachable. Only "not even one purchase is affordable" is safe to shortcut on.
  if (!isCheapestTierPurchaseAffordable(startState.researchLevels, startSnapshot, mods, absoluteSimTimeAtStart, timeLimit)) {
    return { actions: [], elapsedSeconds: 0, endState: startState };
  }

  // Deadline for "would this purchase still finish before the current/next sale ends" — must match
  // the manual planner's own `researchSaleDeadline` (`useResearchViews.ts`), which is `getNextSaleEnd`,
  // not `getNextSaleStart`. The two had drifted apart (this used to pass `getNextSaleStart`, a much
  // later timestamp) since this function was first extracted; manual is the better-tested source of
  // truth here, so auto now matches it exactly.
  const researchSaleDeadline = getNextSaleEnd(absoluteSimTimeAtStart);

  const chain = computeTierMilestoneChain(
    { tier: targetTier },
    startSnapshot,
    context,
    mods,
    absoluteSimTimeAtStart,
    researchSaleDeadline,
    roiDeadlineOverride
  );

  // Same baseline comparison the manual planner's Milestone Summary panel would show for this
  // target — only meaningful when the planned chain actually reaches the tier at all.
  const baseline = computeMilestoneBaseline(
    { kind: 'tier', tier: targetTier },
    startSnapshot,
    context,
    mods,
    absoluteSimTimeAtStart
  );
  const timeSavedSeconds =
    chain.reached && baseline.reached ? baseline.totalSeconds - chain.totalSeconds : undefined;

  helpers.executeChain(chain.items, `Unlock Tier ${targetTier}`, timeLimit, timeSavedSeconds, deferForEarningsMode);

  return {
    actions: helpers.getActions(),
    elapsedSeconds: helpers.getElapsedSeconds(),
    endState: helpers.getState(),
  };
}

/**
 * C1 bullet 3: buy a specific research's milestone chain only if its `optimizedSeconds` is below
 * `maxOptimizedSeconds`. Caller-side filtering by research type/ID (picking which `researchId` to
 * check) is the responsibility of whatever shift eventually calls this in a loop — this function
 * only handles "one target, buy-if-worthwhile."
 */
export function runResearchMilestoneIfWorthwhile(
  startState: EngineState,
  context: SimulationContext,
  researchId: string,
  targetLevel: number,
  maxOptimizedSeconds: number,
  timeLimit: number,
  // See `runTierUnlockMilestone`'s identical parameter.
  roiDeadlineOverride?: number
): ShiftResult {
  const noop: ShiftResult = { actions: [], elapsedSeconds: 0, endState: startState };

  const helpers = createMilestoneShiftHelpers(startState, context, roiDeadlineOverride);
  const startSnapshot = computeSnapshot(startState, context, { skipGrowth: true });
  const absoluteSimTimeAtStart = helpers.getAbsTime();
  const mods = helpers.getModifiers();
  // See `runTierUnlockMilestone`'s comment above — same fix, same reasoning.
  const researchSaleDeadline = getNextSaleEnd(absoluteSimTimeAtStart);

  const target = { researchId, targetLevel };

  const chain = computeResearchMilestoneChain(
    target,
    startState,
    startSnapshot,
    context,
    mods,
    absoluteSimTimeAtStart,
    researchSaleDeadline,
    roiDeadlineOverride
  );
  const baseline = computeMilestoneBaseline(
    { kind: 'research', researchId, targetLevel },
    startSnapshot,
    context,
    mods,
    absoluteSimTimeAtStart
  );
  const summary = computeMilestoneSummaryCore(chain, baseline);

  if (summary.truncated || summary.optimizedSeconds === undefined || summary.optimizedSeconds > maxOptimizedSeconds) {
    return noop;
  }

  // Same label wording the manual planner's Milestone view uses for a research target (see
  // `getMilestoneTargetLabel` in `ResearchActions.vue`), so the note reads consistently regardless
  // of which side bought it.
  const research = getResearchById(researchId);
  const targetLabel = research ? `${research.name} (Lv ${targetLevel}/${research.levels})` : 'Milestone';

  helpers.executeChain(chain.items, targetLabel, timeLimit, summary.timeSavedSeconds);

  return {
    actions: helpers.getActions(),
    elapsedSeconds: helpers.getElapsedSeconds(),
    endState: helpers.getState(),
  };
}

/**
 * Buy a research to max, one level at a time via `runResearchMilestoneIfWorthwhile`, rather than
 * one chain call aimed straight at max level — shared by every shift (`c1.ts`, `c2.ts`) that wants
 * "buy as much of this research as fits in the time budget, but never a partial down payment on a
 * level that won't finish."
 *
 * Two distinct reasons drive the one-level-at-a-time structure, both load-bearing:
 *
 * - Reachability: `runResearchMilestoneIfWorthwhile` noops its ENTIRE chain if it can't fully reach
 *   its target level — aiming one call straight at max risks a single unreachable (or merely
 *   not-worth-it) level near the top silently discarding purchases on every cheaper level below it.
 *   Targeting one level up at a time means that only stops the loop from there.
 * - Time budget: `maxOptimizedSeconds` is capped at the remaining budget (not leaved `Infinity`),
 *   so a level whose OWN chain (target level plus whatever earnings research speeds up reaching it)
 *   can't fully finish within what's left gets skipped entirely, rather than partially executed.
 *   `optimizedSeconds` is the chain's own full real-time cost to reach the target level (see
 *   `computeMilestoneSummaryCore`); without this cap, a level whose chain eventually completes but
 *   takes far longer than what's left (e.g. a graviton coupling level needing weeks against a
 *   couple hours of remaining shift) still passed the worthwhile gate, then `executeChain` bought as
 *   much of that chain — earnings-research detours included — as fit in the time limit before giving
 *   up on the target itself, stranding real gems and shift time spent chasing a level that was never
 *   going to land. Capping here means a level whose chain can't finish in time buys NOTHING toward it
 *   at all: finish the chain, or don't start it.
 *
 * Each level's chain still buys whatever earnings research speeds up reaching THAT level along the
 * way — no separate earnings-buying pass needed.
 */
export function runBuyResearchLevelByLevel(
  startState: EngineState,
  context: SimulationContext,
  researchId: string,
  timeLimit: number,
  // See `runTierUnlockMilestone`'s identical parameter.
  roiDeadlineOverride?: number
): ShiftResult {
  const research = getResearchById(researchId);
  if (!research) return { actions: [], elapsedSeconds: 0, endState: startState };

  let currentState = startState;
  let elapsedSeconds = 0;
  const actions: Action[] = [];
  const remainingBudget = () => timeLimit - elapsedSeconds;

  let level = currentState.researchLevels[researchId] || 0;
  while (level < research.levels && remainingBudget() > 0) {
    const budget = remainingBudget();
    const result = runResearchMilestoneIfWorthwhile(
      currentState,
      context,
      researchId,
      level + 1,
      budget,
      budget,
      roiDeadlineOverride
    );
    currentState = result.endState;
    elapsedSeconds += result.elapsedSeconds;
    actions.push(...result.actions);

    const newLevel = currentState.researchLevels[researchId] || 0;
    if (newLevel <= level) break; // no progress this round — out of budget or unreachable, stop here
    level = newLevel;
  }

  return { actions, elapsedSeconds, endState: currentState };
}
