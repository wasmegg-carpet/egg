import type { Action } from '@/types/actions/meta';
import type { NotificationPayload } from '@/types';
import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { getTiers, isTierUnlocked, type ResearchCostModifiers } from '../../calculations/commonResearch';
import {
  createMilestoneShiftHelpers,
  runTierUnlockMilestone,
  runResearchMilestoneIfWorthwhile,
  runSmartBuyForSeconds,
} from './helpers/milestones';
import { applyShiftAction } from './helpers/actionHelpers';
import { advanceTimeWithBoundaries } from './helpers/advanceTime';
import { runWithEarningsEventDeferral, MULTI_LAYERING_ID } from './helpers/earningsEventDeferral';
import { computeSnapshot } from '../../engine/compute';
import { calculateArtifactModifiers } from '../../lib/artifacts';
import { simulateSaleAwareBuy, simulateSaleEndsBuy, simulateFinalSaleGapBuy } from '../../calculations/smartBuyPreview';
import {
  buildSaleAwareBuyNotePayload,
  buildSaleEndsBuyNotePayload,
  buildFinalSaleGapBuyNotePayload,
} from '@/lib/actions/notes';
import {
  isResearchSaleActive,
  getNextSaleStart,
  getNextSaleEnd,
  getBuildPhaseEndForSaleCount,
  getSaleStartForEnd,
  countSalesThrough,
} from '@/lib/events';
import { DEBUG_SHIFT_TIMING } from '@/lib/debugFlags';

export interface C3Params {
  /** Attempt to unlock Tier 13 before anything else, if it isn't already unlocked. Default false. */
  attemptTier13Unlock?: boolean;
}

// MULTI_LAYERING_ID comes from './helpers/earningsEventDeferral' (shared with its own deferral logic).
const MULTI_LAYERING_LEVEL_1 = 1;
const MULTI_LAYERING_TARGET_LEVEL = 2;

// Threshold for step 1a's opening smart-buy sweep — see that step's own comment below for why.
// Matches the order of magnitude C1's identical bootstrap sweep already uses (3 seconds); picked
// independently rather than sharing C1's own constant since the two calls are tuned for different
// jobs and have no reason to move together.
const OPENING_SMART_BUY_THRESHOLD_SECONDS = 10;

