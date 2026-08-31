import {
  type CommonResearch,
  getCommonResearches,
  getResearchById,
  getDiscountedVirtuePrice,
  isTierUnlocked,
  type ResearchCostModifiers,
} from './commonResearch';
import {
  getSaleAwareTimeToSave,
  calculateResearchROI,
  findEventCrossings,
  type PurchaseEventCrossings,
} from './researchROI';
import {
  rankResearchByROI,
  buildRoiCandidateSequences,
  simulatePurchaseSequence,
  reorderPurchaseListByROI,
  type SequencedPurchase,
  type ResearchRankingItem,
} from './researchRanking';
import { simulateSaleAwareBuy } from './smartBuyPreview';
import type { EngineState, SimulationContext } from '@/engine/types';
import type { CalculationsSnapshot } from '@/types';
import { computeSnapshot } from '@/engine/compute';
import { createBaseEngineState } from '@/engine/adapter';
import { applyAction, applyTime, boostTransitionsFrom } from '@/engine/apply';
import { getNextSaleStart, isResearchSaleActive, isEarningsBoostActive } from '@/lib/events';
import { DEBUG_MILESTONE_CHAIN } from '@/lib/debugFlags';

export type MilestoneTarget =
  | { kind: 'tier'; tier: number }
  | { kind: 'research'; researchId: string; targetLevel: number };

export function isMilestoneReached(target: MilestoneTarget, researchLevels: Record<string, number>): boolean {
  return target.kind === 'tier'
    ? isTierUnlocked(researchLevels, target.tier)
    : (researchLevels[target.researchId] || 0) >= target.targetLevel;
}

const MILESTONE_MAX_STEPS = 2000;

// How many ROI-ranked candidates to try as a detour at each step before giving up and falling back
// to the non-detour path (buying the milestone target directly, or — for a tier chain — finishing
// via cheapest-first). Previously only the single top-ranked candidate was ever tried: the instant
// it stopped beating the fallback, the chain committed to that fallback for good (see both call
// sites' doc comments), even when a lower-ranked-but-still-70%-worthwhile candidate would have kept
// helping. Capped rather than unbounded since every candidate tried costs a
// `simulatePurchaseSequence` call (up to 3, with its pair orderings) and this loop reruns every
// step — the cap only matters when NO candidate helps (the common case once a chain is winding
// down), where every candidate up to the cap gets tried for nothing.
const MAX_DETOUR_CANDIDATES_PER_STEP = 15;

export interface MilestoneChainItem {
  research: CommonResearch;
  targetLevel: number;
  currentLevel: number;
  price: number;
  timeToBuySeconds: number;
  buyToHereSeconds: number;
  roiSeconds?: number;
  totalRoiSeconds?: number;
  showSaleWarning?: boolean;
  showDeadlineWarning?: boolean;
  // Whether this purchase's price reflects a research sale, and whether it completed during a
  // 2x earnings boost — distinct from showSaleWarning/showDeadlineWarning, which mean "you should
  // hold off," not "this happened during an event."
  duringSale: boolean;
  duringEarningsBoost: boolean;
  // Which event boundaries (if any) this purchase's own wait crosses while saving up — e.g. a
  // purchase that starts before the 2x boost but doesn't finish until after it starts. Lets the
  // preview show the same wait/toggle split the manual planner inserts when actually executing it,
  // instead of only revealing that split after the user clicks "Buy".
  eventCrossings?: PurchaseEventCrossings;
}

export interface MilestoneChainResult {
  items: MilestoneChainItem[];
  reached: boolean;
  totalSeconds: number;
}

// Pure crash-safety net for `computeResearchMilestoneChain`'s sweep loop below — NOT a "give up
// after N sale cycles" heuristic (there isn't one anymore; the loop sweeps as many weeks as it
// takes). Only exists so a genuinely-never-terminating case (e.g. a bug that makes every sweep
// unproductive forever) fails loudly/boundedly instead of hanging the worker tab indefinitely.
// 5000 weekly sweeps is ~96 years — nothing a real milestone should ever need.
const MAX_SALE_SWEEPS_SAFETY_CAP = 5000;

function debugTime(t: number): string {
  return new Date(t * 1000).toISOString();
}

/**
 * Buys every currently-eligible 70%-by-next-sale-payback research, until nothing more qualifies —
 * does NOT itself advance time any further than that (see `computeResearchMilestoneChain`'s own
 * doc comment for why: idle-forwarding straight to the sale boundary, before ever giving a
 * same-cycle detour a chance to run at the earlier, correct point in time, is exactly what let
 * detour candidates get mispriced as sale-discounted when they'd actually be bought at full price
 * well before the sale — the caller now owns deciding when idle-forwarding is actually necessary).
 *
 * Delegates candidate SELECTION/ORDER (which research, in what sequence) to `simulateSaleAwareBuy`
 * (`smartBuyPreview.ts`, `targetPercent: 70`) — the exact same dry run behind the manual planner's
 * own "Buy Until Sale Warning" button — rather than re-deriving that ranking logic here. The actual
 * price/wait/`duringSale` NUMBERS for each selected purchase are NOT taken from that dry run,
 * though — see the doc comment further down, at the replay loop, for why. It doesn't exclude the
 * milestone's own target research from consideration — if the target itself happens to be the
 * best-ROI candidate clearing the 70% bar, buying it here is a perfectly good outcome (the caller's
 * next direct-purchase check will simply see it already reached).
 */