/**
 * C3: the "build phase" shift, spent riding out one or more weekly research sales in Curiosity.
 *
 * 1. Shift to Curiosity.
 * 1a. Run a short, fixed-threshold smart-buy sweep (`runSmartBuyForSeconds`, same helper C1's own
 *    bootstrap sweep uses) before anything else gets a chance to spend real budget. This exists
 *    purely as a performance measure, not an economic one: every purchase it makes is something
 *    that would have gotten bought anyway by steps 2-4's own ROI-gated loops, just at the cost of
 *    a full `rankResearchByROI`/`rankResearchByELRImpact` pass (each of which is expensive —
 *    involves an artifact-set optimization search per candidate) for what's often a long run of
 *    trivially-affordable levels early in a low-earnings ascension. Buying that stretch here
 *    instead, via `findSmartBuyCandidate`'s much cheaper plain price sort, does the exact same
 *    purchases for a fraction of the cost, and shrinks the candidate pool (and, for
 *    `rankResearchByELRImpact` specifically, the remaining-levels lookahead search — see its own
 *    comment in researchRanking.ts) that every later step's ranking calls have to chew through.
 *    Deliberately unrestricted by category, same as C1's sweep: anything cheap enough to clear
 *    `OPENING_SMART_BUY_THRESHOLD_SECONDS` is worth having regardless of what it's for, and this
 *    keeps the same lookup available for step 2's Tier-13 milestone checks too. Placed before step
 *    2 rather than folded into it since it isn't Tier-13-specific — it should run whether or not
 *    Tier 13 is even being attempted this variant. Runs again from scratch for every variant
 *    `runC3Variants` computes (each calls `runC3` fresh from the same `startState`) rather than
 *    being hoisted out and shared — deliberately, to keep all of C3's buying logic together in one
 *    place instead of splitting it across a shared pre-step and this function; the sweep itself is
 *    cheap enough that repeating it a handful of times is not worth that split.
 * 2. If Tier 13 is wanted: first, if Multiversal Layering 2 isn't already unlocked, try to grab it
 *    via the milestone view's research-level-target chain — staged as level 1 (if not already
 *    bought) then level 2, as two separate chain attempts, so a level-1-only ML doesn't get skipped
 *    just because a level-2 attempt run straight from level 0 couldn't fully land in time — then try
 *    to unlock Tier 13. Grabbing ML2 first is a soft preference, not a hard requirement — tier
 *    unlocks are purely a total-purchase-count threshold (see `isTierUnlocked`), so ML2 is never
 *    actually required to reach Tier 13,
 *    just cheap and valuable enough to be worth grabbing first *when there's room*. So if ML2 +
 *    Tier 13 together don't fit before `buildPhaseEnd`, this rewinds to right after the Curiosity
 *    shift and retries spending the *entire* remaining budget on Tier 13 alone, skipping ML2 —
 *    since the two together running out of runway doesn't mean Tier 13 alone would too. Only if
 *    that second attempt also fails to unlock Tier 13 in time is the variant declared impossible.
 *    Each of `runResearchMilestoneIfWorthwhile`/`runTierUnlockMilestone` is capped at exactly the
 *    remaining `buildPhaseEnd - getAbsTime()` at the time it's called, so any single attempt can
 *    only ever end one of two ways: it finishes within its budget (leaving `getAbsTime()` at or
 *    before `buildPhaseEnd`, never after), or it doesn't finish at all — there's no third case
 *    where it "succeeds but finishes late," so a plain post-attempt tier check is the complete
 *    impossible/possible test for each attempt; no separate overrun handling is needed here.
 * 3. Repeat: buy earnings research that clears Smart Buy's two ROI gates, then wait for the next
 *    sale to start — until reaching the start of the final sale (the one ending at the build
 *    phase's end). This naturally does fewer cycles (or none) if step 2's Tier 13 unlock already
 *    consumed enough real time to cross earlier sales while buying — the loop just walks forward
 *    from wherever `getAbsTime()` currently is via `getNextSaleStart`/`getNextSaleEnd`, it doesn't
 *    count cycles. The two gates (see `rankResearchByROI`'s `showBuyNowRoiWarning`/
 *    `showFullRoiWarning` doc comments in researchROI.ts, and SMART_BUY_DUAL_ROI_DESIGN.md §1/§2.3)
 *    are identical to the manual planner's own "70% Return" button, with no C3-specific override
 *    needed for either: the near-term gate is always judged against whichever sale is immediately
 *    upcoming (or bypassed outright while already buying at a live discount, whichever sale that
 *    happens to be), and the full-payback gate is judged against `buildPhaseEnd` — this shift's own
 *    commitment to riding out every sale between now and then, passed as `fullRoiDeadline` — so a
 *    purchase doesn't need to fully pay for itself by any one sale along the way, only by the end of
 *    the whole ride.
 * 3a. Whenever a step-3 cycle's target is the ride's FINAL sale specifically, and that cycle's own
 *    two-gated buying runs out of qualifying candidates before actually reaching that sale's start,
 *    fill whatever's left of that gap with delivery-relevant research that's economical to buy now
 *    rather than defer — see `buyFinalSaleGap`/`simulateFinalSaleGapBuy`'s own doc comments for the
 *    full "why" (short version: some of what step 4 below buys for its delivery impact also raises
 *    earnings, and step 4 never gates on ROI at all, so it's worth pulling forward into otherwise-
 *    idle time whenever doing so pays for itself before the final sale even starts). Only applies to
 *    the cycle immediately before the final sale — every earlier cycle's own idle gap has no
 *    equivalent "what does the eventual delivery buy look like" to weigh a pre-buy against.
 * 4. Buy delivery research until nothing more is worth buying (not necessarily until the sale
 *    itself ends — once purchasing stalls out, C3 stops there rather than padding the clock the
 *    rest of the way to `buildPhaseEnd`; K3, the next shift, already waits out any remaining time
 *    against that same `buildPhaseEnd`, so a second wait here would be redundant).
 *
 * Steps 3-4 both reuse the exact same plan-computation functions the manual planner's "Buy Until
 * Sale Warning"/"Buy Until Sale Ends" buttons are built on — `simulateSaleAwareBuy`/
 * `simulateSaleEndsBuy` in `calculations/smartBuyPreview.ts` — rather than a separate
 * auto-planner-only implementation; see those functions' own doc comments for what each actually
 * does. This replaces the previous design's extra "buy earnings research toward the final sale's
 * 100% deadline" bridging step between sales: `simulateSaleAwareBuy`/`simulateSaleEndsBuy` already
 * handle their own edge cases (sale-bypass purchases, earnings-prelude-before-delivery trimming),
 * so a bespoke C3-only step is no longer needed.
 */
export function runC3(
  startState: EngineState,
  context: SimulationContext,
  buildPhaseEnd: number = 0,
  _reserved?: number,
  params: C3Params = {}
): ShiftResult {
  let currentState = { ...startState };
  let elapsedSeconds = 0;
  const actions: Action[] = [];

  const baseAbsTime = context.ascensionStartTime + ((startState.lastStepTime || 0) - context.planStartOffset);
  const getAbsTime = () => baseAbsTime + elapsedSeconds;

  // Used ONLY by step 2's ML/Tier-13 milestone-chain attempts below (`runResearchMilestoneIfWorthwhile`/
  // `runTierUnlockMilestone`'s own `roiDeadlineOverride`) — a separate, untouched mechanism from step
  // 3's Smart Buy gates (see `buyUntilSaleWarning` below, which passes `buildPhaseEnd` itself, not
  // this value, as `fullRoiDeadline`). Kept as its own variable specifically because the two steps
  // now use "how far can this deadline stretch" concepts differently — milestone-chain purchases
  // still judge a single, stretched 70%-by-`roiDeadline` bar; Smart Buy purchases judge two separate
  // gates instead (see step 3's own doc comment above). `buildPhaseEnd` is always the ride's last
  // sale's own END (see `getBuildPhaseEndForSaleCount`); `getSaleStartForEnd` recovers that sale's
  // START for the milestone-chain callers that still want it.
  const roiDeadline = getSaleStartForEnd(buildPhaseEnd);

  const advanceTime = (totalSeconds: number) => {
    const result = advanceTimeWithBoundaries(currentState, actions, elapsedSeconds, context, baseAbsTime, totalSeconds);
    currentState = result.currentState;
    elapsedSeconds = result.elapsedSeconds;
  };

  // Folds a sub-shift's ShiftResult into this shift's own running state.
  const runStep = (result: ShiftResult) => {
    actions.push(...result.actions);
    currentState = result.endState;
    elapsedSeconds += result.elapsedSeconds;
  };

  const getModifiers = (): ResearchCostModifiers => {
    const artifactMods = calculateArtifactModifiers(currentState.artifactLoadout);
    return {
      labUpgradeLevel: context.epicResearchLevels['cheaper_research'] || 0,
      researchCostMultiplier: context.colleggtibleModifiers.researchCost || 1,
      puzzleCubeMultiplier: artifactMods.researchCost.totalMultiplier,
    };
  };

  // Executes a precomputed purchase plan (from `simulateSaleAwareBuy`/`simulateSaleEndsBuy`) for
  // real: walks `researchIdsInOrder` — the plan's actual, already-interleaved purchase sequence —
  // one entry at a time, buying one level per entry. Skips an entry once its research is already at
  // or above its own final target level from `endLevels` (this is what accounts for anything the
  // plan itself decided to revert, e.g. `simulateSaleAwareBuy`'s sale-bypass cleanup — see its own
  // doc comment — since a reverted id's raw entries would otherwise still be sitting in
  // `researchIdsInOrder`). `timeLimit` bounds this call the same way every other purchase helper
  // here does — the plan was already computed against the same deadline, so this is a safety net
  // against drift between the plan and real execution, not the primary stopping condition.
  //
  // Bug (fixed 2026-08-12): this used to deduplicate `researchIdsInOrder` down to first-seen research
  // IDs and buy every level of one id consecutively before moving to the next, discarding the plan's
  // real interleaving entirely (e.g. turning "eggsistor, matter_reconfig, matter_reconfig,
  // wormhole_dampening, matter_reconfig, eggsistor, ..." into "5× eggsistor, then 19× matter_reconfig,
  // then wormhole_dampening"). Since every one of these purchases raises the earn rate, and the
  // interleaved order is what lets that rate ramp up fastest, batching by research id took
  // measurably longer in real elapsed time to execute the exact same final purchases — confirmed
  // against a live manual-planner replay of the same 28-purchase plan: same items, same end levels,
  // but ~2.5 real days slower to finish, which meant several fewer days of pure idle earnings
  // accumulation before the following sale. The manual planner's own real execution
  // (`runSaleAwareBuyFlow`/`handleBuyUntilSaleDeadline`) never had this bug — it already walks its
  // plan in real order, one entry at a time — so this was a defect specific to this replay helper.
  // `buildNote`, when given, mirrors the manual planner's Smart Buy notes: it's handed the
  // purchases actually landed here (not the plan's own precomputed count/total, which may run
  // ahead of what `timeLimit` allows) — including `elapsedSeconds`, the real time this sweep's own
  // purchases actually took (`helpers.getElapsedSeconds()` at the moment the note is built, NOT
  // `timeLimit` itself — a sweep that runs out of qualifying candidates early finishes in less than
  // `timeLimit`, and the note should say so rather than reporting the caller's full budget
  // regardless of what was actually bought; see `saleAwareStats70`'s identical fix in
  // useResearchViews.ts for the same bug in the manual planner's equivalent stat) — and, if it
  // returns a payload, that note is inserted ahead of this sweep's purchases — same "prepend a
  // summary note" shape as `createMilestoneShiftHelpers`'s own `executeChain`/`runSmartBuyForSeconds`,
  // just for the sale-aware/sale-ends buy plans instead of a milestone chain.
  const executePlanToLevels = (
    researchIdsInOrder: string[],
    targetLevels: Record<string, number>,
    timeLimit: number,
    buildNote?: (purchaseCount: number, totalGemsSpent: number, elapsedSeconds: number) => NotificationPayload | null
  ) => {
    const helpers = createMilestoneShiftHelpers(currentState, context);

    const { executedCount: purchaseCount, totalGemsSpent } = runWithEarningsEventDeferral(
      researchIdsInOrder,
      id => id,
      (id, tl) => {
        if (!helpers.buyResearch(id, tl)) return false;
        return helpers.getActions()[helpers.getActions().length - 1].cost;
      },
      {
        getAbsTime: helpers.getAbsTime,
        previewPurchase: helpers.previewPurchase,
        advanceTime: helpers.advanceTime,
        getElapsedSeconds: helpers.getElapsedSeconds,
        getState: helpers.getState,
      },
      context,
      timeLimit,
      id => (helpers.getState().researchLevels[id] || 0) >= (targetLevels[id] || 0)
    );

    if (buildNote && purchaseCount > 0) {
      const notePayload = buildNote(purchaseCount, totalGemsSpent, helpers.getElapsedSeconds());
      if (notePayload) helpers.addNotification(notePayload);
    }

    runStep({
      actions: helpers.getActions(),
      elapsedSeconds: helpers.getElapsedSeconds(),
      endState: helpers.getState(),
    });
  };

  // "Buy Until Sale Warning" (Smart Buy's two gates, cleared before `targetDeadline`, the upcoming
  // sale's start) — same plan the manual planner's button executes. Deliberately 'immediate' mode,
  // not 'maxed_vehicles': this is the earnings-ROI pass and is meant to judge "does this pay for
  // itself soon, given what's actually on the farm right now" — 'maxed_vehicles' is the
  // delivery-research mode's job (`buyUntilSaleEnds` below already passes `'realistic'` to
  // `rankResearchByELRImpact`, which itself assumes maxed habs/vehicles via `getOptimalELRSet`). See
  // git history around 2026-08-12 for a reverted attempt to swap this to 'maxed_vehicles' — that
  // conflated the two passes' jobs.
  //
  // `buildPhaseEnd` (this shift's own commitment — the ride's last sale's own end), NOT the local
  // `roiDeadline` variable above, is what's passed as `fullRoiDeadline`: the near-term gate needs no
  // override at all (it's always judged against whichever sale is immediately upcoming, same as the
  // manual planner), and the full-payback gate's deadline is `buildPhaseEnd` itself, not a start-of-
  // sale value derived from it. See this function's own top-level doc comment (step 3) for the full
  // reasoning.
  const buyUntilSaleWarning = (targetDeadline: number) => {
    const snapshot = computeSnapshot(currentState, context, { skipGrowth: true });
    const absTime = getAbsTime();
    const plan = simulateSaleAwareBuy(
      currentState.researchLevels,
      snapshot,
      context,
      getModifiers(),
      absTime,
      getNextSaleEnd(absTime),
      targetDeadline,
      'immediate',
      false,
      undefined,
      buildPhaseEnd
    );
    // "How many sales from here to buildPhaseEnd" — same `countSalesThrough` the manual planner's
    // `smartBuySaleCount` (useResearchViews.ts) uses, counted from THIS cycle's own `absTime` rather
    // than the whole ascension's start, so the note reads the same "sales remaining in this ride"
    // way a human clicking the button repeatedly would see it count down cycle to cycle.
    const saleCount = countSalesThrough(absTime, buildPhaseEnd);
    executePlanToLevels(
      plan.entries.map(e => e.researchId),
      plan.endLevels,
      Math.max(0, targetDeadline - absTime),
      (purchaseCount, totalGemsSpent, elapsedSeconds) =>
        buildSaleAwareBuyNotePayload(purchaseCount, saleCount, elapsedSeconds, totalGemsSpent)
    );
  };

  // "Buy Until Sale Ends" (earnings prelude + delivery research through `deadline`) — same plan the
  // manual planner's button executes.
  const buyUntilSaleEnds = (deadline: number) => {
    const snapshot = computeSnapshot(currentState, context, { skipGrowth: true });
    const absTime = getAbsTime();
    const plan = simulateSaleEndsBuy(
      currentState.researchLevels,
      snapshot,
      context,
      getModifiers(),
      absTime,
      deadline,
      'realistic',
      'efficiency',
      context.rawBackup
    );
    executePlanToLevels(
      plan.researchIds,
      plan.endLevels,
      Math.max(0, deadline - absTime),
      (purchaseCount, totalGemsSpent, elapsedSeconds) =>
        buildSaleEndsBuyNotePayload(purchaseCount, elapsedSeconds, totalGemsSpent)
    );
  };

  // Fills the idle gap — if any — between wherever `buyUntilSaleWarning` stopped and the ride's
  // FINAL sale's own start (`finalSaleStart`, always this call's own `nextSaleStart` from the loop
  // below, and always equal to `getSaleStartForEnd(buildPhaseEnd)`) with delivery-relevant research
  // that's economical to buy now rather than wait for. Only ever called for the cycle immediately
  // before the final sale — see `simulateFinalSaleGapBuy`'s own doc comment (smartBuyPreview.ts) for
  // the full "why" and why this doesn't generalize to gaps before any of the ride's earlier sales
  // (only the final sale's own eventual `buyUntilSaleEnds` outcome is known this far ahead).
  const buyFinalSaleGap = (finalSaleStart: number) => {
    const snapshot = computeSnapshot(currentState, context, { skipGrowth: true });
    const absTime = getAbsTime();
    const plan = simulateFinalSaleGapBuy(
      currentState.researchLevels,
      snapshot,
      context,
      getModifiers(),
      absTime,
      finalSaleStart,
      buildPhaseEnd,
      'realistic',
      'efficiency',
      context.rawBackup
    );
    executePlanToLevels(
      plan.purchases.map(p => p.researchId),
      plan.endLevels,
      Math.max(0, finalSaleStart - absTime),
      (purchaseCount, totalGemsSpent, elapsedSeconds) =>
        buildFinalSaleGapBuyNotePayload(purchaseCount, elapsedSeconds, totalGemsSpent)
    );
  };

  // 1. Shift to Curiosity
  const shifted = applyShiftAction(currentState, context, 'curiosity');
  currentState = shifted.state;
  actions.push(shifted.action);
  if (shifted.saleToggleAction) actions.push(shifted.saleToggleAction);

  // 1a. Opening smart-buy sweep — see this function's own top-level doc comment (step 1a) for why
  // this exists and why it's placed here, before step 2's Tier-13 attempt. Capped at the shift's
  // own overall deadline like everything else here, though in practice a 10-second-threshold sweep
  // finishes buying (or running out of candidates) far short of that.
  runStep(
    runSmartBuyForSeconds(
      currentState,
      context,
      OPENING_SMART_BUY_THRESHOLD_SECONDS,
      Math.max(0, buildPhaseEnd - getAbsTime())
    )
  );

  // 2 (only when requested): try to unlock Tier 13 before any of steps 3-4's own deliberate,
  // ROI-gated spending gets a chance to eat into the same budget. Safe to run after step 1a's sweep
  // despite `elapsedSeconds` no longer necessarily being 0 here — `runTierUnlockMilestone`/
  // `runResearchMilestoneIfWorthwhile` (via `createMilestoneShiftHelpers`) derive their own
  // absolute-time baseline from whatever `currentState` they're actually given at call time, not
  // from this function's own `elapsedSeconds`/`baseAbsTime`, so they stay correct however much of
  // this shift's clock step 1a already spent.
  if (params.attemptTier13Unlock) {
    const maxTier = Math.max(...getTiers());

    // Attempts to unlock Tier 13 alone (no ML2 involvement), capped at whatever's left of
    // buildPhaseEnd. Returns whether Tier 13 ended up unlocked.
    const attemptTier13Only = (): boolean => {
      if (!isTierUnlocked(currentState.researchLevels, maxTier)) {
        const timeLimit = Math.max(0, buildPhaseEnd - getAbsTime());
        runStep(runTierUnlockMilestone(currentState, context, maxTier, timeLimit, roiDeadline, true));
      }
      return isTierUnlocked(currentState.researchLevels, maxTier);
    };

    if (!isTierUnlocked(currentState.researchLevels, maxTier)) {
      const neededML2 = (currentState.researchLevels[MULTI_LAYERING_ID] || 0) < MULTI_LAYERING_TARGET_LEVEL;

      // Snapshot right after the Curiosity shift, in case the ML2-first attempt below runs out of
      // runway and this needs to rewind and retry Tier 13 alone.
      const postShiftState = currentState;
      const postShiftElapsedSeconds = elapsedSeconds;
      const postShiftActionsLength = actions.length;

      // Multiversal Layering 2 (10x egg value, tier 11) is cheap relative to the rest of a Tier 13
      // push, so grab it first if it isn't already there — reusing the same milestone-view "research
      // level target" helper the manual planner's Milestones view buys through
      // (`runResearchMilestoneIfWorthwhile`, gated on `computeResearchMilestoneChain`), with an
      // unbounded worthwhileness threshold since this is an unconditional attempt, not a
      // worthwhile-or-skip decision. This is a soft preference, not a hard requirement — see this
      // function's doc comment — so a failure to reach level 2 within the remaining budget doesn't
      // return early here; it just means the Tier 13 attempt right after it is very unlikely to also
      // fit, which the fallback below handles.
      //
      // Staged in two separate milestone-chain calls, level 1 then level 2, rather than one call
      // straight to level 2: when ML1 hasn't been bought yet, targeting level 2 directly risks the
      // whole attempt landing as a single all-or-nothing chain, so a run that can't fully clear level
      // 2 within budget would leave ML at level 0 — not even level 1 grabbed — despite level 1 alone
      // likely being cheap enough to fit easily. Going for level 1 first guarantees that cheap win is
      // banked on its own before the (pricier) level-2 attempt gets a chance to run out of runway.
      if (neededML2) {
        if ((currentState.researchLevels[MULTI_LAYERING_ID] || 0) < MULTI_LAYERING_LEVEL_1) {
          const level1TimeLimit = Math.max(0, buildPhaseEnd - getAbsTime());
          runStep(
            runResearchMilestoneIfWorthwhile(
              currentState,
              context,
              MULTI_LAYERING_ID,
              MULTI_LAYERING_LEVEL_1,
              Infinity,
              level1TimeLimit,
              roiDeadline
            )
          );
        }

        const timeLimit = Math.max(0, buildPhaseEnd - getAbsTime());
        runStep(
          runResearchMilestoneIfWorthwhile(
            currentState,
            context,
            MULTI_LAYERING_ID,
            MULTI_LAYERING_TARGET_LEVEL,
            Infinity,
            timeLimit,
            roiDeadline
          )
        );
      }

      let gotTier13 = attemptTier13Only();

      if (!gotTier13 && neededML2) {
        // ML2 + Tier 13 together didn't fit before buildPhaseEnd. Rewind to right after the shift and
        // retry, spending the *entire* remaining budget on Tier 13 alone this time — going straight
        // for Tier 13 may still make the deadline even when detouring through ML2 first wouldn't.
        currentState = postShiftState;
        elapsedSeconds = postShiftElapsedSeconds;
        actions.length = postShiftActionsLength;
        gotTier13 = attemptTier13Only();
      }

      // Tier 13 was requested but neither approach finished in time — this variant is impossible.
      // Return now rather than continuing into the sale-riding steps against a state that doesn't
      // have what was asked for; runC3Variants recognizes this from the returned state.
      if (!gotTier13) {
        return { actions, elapsedSeconds, endState: currentState };
      }
    }
  }

  // 3-4. Ride out sales until the final one, then spend it on delivery research.
  while (getAbsTime() < buildPhaseEnd) {
    const absTime = getAbsTime();
    const isFinalSale = isResearchSaleActive(absTime) && getNextSaleEnd(absTime) >= buildPhaseEnd;

    if (isFinalSale) {
      // No trailing wait to buildPhaseEnd here: once nothing more is worth buying, there's nothing
      // productive left for C3 to do — the next shift (K3) already waits out any remaining time
      // against this same buildPhaseEnd itself, so padding the clock here would just be redundant.
      buyUntilSaleEnds(buildPhaseEnd);
      break;
    }

    const nextSaleStart = getNextSaleStart(absTime);
    if (nextSaleStart >= buildPhaseEnd) {
      // No more sales start before the deadline (shouldn't normally happen — `buildPhaseEnd` is
      // always an exact sale-end — but kept as a defensive fallback). Spend what's left as a final
      // delivery push; same no-trailing-wait reasoning as the `isFinalSale` branch above.
      buyUntilSaleEnds(buildPhaseEnd);
      break;
    }

    buyUntilSaleWarning(nextSaleStart);

    // `nextSaleStart` is itself the ride's final sale's start whenever that sale's own end reaches
    // `buildPhaseEnd` — same test `isFinalSale` above runs against `absTime`, just one sale-start
    // ahead. Whatever's left of the gap between here and `nextSaleStart` (`buyUntilSaleWarning` may
    // have run out of qualifying candidates well before its own deadline) is otherwise wasted, idle
    // time — see `buyFinalSaleGap`'s own doc comment for why this only applies to THIS cycle, never
    // an earlier one.
    if (getNextSaleEnd(nextSaleStart) >= buildPhaseEnd) {
      buyFinalSaleGap(nextSaleStart);
    }

    advanceTime(Math.max(0, nextSaleStart - getAbsTime()));
  }

  return { actions, elapsedSeconds, endState: currentState };
}