function sweepUntilNextSale(
  state: EngineState,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteSimTimeAtStart: number,
  researchSaleDeadline: number,
  // Forwarded to `simulateSaleAwareBuy`'s own `roiDeadlineOverride` — see its doc comment.
  roiDeadlineOverride: number | undefined
): { items: MilestoneChainItem[]; state: EngineState; snapshot: CalculationsSnapshot; totalSeconds: number } {
  const nextSaleStart = getNextSaleStart(absoluteSimTimeAtStart);

  if (DEBUG_MILESTONE_CHAIN) {
    console.log(
      `[milestoneChain] sweepUntilNextSale: from ${debugTime(absoluteSimTimeAtStart)} to ${debugTime(nextSaleStart)}, bank=${snapshot.bankValue}, offlineEarnings=${snapshot.offlineEarnings}`
    );
  }

  const plan = simulateSaleAwareBuy(
    state.researchLevels,
    snapshot,
    context,
    mods,
    absoluteSimTimeAtStart,
    researchSaleDeadline,
    nextSaleStart,
    'immediate',
    false,
    70,
    roiDeadlineOverride
  );

  if (DEBUG_MILESTONE_CHAIN) {
    console.log(
      `[milestoneChain] sweepUntilNextSale: simulateSaleAwareBuy returned ${plan.entries.length} entries:`,
      plan.entries.map(
        e => `${e.researchId}@${debugTime(e.purchaseTimestamp)} (duringSale=${e.duringSale}, price=${e.price})`
      )
    );
  }

  // `simulateSaleAwareBuy` can accept one final "transitional" purchase whose own wait crosses INTO
  // the target sale, then revert it during its own cleanup pass if it actually completes at/after
  // `nextSaleStart` (see that function's doc comment) — the reverted entry is still present in
  // `plan.entries` (so callers wanting the full history can see it), but isn't reflected in
  // `endLevels`/`endSnapshot`. Its internal `revertIds` aren't exposed, but the same predicate it
  // reverts by (`duringSale` AND landing at/after the deadline) is externally derivable from each
  // entry, so this sweep only replays entries that actually landed.
  const acceptedEntries = plan.entries.filter(e => !(e.duringSale && e.purchaseTimestamp >= nextSaleStart));

  // Rebuild the resulting state/time by replaying only the ACCEPTED entries' *research/order* — not
  // their price, timing, or `duringSale` flag, all of which get recomputed fresh here via
  // `getSaleAwareTimeToSave`, exactly the way `syncEventStateForItem` (ResearchActions.vue)
  // recomputes each purchase live at actual execution time. `simulateSaleAwareBuy`'s own internal
  // numbers, batch-computed once, can drift from what a live, self-correcting run will actually do —
  // confirmed in practice: a purchase modeled as landing during the sale (a good deal worth waiting
  // for) turned out, once accumulated earnings actually caught up purchase-by-purchase, to be
  // cheaper bought immediately at full price instead, well before the sale even started. Trusting
  // the batch numbers meant the preview didn't just show a slightly-off ETA, it showed a wrong
  // `duringSale` flag and an understated gems-spent total for those purchases. Re-deriving each
  // number from THIS function's own accumulating `resultState`/`resultSnapshot` — the same one the
  // milestone chain actually returns — keeps the preview and the eventual live execution answering
  // the identical question at each step, instead of two independent (and occasionally
  // disagreeing) calculations.
  let resultState = state;
  let resultSnapshot = snapshot;
  const items: MilestoneChainItem[] = [];
  let itemTimestamp = absoluteSimTimeAtStart;

  for (const entry of acceptedEntries) {
    const research = getResearchById(entry.researchId);
    if (!research) continue;
    const currentLevel = resultState.researchLevels[entry.researchId] || 0;

    const isSale = isResearchSaleActive(itemTimestamp);
    const transitions = boostTransitionsFrom(resultSnapshot, itemTimestamp);
    const purchase = getSaleAwareTimeToSave(
      research,
      currentLevel,
      mods,
      isSale,
      itemTimestamp,
      resultSnapshot,
      transitions
    );
    if (purchase.waitSeconds === Infinity) break;

    resultState = applyAction(resultState, {
      type: 'buy_research',
      payload: { researchId: entry.researchId, fromLevel: currentLevel, toLevel: currentLevel + 1 },
      cost: purchase.price,
    });
    resultState = applyTime(resultState, purchase.waitSeconds, resultSnapshot, { transitions });
    resultSnapshot = computeSnapshot(resultState, context, { skipEpochConversion: true });

    const completesAt = itemTimestamp + purchase.waitSeconds;
    items.push({
      research,
      targetLevel: currentLevel + 1,
      currentLevel,
      price: purchase.price,
      timeToBuySeconds: purchase.waitSeconds,
      buyToHereSeconds: completesAt - absoluteSimTimeAtStart,
      duringSale: purchase.duringSale,
      duringEarningsBoost: isEarningsBoostActive(completesAt),
    });
    itemTimestamp = completesAt;
  }

  const totalSeconds = itemTimestamp - absoluteSimTimeAtStart;

  if (DEBUG_MILESTONE_CHAIN) {
    console.log(
      `[milestoneChain] sweepUntilNextSale: DONE, replayed ${items.length} of ${acceptedEntries.length} accepted entries, totalSeconds=${totalSeconds} (${(totalSeconds / 86400).toFixed(2)}d), ends at ${debugTime(absoluteSimTimeAtStart + totalSeconds)}`
    );
  }

  return { items, state: resultState, snapshot: resultSnapshot, totalSeconds };
}

/**
 * Advances `state`/`snapshot` by pure idle waiting, from `absoluteSimTimeAtStart` to `targetTime` —
 * no purchases, just elapsed time (and whatever passive earnings accrue over it). Used by
 * `computeResearchMilestoneChain` as the last-resort fallback once neither a detour nor a sweep
 * finds anything more to buy before a sale boundary, to guarantee the outer loop always makes
 * forward progress rather than re-trying the same instant forever.
 */
function idleForwardTo(
  state: EngineState,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  absoluteSimTimeAtStart: number,
  targetTime: number
): { state: EngineState; snapshot: CalculationsSnapshot; totalSeconds: number } {
  const idleSeconds = targetTime - absoluteSimTimeAtStart;
  if (idleSeconds <= 0) return { state, snapshot, totalSeconds: 0 };

  const transitions = boostTransitionsFrom(snapshot, absoluteSimTimeAtStart);
  const newState = applyTime(state, idleSeconds, snapshot, { transitions });
  // `skipEpochConversion` keeps `lastStepTime` in `snapshot`'s own reference frame — see
  // `smartBuyPreview.ts`'s `simulateSaleAwareBuy` for the full story on why a mid-loop epoch flip
  // here would corrupt the elapsed-time bookkeeping the caller derives from before/after snapshots.
  const newSnapshot = computeSnapshot(newState, context, { skipEpochConversion: true });

  return { state: newState, snapshot: newSnapshot, totalSeconds: idleSeconds };
}

/**
 * Shared candidate-selection core behind both `computeResearchMilestoneChain`'s detour step and
 * `computeTierMilestoneChain`'s — the two used to maintain independent copies of the same
 * rank-filter-try-sequences loop. Finds the single best OTHER research purchase (or ROI-paired
 * sequence, see `buildRoiCandidateSequences`) worth taking before `fallbackSeconds` (the caller's
 * own "do nothing extra" completion time, e.g. buying the milestone target directly, or finishing a
 * tier via cheapest-first) elapses.
 *
 * A candidate is even considered if it clears TWO bars on its own economics (not on whether it
 * happens to help the caller's specific goal): `!showSaleWarning` — the same "pays back 70% of its
 * cost before the next research sale" rule "Buy Until Sale Warning" enforces — AND its own Achieve
 * ROI time (`totalRoiSeconds`, or `pairRoiSeconds` when this candidate only ranked well as a
 * bottleneck pair — see `rankResearchByROI`) is no later than `fallbackSeconds`. A candidate whose
 * pairing is what got it this far only makes sense bought AS that pair — trying its solo sequence
 * would silently accept a purchase whose OWN economics were never actually verified, so the solo
 * sequence is skipped whenever `pairRoiSeconds` is set. `ranked` is already sorted by this same
 * "fastest achieve ROI time" metric (`rankResearchByROI`'s own final sort), so filtering it
 * preserves that order — no separate sort needed.
 *
 * `scoreSequence` decides, per successfully-priced sequence, whether the caller actually wants it:
 * return `null` to reject, or a number (lower wins) to let this function pick the best among a
 * single candidate's own sequence variants (solo vs. either pair ordering) before moving on to the
 * next candidate. The research chain's own economics-only bar means any successfully-priced
 * sequence is already good enough (`() => 0`); the tier chain still needs to simulate what finishing
 * the tier afterward actually looks like, since a tier has no single expensive target whose own
 * clock a candidate's value can be judged against.
 */
function findRoiDetour(
  state: EngineState,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  currentAbsoluteTime: number,
  researchSaleDeadline: number,
  // Forwarded to `rankResearchByROI`'s own `roiDeadlineOverride` — see its doc comment.
  roiDeadlineOverride: number | undefined,
  fallbackSeconds: number,
  excludeResearchId: string | undefined,
  scoreSequence: (
    result: NonNullable<ReturnType<typeof simulatePurchaseSequence>>,
    afterAbsoluteTime: number
  ) => number | null
): {
  items: SequencedPurchase[];
  state: EngineState;
  snapshot: CalculationsSnapshot;
  totalSeconds: number;
  candidate: ResearchRankingItem;
} | null {
  const isSale = isResearchSaleActive(currentAbsoluteTime);
  const ranked = rankResearchByROI(
    state.researchLevels,
    snapshot,
    context,
    mods,
    isSale,
    currentAbsoluteTime,
    researchSaleDeadline,
    'immediate',
    false,
    roiDeadlineOverride
  );

  const eligibleCandidates = ranked.filter(item => {
    if (!item.canBuy || item.showSaleWarning) return false;
    if (excludeResearchId && item.research.id === excludeResearchId) return false;
    const achieveRoiSeconds =
      item.pairRoiSeconds !== undefined ? Math.min(item.totalRoiSeconds!, item.pairRoiSeconds) : item.totalRoiSeconds;
    return achieveRoiSeconds !== undefined && achieveRoiSeconds <= fallbackSeconds;
  });

  for (const candidate of eligibleCandidates.slice(0, MAX_DETOUR_CANDIDATES_PER_STEP)) {
    const sequences = buildRoiCandidateSequences(candidate, state.researchLevels, excludeResearchId);
    // See this function's own doc comment: a candidate that only qualified via pairing has no
    // verified solo economics, so its solo sequence (always first) is skipped entirely.
    const sequencesToTry = candidate.pairRoiSeconds !== undefined ? sequences.slice(1) : sequences;

    let best: { result: NonNullable<ReturnType<typeof simulatePurchaseSequence>>; score: number } | null = null;
    for (const sequence of sequencesToTry) {
      const result = simulatePurchaseSequence(sequence, state, snapshot, currentAbsoluteTime, mods, context);
      if (!result) continue;
      const afterTime = currentAbsoluteTime + result.totalSecondsSpent;
      const score = scoreSequence(result, afterTime);
      if (score !== null && (!best || score < best.score)) {
        best = { result, score };
      }
    }

    if (best) {
      return {
        items: best.result.items,
        state: best.result.state,
        snapshot: best.result.snapshot,
        totalSeconds: best.result.totalSecondsSpent,
        candidate,
      };
    }
  }

  return null;
}