export interface C3Variant {
  saleCount: number;
  attemptTier13Unlock: boolean;
  buildPhaseEnd: number;
  result: ShiftResult;
  // True when attemptTier13Unlock was requested but the returned state still doesn't have it.
  impossible: boolean;
}

/**
 * Runs C3 against every combination of `saleCount` (1..maxSaleCount) and, when Tier 13 isn't
 * already unlocked, `attemptTier13Unlock` (false/true) — the candidate set a caller picks the best
 * of by completing each variant through the rest of the ascension and comparing total duration.
 *
 * Walks `saleCount` in descending order so Tier 13 feasibility can be pruned: more time can only
 * make an unlock easier, never harder, so once a larger `saleCount` proves Tier 13 impossible, no
 * smaller `saleCount`'s Tier 13 attempt is even run — those `N-sale-tier13` combos are simply
 * absent from the returned array (not present with `impossible: true`).
 *
 * For a given `saleCount`, the Tier 13 attempt (when one is made at all) always runs BEFORE the
 * non-Tier-13 one, and the non-Tier-13 variant is skipped entirely whenever that attempt succeeds:
 * a successful Tier 13 unlock strictly dominates not unlocking it (same total build-phase time
 * spent either way, strictly more research afterward), so the non-Tier-13 sibling can never win the
 * caller's comparison and isn't worth the cost of computing (here, and — more importantly — of the
 * caller's own full ascension completion downstream). The non-Tier-13 variant is still computed
 * whenever Tier 13 wasn't attempted at all for this `saleCount` (already unlocked before C3 started,
 * or pruned via `tier13KnownImpossible`) or was attempted and failed — that's the only case it can
 * legitimately win. Returned in ascending `saleCount` order regardless of the internal descending
 * walk, so callers see a stable, predictable order.
 *
 * `skipTier13Attempts`, when true, treats Tier 13 as known-impossible from the start — no
 * `attemptTier13Unlock` variant is ever run, for any `saleCount`. Callers set this for ascensions
 * that start with too little TE for a Tier 13 unlock to be realistic in the first place (see the
 * caller's own threshold), purely to avoid paying for simulations that would virtually always come
 * back impossible anyway.
 */