/** Tags a `findRoiDetour` result's purchases with their ROI display fields and relative
 *  `buyToHereSeconds`, the same convention `sweepUntilNextSale`'s items use — the caller rebases
 *  them onto its own running total. */
function tagDetourItems(items: SequencedPurchase[], candidate: ResearchRankingItem): MilestoneChainItem[] {
  const isPair = items.length > 1;
  let totalSeconds = 0;
  return items.map(purchase => {
    totalSeconds += purchase.timeToBuySeconds;
    return {
      ...purchase,
      buyToHereSeconds: totalSeconds,
      // A paired purchase's own solo `roiSeconds`/`totalRoiSeconds` (near-infinite, since that's
      // exactly why it needed pairing to be worth taking) would be misleading here — show the
      // combined figure that actually justified buying it instead.
      roiSeconds: isPair ? candidate.pairRoiSeconds : candidate.roiSeconds,
      totalRoiSeconds: isPair ? candidate.pairRoiSeconds : candidate.totalRoiSeconds,
      showSaleWarning: candidate.showSaleWarning,
      showDeadlineWarning: candidate.showDeadlineWarning,
    };
  });
}

/**
 * Reaches a specific research level milestone as fast as possible, one level at a time. At every
 * step, in order:
 *
 * 0. Compute buying the target directly right now (`calculateResearchROI` — internally sale-aware,
 *    choosing whichever's faster between today's price and a future discount — and gives us the
 *    target's own `earningsDelta`/`showSaleWarning` alongside the price/wait, so a single call
 *    covers what used to be a separate `getSaleAwareTimeToSave` call too).
 * 1-2. Try a same-cycle DETOUR (`findRoiDetour`): a cheap purchase bought FIRST whose OWN economics
 *    clear the 70%-by-next-sale bar and fully pay back (`totalRoiSeconds`, or the pair-adjusted
 *    equivalent) no later than the target's own direct-buy time from step 0. Tried unconditionally,
 *    whether or not the target is reachable this cycle: a detour can shorten a calendar-locked wait
 *    too. Any candidate clearing both bars is taken — there's no separate "does this actually get
 *    the target sooner" simulation on top, because a purchase that's already fully paid for itself
 *    by the point the target would've arrived anyway can't leave the target worse off, and every
 *    second after keeps compounding at the new, higher earn rate.
 * 3. If the target's direct purchase completes STRICTLY before the very next research sale starts,
 *    no detour helped, AND — for research that actually produces earnings — buying now would itself
 *    clear the same 70%-by-next-sale bar, buy it.
 * 4. Otherwise — the direct purchase lands at/after the next sale, or lands before it but wouldn't
 *    earn back 70% of its own cost in time (buying a couple minutes before the sale at full price,
 *    when waiting those couple minutes would have meant 70% off, is never worth it) — sweep for
 *    more purchases that clear the 70%-by-next-sale bar (`sweepUntilNextSale`, mirroring what a
 *    player manually running "Buy Until Sale Warning" would do), WITHOUT jumping straight to the
 *    sale boundary. If the sweep finds anything, take it and go back to step 0 — a denser
 *    bank/higher earnings rate may unlock a detour, or direct reachability, that didn't apply before.
 * 5. Only when NEITHER a detour NOR a sweep purchase helps does the loop finally idle-forward to the
 *    next sale boundary (`idleForwardTo`) and retry from there — repeating this for as many sale
 *    cycles as it actually takes (see `MAX_SALE_SWEEPS_SAFETY_CAP`'s own comment — there's no "give
 *    up after N cycles" heuristic here) is what lets the milestone discover "abandon waiting for any
 *    particular sale, spend a couple of weeks sweeping instead, and buy at full price before the
 *    next one even arrives" — a global strategy shift a straight one-shot `getSaleAwareTimeToSave`
 *    call could never find on its own.
 *
 * Steps 1-2 and 5 used to be reversed — sweep-then-idle-forward-to-the-boundary ran BEFORE the
 * detour check ever got a chance to run, meaning every detour candidate got evaluated as if it
 * would be bought "at the boundary" (often during a research sale, hence sale-discounted). Trying
 * the detour check at every step, before any idle-forwarding happens, fixed the common case, but a
 * subtler version of the same bug survived: `showSaleWarning`'s deadline is always "the NEXT sale,"
 * and idle-forwarding INTO a sale pushes that deadline a full cycle further out (today's ~1-hour
 * runway becomes next week's ~7-day runway) — so a purchase genuinely rejected minutes before a
 * sale can pass easily the instant the loop lands inside it, purely because the deadline itself
 * moved, not because anything about the purchase changed. Confirmed against a live execution log:
 * detours "discovered" only after such an idle-forward got bought by live execution BEFORE the sale
 * anyway (money compounds continuously; live execution never idle-forwards), at full price instead
 * of the discount the plan assumed. Step 3's own 70%-by-next-sale gate on the target purchase closes
 * the same gap for the final purchase specifically: without it, a target that's merely FASTER to buy
 * now than to wait (which is all `calculateResearchROI` alone optimizes for) would jump the gun by a
 * few minutes rather than taking the discount, exactly the "5 minutes before the sale" case the
 * detour-side fix already exists to prevent.
 */
export function computeResearchMilestoneChain(
  target: { researchId: string; targetLevel: number },
  startState: EngineState,
  startSnapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteSimTimeAtStart: number,
  researchSaleDeadline: number,
  // Forwarded to `rankResearchByROI`'s own `roiDeadlineOverride` (via `findRoiDetour`/
  // `sweepUntilNextSale`) and to the target's own direct-buy ROI check below — see its doc comment.
  // Omitted (manual/default callers): every purchase must clear 70% ROI by the calendar's very next
  // sale. Supplied (C3, already committed to riding out several sales): a later deadline, so a
  // purchase gets judged against the runway actually available.
  roiDeadlineOverride?: number
): MilestoneChainResult {
  const targetResearch = getResearchById(target.researchId);
  if (!targetResearch) return { items: [], reached: false, totalSeconds: 0 };

  let state = startState;
  let snapshot = startSnapshot;
  let totalSeconds = 0;
  const items: MilestoneChainItem[] = [];

  // `items.length < MILESTONE_MAX_STEPS` bounds total PURCHASES (shared with every other
  // milestone-chain loop in this file). `round` is purely `MAX_SALE_SWEEPS_SAFETY_CAP`'s crash
  // guard — see that constant's own comment — not a heuristic budget.
  let round = 0;

  const rebaseAndPush = (newItems: MilestoneChainItem[]) => {
    for (const item of newItems) {
      items.push({ ...item, buyToHereSeconds: totalSeconds + item.buyToHereSeconds });
    }
  };

  while (
    items.length < MILESTONE_MAX_STEPS &&
    round < MAX_SALE_SWEEPS_SAFETY_CAP &&
    (state.researchLevels[targetResearch.id] || 0) < target.targetLevel
  ) {
    round++;
    const currentAbsoluteTime = absoluteSimTimeAtStart + totalSeconds;
    const isSale = isResearchSaleActive(currentAbsoluteTime);
    const transitions = boostTransitionsFrom(snapshot, currentAbsoluteTime);
    const currentLevel = state.researchLevels[targetResearch.id] || 0;
    const nextSaleStart = getNextSaleStart(currentAbsoluteTime);

    // Step 0: price the target directly. `calculateResearchROI` already runs `getSaleAwareTimeToSave`
    // internally (choosing whichever's faster, buying now or waiting for a discount) and additionally
    // gives us `earningsDelta`/`showSaleWarning`, needed below for step 3's gate.
    const targetRoi = calculateResearchROI({
      research: targetResearch,
      level: currentLevel,
      mods,
      snapshot,
      context,
      eventTiming: {
        absoluteSimTime: currentAbsoluteTime,
        // `Math.max`, not a plain `??` — see `rankResearchByROI`'s identical comment: a fixed
        // override computed once up front can go stale relative to next sale start as rounds
        // advance, so it should only ever grant MORE runway than the calendar default, never less.
        roiDeadline: roiDeadlineOverride !== undefined ? Math.max(roiDeadlineOverride, nextSaleStart) : nextSaleStart,
        researchSaleDeadline,
        isSaleActive: isSale,
        transitions,
      },
    });

    if (DEBUG_MILESTONE_CHAIN) {
      console.log(
        `[milestoneChain] computeResearchMilestoneChain round ${round}: now=${debugTime(currentAbsoluteTime)}, targetLevel=${currentLevel}, direct purchase price=${targetRoi.price}, waitSeconds=${targetRoi.timeToBuySeconds} (${isFinite(targetRoi.timeToBuySeconds) ? (targetRoi.timeToBuySeconds / 86400).toFixed(2) + 'd' : 'Infinity'}), duringSale=${targetRoi.duringSale}, earningsDelta=${targetRoi.earningsDelta}, showSaleWarning=${targetRoi.showSaleWarning}`
      );
    }

    if (targetRoi.timeToBuySeconds === Infinity) {
      if (DEBUG_MILESTONE_CHAIN)
        console.log(`[milestoneChain] computeResearchMilestoneChain: timeToBuySeconds is Infinity, giving up`);
      break;
    }

    // Steps 1-2: always try a detour first, regardless of whether the target is reachable this
    // cycle. Any candidate/sequence that successfully prices out is good enough — eligibility
    // (`findRoiDetour`'s own filter) already verified its economics hold up on their own.
    const detour = findRoiDetour(
      state,
      snapshot,
      context,
      mods,
      currentAbsoluteTime,
      researchSaleDeadline,
      roiDeadlineOverride,
      targetRoi.timeToBuySeconds,
      targetResearch.id,
      () => 0
    );
    if (detour) {
      if (DEBUG_MILESTONE_CHAIN) {
        console.log(
          `[milestoneChain] computeResearchMilestoneChain round ${round}: DETOUR — ${detour.items.map(i => i.research.id).join(', ')}, direct wait was ${targetRoi.timeToBuySeconds}s`
        );
      }
      rebaseAndPush(tagDetourItems(detour.items, detour.candidate));
      state = detour.state;
      snapshot = detour.snapshot;
      totalSeconds += detour.totalSeconds;
      continue;
    }

    const completesAt = currentAbsoluteTime + targetRoi.timeToBuySeconds;
    // For research that doesn't actually move earnings (earningsDelta <= 0 — the ROI gate is
    // meaningless for it), reachability alone is enough; for earnings research, the purchase also
    // has to clear the same 70%-by-next-sale bar every detour candidate is held to (see this
    // function's own doc comment for why — a target buyable a few minutes early at full price
    // shouldn't jump the gun on a sale that would've made it 70% cheaper).
    const isEarningsResearch = targetRoi.earningsDelta > 0;
    const targetClearsRoiGate = !isEarningsResearch || !targetRoi.showSaleWarning;

    if (completesAt < nextSaleStart && targetClearsRoiGate) {
      if (DEBUG_MILESTONE_CHAIN) {
        console.log(
          `[milestoneChain] computeResearchMilestoneChain round ${round}: DIRECT BUY — completesAt=${debugTime(completesAt)} < nextSaleStart=${debugTime(nextSaleStart)}`
        );
      }
      totalSeconds += targetRoi.timeToBuySeconds;
      state = applyAction(state, {
        type: 'buy_research',
        payload: { researchId: targetResearch.id, fromLevel: currentLevel, toLevel: currentLevel + 1 },
        cost: targetRoi.price,
      });
      state = applyTime(state, targetRoi.timeToBuySeconds, snapshot, { transitions });
      // See `sweepUntilNextSale`'s identical comment on why this needs `skipEpochConversion: true`.
      snapshot = computeSnapshot(state, context, { skipEpochConversion: true });

      items.push({
        research: targetResearch,
        targetLevel: currentLevel + 1,
        currentLevel,
        price: targetRoi.price,
        timeToBuySeconds: targetRoi.timeToBuySeconds,
        buyToHereSeconds: totalSeconds,
        duringSale: targetRoi.duringSale,
        duringEarningsBoost: isEarningsBoostActive(completesAt),
        eventCrossings: findEventCrossings(
          currentAbsoluteTime,
          targetRoi.timeToBuySeconds,
          isSale,
          isEarningsBoostActive(currentAbsoluteTime)
        ),
      });
      continue;
    }

    // Step 4: target is calendar-locked to a later sale (or wouldn't clear the ROI gate if bought
    // now), and no detour helps either — sweep for more 70%-eligible purchases WITHOUT jumping
    // ahead to the boundary yet.
    if (DEBUG_MILESTONE_CHAIN) {
      console.log(
        `[milestoneChain] computeResearchMilestoneChain round ${round}: SWEEP — completesAt=${debugTime(completesAt)}, nextSaleStart=${debugTime(nextSaleStart)}, targetClearsRoiGate=${targetClearsRoiGate}`
      );
    }

    const sweepResult = sweepUntilNextSale(
      state,
      snapshot,
      context,
      mods,
      currentAbsoluteTime,
      researchSaleDeadline,
      roiDeadlineOverride
    );
    if (sweepResult.items.length > 0) {
      rebaseAndPush(sweepResult.items);
      state = sweepResult.state;
      snapshot = sweepResult.snapshot;
      totalSeconds += sweepResult.totalSeconds;
      continue;
    }

    // Step 5: nothing helped at all this round — idle-forward to the boundary as a last resort, to
    // guarantee forward progress. The next round re-checks everything fresh from there: now inside
    // the sale, `nextSaleStart` itself rolls forward to the FOLLOWING week (see `getNextSaleStart`'s
    // "always strictly after" contract), so the target's own ROI check is naturally judged against a
    // full extra cycle of runway — no bypass needed for that, just the ordinary deadline math above.
    if (DEBUG_MILESTONE_CHAIN) {
      console.log(
        `[milestoneChain] computeResearchMilestoneChain round ${round}: IDLE-FORWARD to nextSaleStart=${debugTime(nextSaleStart)}`
      );
    }
    const idle = idleForwardTo(state, snapshot, context, currentAbsoluteTime, nextSaleStart);
    state = idle.state;
    snapshot = idle.snapshot;
    totalSeconds += idle.totalSeconds;
  }

  if (DEBUG_MILESTONE_CHAIN) {
    console.log(
      `[milestoneChain] computeResearchMilestoneChain: FINISHED after ${round} rounds, ${items.length} items, totalSeconds=${totalSeconds} (${(totalSeconds / 86400).toFixed(2)}d), reached=${(state.researchLevels[targetResearch.id] || 0) >= target.targetLevel}`
    );
  }

  return { items, reached: (state.researchLevels[targetResearch.id] || 0) >= target.targetLevel, totalSeconds };
}