export function runC3Variants(
  startState: EngineState,
  context: SimulationContext,
  maxSaleCount: number = 3,
  skipTier13Attempts: boolean = false
): C3Variant[] {
  const maxTier = Math.max(...getTiers());
  const tier13AlreadyUnlocked = isTierUnlocked(startState.researchLevels, maxTier);
  const variants: C3Variant[] = [];
  const variantTimings: { name: string; ms: number }[] = [];
  let tier13KnownImpossible = skipTier13Attempts;
  for (let saleCount = maxSaleCount; saleCount >= 1; saleCount--) {
    const buildPhaseEnd = getBuildPhaseEndForSaleCount(context.ascensionStartTime, saleCount);

    let tier13SucceededThisSaleCount = false;
    if (!tier13AlreadyUnlocked && !tier13KnownImpossible) {
      const t0 = performance.now();
      const result = runC3(startState, context, buildPhaseEnd, undefined, { attemptTier13Unlock: true });
      variantTimings.push({ name: `${saleCount}-sale-tier13`, ms: performance.now() - t0 });
      const impossible = !isTierUnlocked(result.endState.researchLevels, maxTier);
      if (impossible) {
        tier13KnownImpossible = true;
      } else {
        tier13SucceededThisSaleCount = true;
      }
      variants.push({ saleCount, attemptTier13Unlock: true, buildPhaseEnd, result, impossible });
    }

    if (!tier13SucceededThisSaleCount) {
      const t0 = performance.now();
      const result = runC3(startState, context, buildPhaseEnd, undefined, { attemptTier13Unlock: false });
      variantTimings.push({ name: `${saleCount}-sale`, ms: performance.now() - t0 });
      variants.push({ saleCount, attemptTier13Unlock: false, buildPhaseEnd, result, impossible: false });
    }
  }

  if (DEBUG_SHIFT_TIMING) {
    const totalMs = variantTimings.reduce((sum, t) => sum + t.ms, 0);
    console.log(
      `[runC3Variants] ${totalMs.toFixed(1)}ms total\n` +
        variantTimings.map(t => `  ${t.name}: ${t.ms.toFixed(1)}ms`).join('\n')
    );
  }

  return variants.sort(
    (a, b) => a.saleCount - b.saleCount || Number(a.attemptTier13Unlock) - Number(b.attemptTier13Unlock)
  );
}