// Tier-unlock milestone, cheapest-first strategy from an arbitrary starting point: buys whatever's
// cheapest (ignoring ROI) until the tier unlocks. Much cheaper to compute per step than the ROI
// strategy (just a price compare, no ROI/snapshot projection).
export function simulateCheapestFirstTierChain(
  state: EngineState,
  snapshot: CalculationsSnapshot,
  totalSecondsSoFar: number,
  target: { tier: number },
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteSimTimeAtStart: number
): MilestoneChainResult {
  let curState = state;
  let curSnapshot = snapshot;
  let totalSeconds = totalSecondsSoFar;
  const items: MilestoneChainItem[] = [];

  while (items.length < MILESTONE_MAX_STEPS && !isTierUnlocked(curState.researchLevels, target.tier)) {
    const currentAbsoluteTime = absoluteSimTimeAtStart + totalSeconds;
    const isSale = isResearchSaleActive(currentAbsoluteTime);
    const transitions = boostTransitionsFrom(curSnapshot, currentAbsoluteTime);

    const levels = curState.researchLevels;

    // Sorting by today's price (not sale-aware) is a deliberate, cheap-to-compute simplification —
    // this function's whole point is being fast (see its doc comment above), and re-evaluating
    // every candidate's sale-aware wait here would be the exact kind of hot-loop calendar-call
    // blowup Phase 2's performance regression already ran into. Only the chosen candidate's actual
    // price/wait (below) needs to be correct, since that's the only one that gets executed.
    const candidates = getCommonResearches()
      .filter(r => (levels[r.id] || 0) < r.levels && isTierUnlocked(levels, r.tier))
      .map(r => {
        const level = levels[r.id] || 0;
        return { research: r, level, price: getDiscountedVirtuePrice(r, level, mods, isSale) };
      });

    if (candidates.length === 0) break;

    candidates.sort((a, b) => a.price - b.price);
    const best = candidates[0];
    const bestPurchase = getSaleAwareTimeToSave(
      best.research,
      best.level,
      mods,
      isSale,
      currentAbsoluteTime,
      curSnapshot,
      transitions
    );
    const secondsToBuy = bestPurchase.waitSeconds;
    if (secondsToBuy === Infinity) break;

    totalSeconds += secondsToBuy;

    curState = applyAction(curState, {
      type: 'buy_research',
      payload: { researchId: best.research.id, fromLevel: best.level, toLevel: best.level + 1 },
      cost: bestPurchase.price,
    });
    curState = applyTime(curState, secondsToBuy, curSnapshot, { transitions });
    // See `sweepUntilNextSale`'s identical comment on why this needs `skipEpochConversion: true`.
    curSnapshot = computeSnapshot(curState, context, { skipEpochConversion: true });

    items.push({
      research: best.research,
      targetLevel: best.level + 1,
      currentLevel: best.level,
      price: bestPurchase.price,
      timeToBuySeconds: secondsToBuy,
      buyToHereSeconds: totalSeconds,
      duringSale: bestPurchase.duringSale,
      duringEarningsBoost: isEarningsBoostActive(currentAbsoluteTime + secondsToBuy),
    });
  }

  return { items, reached: isTierUnlocked(curState.researchLevels, target.tier), totalSeconds };
}

export function computeCheapestFirstTierChain(
  target: { tier: number },
  startSnapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteSimTimeAtStart: number
): MilestoneChainResult {
  return simulateCheapestFirstTierChain(
    createBaseEngineState(startSnapshot),
    startSnapshot,
    0,
    target,
    context,
    mods,
    absoluteSimTimeAtStart
  );
}

/**
 * Cheap upfront affordability gate for `computeTierMilestoneChain`: no purchase — ROI-motivated
 * detour or not — can cost less, in wait time from the CURRENT (not-yet-boosted) rate, than the
 * single cheapest currently-available research purchase. So if even that one doesn't fit in
 * `timeLimit`, literally zero purchases are possible, and building the full chain (up to
 * `MILESTONE_MAX_STEPS` items, the early ones each re-simulating the entire remaining chain from
 * scratch — see that function's own doc comment) is guaranteed to be wasted work.
 *
 * Deliberately narrow: this can only ever say "not even one purchase is affordable," never "the
 * whole chain is unreachable" — a pricier detour that raises the earnings rate can make every
 * purchase after it complete faster, so a plain cheapest-first-to-completion estimate is NOT a
 * valid lower bound on the full chain's time (that stronger-looking but unsound check was tried and
 * reverted — see git history on this function). Only the "can we make even a single purchase"
 * question is safe to answer cheaply, since compounding effects can't apply before any purchase has
 * happened yet.
 */
export function isCheapestTierPurchaseAffordable(
  researchLevels: Record<string, number>,
  snapshot: CalculationsSnapshot,
  mods: ResearchCostModifiers,
  absoluteSimTime: number,
  timeLimit: number
): boolean {
  const isSale = isResearchSaleActive(absoluteSimTime);

  const candidates = getCommonResearches()
    .filter(r => (researchLevels[r.id] || 0) < r.levels && isTierUnlocked(researchLevels, r.tier))
    .map(r => {
      const level = researchLevels[r.id] || 0;
      return { research: r, level, price: getDiscountedVirtuePrice(r, level, mods, isSale) };
    });

  if (candidates.length === 0) return false;

  candidates.sort((a, b) => a.price - b.price);
  const cheapest = candidates[0];
  const transitions = boostTransitionsFrom(snapshot, absoluteSimTime);
  const purchase = getSaleAwareTimeToSave(cheapest.research, cheapest.level, mods, isSale, absoluteSimTime, snapshot, transitions);

  return purchase.waitSeconds <= timeLimit;
}

// Tier-unlock milestone: every purchase (in an already-unlocked tier) counts toward the threshold,
// so there's no "wasted" purchase the way there is for a research-level target. But that doesn't
// mean ROI-first is always fastest — an expensive, high-ROI purchase only pays off if there's
// enough remaining runway for its earnings boost to matter; buying it when the milestone could
// instead be finished with a pile of purchases cheaper than it just wastes time saving up.
//
// At each step: compare (a) finishing via pure cheapest-first from here, against (b) buying the
// best `findRoiDetour` candidate now — solo, or as a two-purchase sequence with its
// bottleneck-paired partner when `rankResearchByROI` recommends one — then finishing via
// cheapest-first from THAT state (`findRoiDetour`'s own `scoreSequence` callback below runs exactly
// this simulation per candidate, same shared core `computeResearchMilestoneChain`'s detour step
// uses, just with a different "what happens after" measure — see `findRoiDetour`'s doc comment).
// The first candidate that beats cheapest-first wins; commit to that purchase (or pair) and repeat
// the comparison (another detour may or may not be worth it next). If no candidate beats
// cheapest-first, stop inserting detours and finish with the cheapest-first tail, itself
// re-sequenced by ROI (`reorderPurchaseListByROI`). This naturally orders the result as [ROI
// detours..., cheap purchases re-sequenced by ROI...], since detours are only ever prepended while
// they keep winning, and once cheapest-first wins the remaining tail is that same cheapest-first
// set, just bought in ROI order instead of price order.
export function computeTierMilestoneChain(
  target: { tier: number },
  startSnapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteSimTimeAtStart: number,
  researchSaleDeadline: number,
  // Forwarded to `findRoiDetour`'s own `roiDeadlineOverride` — see `computeResearchMilestoneChain`'s
  // identical parameter for the full explanation.
  roiDeadlineOverride?: number
): MilestoneChainResult {
  let state = createBaseEngineState(startSnapshot);
  let snapshot = startSnapshot;
  let totalSeconds = 0;
  const items: MilestoneChainItem[] = [];

  while (items.length < MILESTONE_MAX_STEPS && !isTierUnlocked(state.researchLevels, target.tier)) {
    const cheapPlan = simulateCheapestFirstTierChain(
      state,
      snapshot,
      totalSeconds,
      target,
      context,
      mods,
      absoluteSimTimeAtStart
    );

    const currentAbsoluteTime = absoluteSimTimeAtStart + totalSeconds;
    // `findRoiDetour`'s `fallbackSeconds` is relative to `currentAbsoluteTime` (matching
    // `computeResearchMilestoneChain`'s own `targetRoi.timeToBuySeconds` convention) — `cheapPlan`'s
    // own `totalSeconds` is absolute from `absoluteSimTimeAtStart`, so convert.
    const fallbackSeconds = cheapPlan.reached ? cheapPlan.totalSeconds - totalSeconds : Infinity;

    const detour = findRoiDetour(
      state,
      snapshot,
      context,
      mods,
      currentAbsoluteTime,
      researchSaleDeadline,
      roiDeadlineOverride,
      fallbackSeconds,
      undefined, // every research counts toward a tier milestone — nothing to exclude
      (result, afterAbsoluteTime) => {
        void afterAbsoluteTime;
        const restOfPlan = simulateCheapestFirstTierChain(
          result.state,
          result.snapshot,
          totalSeconds + result.totalSecondsSpent,
          target,
          context,
          mods,
          absoluteSimTimeAtStart
        );
        if (!restOfPlan.reached) return null;
        // `<=`, not `<` — a candidate bought during genuinely idle time (cheapest-first's own tail
        // is itself waiting on a future sale somewhere in its remaining purchases) often ties
        // `cheapPlan` exactly rather than beating it, and requiring a strict win would stop the
        // very first such no-net-cost detour from being taken.
        if (cheapPlan.reached && restOfPlan.totalSeconds > cheapPlan.totalSeconds) return null;
        return restOfPlan.totalSeconds;
      }
    );

    if (detour) {
      const isPair = detour.items.length > 1;
      for (const purchase of detour.items) {
        totalSeconds += purchase.timeToBuySeconds;
        items.push({
          ...purchase,
          buyToHereSeconds: totalSeconds,
          // A paired purchase's own solo `roiSeconds`/`totalRoiSeconds` (near-infinite, since
          // that's exactly why it needed pairing to be worth taking) would be misleading here —
          // show the combined figure that actually justified buying it instead.
          roiSeconds: isPair ? detour.candidate.pairRoiSeconds : detour.candidate.roiSeconds,
          totalRoiSeconds: isPair ? detour.candidate.pairRoiSeconds : detour.candidate.totalRoiSeconds,
          showSaleWarning: detour.candidate.showSaleWarning,
          showDeadlineWarning: detour.candidate.showDeadlineWarning,
        });
      }
      state = detour.state;
      snapshot = detour.snapshot;
      continue;
    }

    // Cheapest-first wins (or no detour is viable) — buy the same set of items, but re-sequenced
    // by ROI so any ROI-positive purchases in the tail happen before the zero-ROI filler.
    const reordered = reorderPurchaseListByROI(
      cheapPlan.items,
      state,
      snapshot,
      totalSeconds,
      context,
      mods,
      absoluteSimTimeAtStart,
      researchSaleDeadline
    );
    items.push(...reordered.items);
    return { items, reached: cheapPlan.reached, totalSeconds: reordered.totalSeconds };
  }

  return { items, reached: isTierUnlocked(state.researchLevels, target.tier), totalSeconds };
}

export function computeMilestoneBaseline(
  target: MilestoneTarget,
  startSnapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteSimTimeAtStart: number
): { reached: boolean; totalSeconds: number } {
  if (target.kind === 'research') {
    const targetResearch = getResearchById(target.researchId);
    if (!targetResearch) return { reached: false, totalSeconds: 0 };

    const level = startSnapshot.researchLevels[targetResearch.id] || 0;
    const isSale = isResearchSaleActive(absoluteSimTimeAtStart);
    const transitions = boostTransitionsFrom(startSnapshot, absoluteSimTimeAtStart);
    const purchase = getSaleAwareTimeToSave(
      targetResearch,
      level,
      mods,
      isSale,
      absoluteSimTimeAtStart,
      startSnapshot,
      transitions
    );
    return { reached: purchase.waitSeconds !== Infinity, totalSeconds: purchase.waitSeconds };
  }

  const cheapChain = computeCheapestFirstTierChain(target, startSnapshot, context, mods, absoluteSimTimeAtStart);
  return { reached: cheapChain.reached, totalSeconds: cheapChain.totalSeconds };
}

export interface MilestoneSummaryCore {
  truncated: boolean;
  baselineSeconds?: number;
  optimizedSeconds?: number;
  timeSavedSeconds?: number;
  purchaseCount?: number;
  gemsSpent?: number;
  // Only set when truncated. However far the optimized chain actually got before giving up —
  // either it hit MILESTONE_MAX_STEPS with real progress still being made (the common "this
  // milestone is just very far away" case, where these are genuinely useful lower bounds: "at
  // least N purchases, at least X of saving"), or it got stuck with zero purchases queued because
  // nothing is currently affordable/viable at all (both `partialPurchaseCount` and `partialSeconds`
  // are then 0, which callers should treat as "stuck," not "almost done").
  partialPurchaseCount?: number;
  partialSeconds?: number;
}

export function computeMilestoneSummaryCore(
  chain: { items: MilestoneChainItem[]; reached: boolean; totalSeconds: number },
  baseline: { reached: boolean; totalSeconds: number }
): MilestoneSummaryCore {
  if (!chain.reached || !baseline.reached) {
    return {
      truncated: true,
      partialPurchaseCount: chain.items.length,
      partialSeconds: chain.totalSeconds,
    };
  }

  return {
    truncated: false,
    baselineSeconds: baseline.totalSeconds,
    optimizedSeconds: chain.totalSeconds,
    timeSavedSeconds: baseline.totalSeconds - chain.totalSeconds,
    purchaseCount: chain.items.length,
    gemsSpent: chain.items.reduce((sum, item) => sum + item.price, 0),
  };
}
