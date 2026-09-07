import { getDiscountedVirtuePrice, type CommonResearch, type ResearchCostModifiers } from './commonResearch';
import type { CalculationsSnapshot } from '@/types';
import type { SimulationContext } from '@/engine/types';
import { createBaseEngineState } from '@/engine/adapter';
import {
  applyAction,
  getTimeToSave,
  calculateEarningsForTime,
  boostTransitionsFrom,
  type EarningsRateTransition,
} from '@/engine/apply';
import { computeSnapshot } from '@/engine/compute';
import { createSimAction } from '@/types/actions/meta';
import {
  getNextSaleStart,
  getNextSaleEnd,
  getNextEarningsBoostStart,
  getNextEarningsBoostEnd,
  isResearchSaleActive,
  BOUNDARY_EPSILON_SECONDS,
} from '@/lib/events';

// See the comment where this is used in `calculateResearchROI` for why the ROI-payback horizon is
// deliberately much shorter than `boostTransitionsFrom`'s own multi-year default.
const ROI_PAYBACK_TRANSITION_HORIZON_SECONDS = 60 * 86400;

/**
 * How far ahead to search for a purchase to earn back its own cost, when estimating ROI payback
 * time (`roiSeconds`/`totalRoiSeconds` below, and the equivalent inline search in
 * `researchRanking.ts`'s 'maxed_vehicles' branch). Unlike `getTimeToSave`'s wait-to-afford
 * calculation, capping this is safe: a purchase whose payback search doesn't converge within this
 * horizon just gets `roiSeconds: Infinity`, which only ever affects ROI-based sort order (it sorts
 * last) — it's never treated as "this purchase can't be bought," so there's no equivalent risk of
 * reporting a real purchase as impossible.
 */
export const MAX_ROI_PAYBACK_SEARCH_SECONDS = 999 * 86400;

export interface ROICalculationInput {
  research: CommonResearch;
  level: number;
  mods: ResearchCostModifiers;
  snapshot: CalculationsSnapshot;
  context: SimulationContext;
  eventTiming: {
    absoluteSimTime: number;
    // The deadline `showSaleWarning` judges 70%-ROI payback against — the calendar's very next
    // sale start for manual/default callers, or a caller-supplied later deadline (e.g. C3's "last
    // sale of this ride" when it already knows it's riding out several sales in a row) for auto
    // callers willing to judge a purchase against more runway than just the next sale.
    roiDeadline: number;
    researchSaleDeadline: number;
    isSaleActive: boolean;
    // Precomputed via `boostTransitionsFrom(snapshot, absoluteSimTime)` — callers evaluating many
    // candidates at the same point in simulated time (e.g. a milestone chain's per-step candidate
    // list) should compute this ONCE per step and pass the same value to every `calculateResearchROI`
    // call, rather than each call re-deriving an identical result. `boostTransitionsFrom` walks a
    // multi-year horizon to correctly represent long waits (see its own doc comment), so redoing
    // that walk per-candidate rather than once-per-step multiplies an already expensive operation
    // by the candidate count for no benefit.
    transitions: EarningsRateTransition[];
    // Smart Buy's "100% by ride end" gate (Gate B — see `showFullRoiWarning` below) deadline. Only
    // ever set by the sale-aware buy flow (`rankResearchByROI`'s own `fullRoiDeadline` param, fed
    // from `simulateSaleAwareBuy`'s required `fullRoiDeadline` — the manual planner's sale-count
    // picker, or C3's `buildPhaseEnd`); every other caller (ROI view, milestone chain) leaves this
    // undefined, which makes `showFullRoiWarning` an unconditional `false` — a complete no-op for
    // them. Deliberately independent of `roiDeadline` above: unlike `showSaleWarning`, Smart Buy's
    // OWN near-term gate (`showBuyNowRoiWarning`) never reads this field — see that field's own doc
    // comment for why the two are intentionally decoupled.
    fullRoiDeadline?: number;
  };
}

export interface ROICalculationResult {
  roiSeconds: number;
  totalRoiSeconds: number;
  earningsDelta: number;
  showSaleWarning: boolean;
  showDeadlineWarning: boolean;
  // Smart Buy's own two gates — additive to `showSaleWarning`/`showDeadlineWarning` above, not a
  // replacement. See `eventTiming.fullRoiDeadline`'s doc comment and the computation sites below for
  // the full reasoning; only Smart Buy's sale-aware buy flow reads either of these.
  showBuyNowRoiWarning: boolean;
  showFullRoiWarning: boolean;
  timeToBuySeconds: number;
  nextSnapshot: CalculationsSnapshot;
  // The price actually paid, and whether that reflects a research sale — may differ from
  // `getDiscountedVirtuePrice(research, level, mods, eventTiming.isSaleActive)` when waiting for
  // an upcoming sale turns out faster than buying at today's price (see `getSaleAwareTimeToSave`).
  price: number;
  duringSale: boolean;
}

export interface SaleAwarePurchase {
  price: number;
  waitSeconds: number;
  duringSale: boolean;
}

/**
 * Given how long `saveWaitSeconds` it takes (by pure continuous saving — money accrual is
 * unaffected by sale state, only the *target* price is) to bank a sale-priced purchase from
 * `currentAbsoluteTime`, returns the wait until the earliest instant at/after that a research sale
 * is actually running to spend it during. Checks EVERY future sale occurrence, not just the very
 * next one: an expensive purchase routinely needs more than one weekly sale cycle to save for even
 * at 70% off, and a sale that arrives before the money's ready just gets skipped over (nothing to
 * buy yet) rather than treated as the only chance at a discount. Once the money's ready, the
 * qualifying moment is whichever comes first — that instant itself, if a sale is already running
 * then, or the start of the next one otherwise — so no explicit cycle-by-cycle loop is needed:
 * `getNextSaleStart` already finds it in one step.
 *
 * Returns `Infinity` if `saveWaitSeconds` itself is (i.e. the sale price is never affordable at
 * all — see `getTimeToSave`'s own doc comment on what `Infinity` means there).
 */
function earliestSaleTimeAfterSaving(saveWaitSeconds: number, currentAbsoluteTime: number): number {
  if (!isFinite(saveWaitSeconds)) return Infinity;

  const moneyReadyAt = currentAbsoluteTime + saveWaitSeconds;
  const saleTime = isResearchSaleActive(moneyReadyAt) ? moneyReadyAt : getNextSaleStart(moneyReadyAt);
  return saleTime - currentAbsoluteTime;
}

/**
 * The true minimum wait to afford `research` at `level`, choosing whichever is faster: buying now
 * at the current price, or waiting for a research sale — not necessarily the very next one, see
 * `earliestSaleTimeAfterSaving` — and buying at the 70%-off price. Money saved *before* the sale
 * starts still counts toward the *discounted* price the instant the sale begins, so waiting can be
 * strictly faster than buying at full price now, even though the sale isn't active yet at decision
 * time. Concretely: 30 minutes before a sale, an item needing 60 minutes of saving at full price
 * only needs ~18 minutes at 70% off — so the true wait is 30 minutes (wait for the sale, then buy
 * instantly with money already banked), not 60.
 *
 * Also handles the symmetric problem in the other direction — a currently-active sale ending
 * before enough is saved for the discounted price. Money earned is unaffected by the sale (only
 * the *target* price is), so the wait to reach the full price is just `getTimeToSave(fullPrice,
 * snapshot, transitions)` computed from now — the same continuous earnings integral already used
 * everywhere else, unaffected by whether it happens to cross the sale's end partway through. But
 * that's only the fallback once no *future* sale beats it either (see below) — the discount isn't
 * necessarily gone for good just because the current one ends too soon.
 */
export function getSaleAwareTimeToSave(
  research: CommonResearch,
  level: number,
  mods: ResearchCostModifiers,
  isSaleActive: boolean,
  currentAbsoluteTime: number,
  snapshot: CalculationsSnapshot,
  transitions: EarningsRateTransition[]
): SaleAwarePurchase {
  const currentPrice = getDiscountedVirtuePrice(research, level, mods, isSaleActive);
  const currentWait = getTimeToSave(currentPrice, snapshot, transitions);

  if (isSaleActive) {
    const timeUntilSaleEnds = getNextSaleEnd(currentAbsoluteTime) - currentAbsoluteTime;
    if (!isFinite(timeUntilSaleEnds) || currentWait <= timeUntilSaleEnds) {
      return { price: currentPrice, waitSeconds: currentWait, duringSale: true };
    }
    // Won't finish saving the discounted price before this sale ends — but the discount isn't
    // necessarily gone for good: a LATER sale (not just this calendar one) may still beat paying
    // full price. `currentPrice` here already IS the sale price (isSaleActive is true), so it's the
    // right target to keep saving toward.
    const fullPrice = getDiscountedVirtuePrice(research, level, mods, false);
    const fullPriceWait = getTimeToSave(fullPrice, snapshot, transitions);
    // `currentWait` above is already the save time for `currentPrice`, which in this branch IS the
    // sale price — no need to recompute it.
    const laterSaleWait = earliestSaleTimeAfterSaving(currentWait, currentAbsoluteTime);
    if (isFinite(laterSaleWait) && laterSaleWait < fullPriceWait) {
      return { price: currentPrice, waitSeconds: laterSaleWait, duringSale: true };
    }
    return { price: fullPrice, waitSeconds: fullPriceWait, duringSale: false };
  }

  const timeUntilSale = getNextSaleStart(currentAbsoluteTime) - currentAbsoluteTime;
  if (!isFinite(timeUntilSale) || timeUntilSale <= 0) {
    return { price: currentPrice, waitSeconds: currentWait, duringSale: false };
  }

  const salePrice = getDiscountedVirtuePrice(research, level, mods, true);
  const saleWaitFromNow = getTimeToSave(salePrice, snapshot, transitions);
  const trueSaleWait = earliestSaleTimeAfterSaving(saleWaitFromNow, currentAbsoluteTime);

  if (isFinite(trueSaleWait) && trueSaleWait < currentWait) {
    return { price: salePrice, waitSeconds: trueSaleWait, duringSale: true };
  }
  return { price: currentPrice, waitSeconds: currentWait, duringSale: false };
}

/** One event boundary a purchase's own wait crosses: how far away it is, and what it flips to. */
export interface EventCrossing {
  waitSeconds: number;
  togglesTo: boolean;
}

export interface PurchaseEventCrossings {
  sale: EventCrossing[];
  boost: EventCrossing[];
}

/**
 * Given a purchase that starts saving at `currentAbsoluteTime` and (per its own already-computed,
 * boundary-aware `secondsToBuy` — e.g. from `getSaleAwareTimeToSave`/`getTimeToSave`) completes
 * `secondsToBuy` later, determines which event boundaries (research sale start/end, earnings boost
 * start/end) fall within that window — i.e. which events this purchase will cross while saving up.
 * Returns every crossing in chronological order, not just the first — a wait long enough to span a
 * FULL event cycle (e.g. several days, crossing both the boost's start AND its end) needs both
 * represented, or a display/execution consumer would miss the boost turning back off partway
 * through.
 *
 * Purely descriptive: doesn't affect price/wait math at all (that's already baked into
 * `secondsToBuy` by whichever boundary-aware function computed it) — this just identifies, given
 * that already-correct total, what to show/insert as explicit wait+toggle steps around the
 * purchase. Shared by the milestone chain (to annotate the preview) and the manual planner's
 * execution code (to decide what to actually insert) so both sides agree by construction.
 */
export function findEventCrossings(
  currentAbsoluteTime: number,
  secondsToBuy: number,
  isSaleActiveNow: boolean,
  isBoostActiveNow: boolean
): PurchaseEventCrossings {
  return {
    sale: walkEventCrossings(currentAbsoluteTime, secondsToBuy, isSaleActiveNow, getNextSaleStart, getNextSaleEnd),
    boost: walkEventCrossings(
      currentAbsoluteTime,
      secondsToBuy,
      isBoostActiveNow,
      getNextEarningsBoostStart,
      getNextEarningsBoostEnd
    ),
  };
}

/**
 * Walks forward from `currentAbsoluteTime`, alternating between `getNextStart`/`getNextEnd`,
 * collecting every flip within the purchase's `secondsToBuy` window. Each entry's `waitSeconds` is
 * the length of the segment ENDING at that crossing (from the previous crossing, or from
 * `currentAbsoluteTime` for the first) — i.e. exactly the duration of the `wait_for_*` action that
 * would precede it, so callers can insert/display a chronological sequence of wait+toggle steps
 * without needing to re-derive offsets.
 */
// This function's loop bound is `currentAbsoluteTime + secondsToBuy` — and secondsToBuy is
// deliberately allowed to be enormous (see getTimeToSave's doc comment: it never caps a
// genuinely-reachable wait to a fake Infinity, so a purchase evaluated against a weak earn rate can
// legitimately take centuries). Unlike boostTransitionsFrom, which bounds its OWN walk to a fixed
// horizon regardless of the caller's wait, this function had no cap at all — for a multi-century
// wait it would enumerate every weekly sale/boost cycle in that entire span, pushing potentially
// millions of entries and crashing the tab on an out-of-memory error (confirmed in production: a
// milestone-chain purchase evaluated against a near-zero earn rate did exactly this, crashing
// before any of the surrounding loop's own progress heartbeats had a chance to log anything, since
// the crash happens inside a single call, not across iterations already being watched). This is
// purely a display/preview mechanism (the wait+toggle steps for a purchase), so there's no reason
// to enumerate more than a practical number of crossings — nobody benefits from seeing hundreds of
// individual toggle steps for a purchase that takes years, let alone centuries.
const MAX_EVENT_CROSSINGS = 100;

function walkEventCrossings(
  currentAbsoluteTime: number,
  secondsToBuy: number,
  isActiveNow: boolean,
  getNextStart: (t: number) => number,
  getNextEnd: (t: number) => number
): EventCrossing[] {
  if (!isFinite(secondsToBuy) || secondsToBuy <= 0) return [];

  const crossings: EventCrossing[] = [];
  const deadline = currentAbsoluteTime + secondsToBuy;
  let cursor = currentAbsoluteTime;
  let active = isActiveNow;

  while (crossings.length < MAX_EVENT_CROSSINGS) {
    const boundary = active ? getNextEnd(cursor) : getNextStart(cursor);
    // boundary <= cursor should be unreachable (getNextPacificTime guarantees its result is always
    // strictly after its input — see that function's own doc comment), but this walk used to have
    // no defense at all against that invariant ever being violated; break rather than spin forever
    // if it somehow is.
    //
    // `boundary > deadline + BOUNDARY_EPSILON_SECONDS`, not a bare `boundary > deadline`: a purchase
    // timed to land EXACTLY on this boundary (the common "saved up just enough right as the sale
    // starts" case) computed `deadline` by working backward FROM this same boundary via a wait
    // duration, then re-adding that duration to `currentAbsoluteTime` here — a different arithmetic
    // path than this fresh `getNextStart`/`getNextEnd` lookup, even though both intend the identical
    // instant. A bare `>` had zero tolerance for the sub-second float residue that round-trip can
    // leave, so landing a hair on the wrong side silently dropped the crossing — no
    // wait_for_research_sale/toggle_sale got inserted, `activeSales.research` never flipped, and
    // every LATER purchase in the same chain kept reading that stale flag (`syncEventStateForItem`
    // trusts it directly, not a fresh recompute) until some later crossing happened to land cleanly.
    // See `BOUNDARY_EPSILON_SECONDS`'s own doc comment for why this tolerance is safe.
    if (!isFinite(boundary) || boundary > deadline + BOUNDARY_EPSILON_SECONDS || boundary <= cursor) break;
    crossings.push({ waitSeconds: boundary - cursor, togglesTo: !active });
    active = !active;
    cursor = boundary;
  }

  return crossings;
}

/**
 * Whether a purchase modeled as completing "during a sale" (`modeledDuringSale` — e.g.
 * `getSaleAwareTimeToSave`'s `duringSale`, which is only ever as fresh as whichever `isSaleActive`
 * snapshot flag the caller happened to pass in) is *actually* landing inside the closest sale window
 * from `absoluteSimTime` — either a sale already active right now that hasn't ended yet, or (if none
 * is active) the very next upcoming one. `getNextSaleEnd(absoluteSimTime)` gives exactly that
 * boundary in both cases: mid-sale, it's today's own end (`getNextSaleStart`/`getNextPacificTime`
 * would otherwise skip a full cycle ahead to the *following* week's start, since the current sale's
 * start has already passed); not in a sale, it's the upcoming sale's end. Deliberately anchored on
 * `absoluteSimTime` (when this candidate is being evaluated), not on `nextSaleStart` — a caller
 * computing `nextSaleStart` while a sale is already active gets next week's start back, and bounding
 * by *that* sale's end (as this used to) accepted anything landing anywhere in the current sale OR
 * the entirety of next week's, a full extra cycle too permissive.
 *
 * Deliberately NOT "is `completesAt` inside *some* real sale, whichever one that happens to be": an
 * expensive purchase can decide it's faster to save toward a discount several sale cycles out
 * (`getSaleAwareTimeToSave`'s `earliestSaleTimeAfterSaving` checks every future occurrence, not just
 * the next one) — that purchase is still genuinely priced at a real, future sale discount, but it
 * does NOT clear "70% ROI by the *next* sale," and treating "lands in some sale eventually" as
 * equivalent to "lands in the very next one" silently suppressed `showSaleWarning` for it. Confirmed
 * in practice: a research needing 28 days to save for showed no warning at all, because its own save
 * time happened to land inside a sale several weeks out — clearing "is this a real sale" while
 * failing the actual question this warning answers ("is the next achievable sale, specifically,
 * achievable for this purchase"). Bounding `completesAt` to before `getNextSaleEnd(absoluteSimTime)`
 * rules out that far-future case while still accepting both legitimate ones above.
 *
 * Also guards against the same staleness problem the snapshot flag has always had: nothing
 * re-derives `activeSales.research` against the calendar the way `boostTransitionsFrom` does for
 * `earningsBoost.active`, so it can go stale (stay `true` long after the real sale ended) without
 * anything noticing, if whichever purchase happened to be evaluated while it drifted didn't itself
 * straddle the real end boundary.
 */
export function isActuallyDuringSale(
  modeledDuringSale: boolean,
  completesAt: number,
  absoluteSimTime: number
): boolean {
  return modeledDuringSale && isResearchSaleActive(completesAt) && completesAt < getNextSaleEnd(absoluteSimTime);
}

/**
 * Whether a purchase made at `purchaseTime` will have earned back at least `targetPercent`% of
 * `price` by `targetTimestamp`, assuming `earningsDelta` stays constant over that span. Generalizes
 * a check that used to be hardcoded separately in this codebase: `showSaleWarning` below ("70% by
 * the next sale start") is now just a call to this.
 */
export function meetsROIByDeadline(
  earningsDelta: number,
  price: number,
  purchaseTime: number,
  targetTimestamp: number,
  targetPercent: number
): boolean {
  if (targetTimestamp <= purchaseTime) return false;
  return earningsDelta * (targetTimestamp - purchaseTime) >= (targetPercent / 100) * price;
}

/** Minimal shape `meetsSaleAwareDeadline` needs — any ranked-candidate item satisfies this. */
export interface SaleAwareDeadlineCandidate {
  canBuy: boolean;
  isMaxed: boolean;
  price: number;
  earningsDelta?: number;
  purchaseTimestamp?: number;
  duringSale?: boolean;
}

/**
 * Whether `item` is worth buying under a sale-aware "X% ROI by the next sale" rule — the shared
 * predicate behind both the manual planner's "Buy Until Sale Warning" (`targetPercent: 70`) and
 * "Buy Until ROI Deadline" (`targetPercent: 100`) buttons, parameterized so both are just two
 * calls to the same function instead of two separately-maintained implementations (which is how
 * `nextRoiDeadlineCandidate` ended up missing the bypass below entirely — see git history).
 *
 * A candidate passes if EITHER:
 * - it's actually landing inside a real calendar sale window (`isActuallyDuringSale` — see its own
 *   doc comment for why this can't just trust the modeled `duringSale` flag), in which case the
 *   deadline math below is moot and doesn't need to be checked at all, OR
 * - `meetsROIByDeadline` directly confirms it clears `targetPercent`% payback by `nextSaleStart`.
 *
 * The bypass matters for more than just "sale-priced purchases don't need a warning": it's also
 * what lets the *transitional* candidate — the one whose own wait is timed to complete exactly
 * when `nextSaleStart` arrives — pass at all. Without it, `meetsROIByDeadline`'s own
 * `targetTimestamp <= purchaseTime` guard always fails for that candidate (its completion and the
 * deadline are, by construction, the same instant), so no `duringSale` candidate would ever be
 * selectable, and callers relying on this to trigger `syncEventStateForItem`'s wait/toggle
 * insertion would never buy the one purchase that carries the plan through the boundary. Callers
 * that must end up with zero purchases actually priced at the sale discount (rather than just
 * skipping the warning) are expected to sweep those back out afterward — see
 * `buyUntilRealSaleStarts` in `researchRanking.ts`.
 *
 * `absoluteSimTime` (separate from `nextSaleStart`) is only for `isActuallyDuringSale`'s own bound —
 * see that function's doc comment for why it can't just reuse `nextSaleStart` itself.
 */
export function meetsSaleAwareDeadline(
  item: SaleAwareDeadlineCandidate,
  absoluteSimTime: number,
  nextSaleStart: number,
  targetPercent: number
): boolean {
  if (!item.canBuy || item.isMaxed) return false;
  if (item.earningsDelta === undefined || item.purchaseTimestamp === undefined) return false;
  if (isActuallyDuringSale(item.duringSale ?? false, item.purchaseTimestamp, absoluteSimTime)) return true;
  return meetsROIByDeadline(item.earningsDelta, item.price, item.purchaseTimestamp, nextSaleStart, targetPercent);
}

/**
 * Smart Buy's own "70% Return" gate (Gate A) — see SMART_BUY_DUAL_ROI_DESIGN.md §1/§2.3 for the full
 * design. Independent of `showSaleWarning` (which stays anchored to a caller-supplied `roiDeadline`
 * unconditionally, for the ROI view/milestone chain) — this one is bypassed entirely once the
 * purchase is actually landing in the nearest real sale window (`isActuallyDuringSale` — "is this
 * purchase's own resolved completion inside the nearest real sale, not some far-future one"), since
 * there's no "would waiting have been better" question left to ask once you're already buying at the
 * discount. When not bypassed, judged against the immediate next sale (`getNextSaleStart`) —
 * deliberately NOT a caller's "how many sales are in play" deadline, regardless of how far out that
 * is: a full-price purchase should only ever be judged against the very next discount opportunity, or
 * it risks paying full price for something that would've cleared a nearer discount in a few minutes.
 *
 * Extracted as its own function (rather than inlined once in `calculateResearchROI`) so
 * `rankResearchByROI`'s `'maxed_vehicles'` branch and its bottleneck-pairing override — neither of
 * which routes through `calculateResearchROI` — can compute the exact same gate from their own
 * already-computed price/wait/duringSale figures, and so it can be unit-tested directly without
 * needing the full engine-state machinery `calculateResearchROI` requires.
 *
 * Fixes a bug an earlier version of this gate had: reusing `roiDeadline`-style deadline math here too
 * (rather than bypassing outright) could land on a deadline in the past whenever a sale was already
 * active, making the gate fail unconditionally instead of correctly recognizing "already at the
 * discount, nothing left to check."
 */
export function computeShowBuyNowRoiWarning(
  duringSale: boolean,
  earningsDelta: number,
  price: number,
  completesAt: number,
  absoluteSimTime: number
): boolean {
  return isActuallyDuringSale(duringSale, completesAt, absoluteSimTime)
    ? false
    : !meetsROIByDeadline(earningsDelta, price, completesAt, getNextSaleStart(absoluteSimTime), 70);
}

/**
 * Smart Buy's "100% by ride end" gate (Gate B) — see SMART_BUY_DUAL_ROI_DESIGN.md §1/§2.3. Never
 * bypassed, active sale or not — unlike Gate A above, `fullRoiDeadline` (a caller's "how many sales
 * are in play" target) is the one place that choice actually matters. Only active when
 * `fullRoiDeadline` is supplied (Smart Buy's sale-aware buy flow); every other caller leaves it
 * `undefined`, making this an unconditional `false` — a complete no-op for them. Extracted alongside
 * `computeShowBuyNowRoiWarning` for the same reasons (shared by three call sites, unit-testable on
 * its own).
 */
export function computeShowFullRoiWarning(
  earningsDelta: number,
  price: number,
  completesAt: number,
  fullRoiDeadline: number | undefined
): boolean {
  return fullRoiDeadline !== undefined
    ? !meetsROIByDeadline(earningsDelta, price, completesAt, fullRoiDeadline, 100)
    : false;
}

/**
 * Calculate the Return on Investment (ROI) for a specific research purchase.
 * This predicts how long it will take for the research to pay for itself
 * in terms of increased earnings.
 */
export function calculateResearchROI(input: ROICalculationInput): ROICalculationResult {
  const { research, level, mods, snapshot, context, eventTiming } = input;
  const { absoluteSimTime, roiDeadline, researchSaleDeadline, isSaleActive, transitions, fullRoiDeadline } =
    eventTiming;

  const purchase = getSaleAwareTimeToSave(research, level, mods, isSaleActive, absoluteSimTime, snapshot, transitions);
  const price = purchase.price;
  const timeToBuySeconds = purchase.waitSeconds;
  const baseState = createBaseEngineState(snapshot);

  const tempAction = createSimAction(
    'buy_research',
    {
      researchId: research.id,
      fromLevel: level,
      toLevel: level + 1,
    },
    price
  );

  // Project the farm state forward to the actual time of purchase to get accurate ROI
  // predictions based on expected population growth while saving.
  const stateAtBuy =
    timeToBuySeconds > 0 && isFinite(timeToBuySeconds)
      ? applyAction(baseState, createSimAction('wait_for_time', { totalTimeSeconds: timeToBuySeconds }))
      : baseState;
  // `skipEpochConversion` keeps `lastStepTime` in `snapshot`'s own reference frame — these are
  // "project forward from now" snapshots derived from the caller's own `snapshot`, not fresh
  // ascension states, so they must not re-trigger `computeSnapshot`'s one-time epoch/catch-up
  // conversion (see `smartBuyPreview.ts`'s `simulateSaleAwareBuy` for the full story).
  const snapshotAtBuy =
    timeToBuySeconds > 0 && isFinite(timeToBuySeconds)
      ? computeSnapshot(stateAtBuy, context, { skipEpochConversion: true })
      : snapshot;

  const nextStateAtBuy = applyAction(stateAtBuy, tempAction);
  const nextSnapshot = computeSnapshot(nextStateAtBuy, context, { skipEpochConversion: true });

  const absoluteSimTimeAtBuy = absoluteSimTime + timeToBuySeconds;
  // Hoisted out of `getExtra`: neither depends on `t`, so computing them once and reusing across
  // every binary-search iteration below avoids redoing a transitions walk up to 61 times per call —
  // `getExtra` is invoked once for the initial check plus up to 60 more times in the loop.
  //
  // Deliberately a much shorter horizon than `boostTransitionsFrom`'s own default (see its doc
  // comment): this feeds a PAYBACK ESTIMATE that can search up to `maxTime`
  // (`MAX_ROI_PAYBACK_SEARCH_SECONDS`, ~999 days) below — unlike the wait-to-afford calculation
  // above, where exactly which boost cycles fall within the wait changes the real answer, unresolved
  // oscillation far in the future barely moves a payback estimate already spanning months to years,
  // and `getExtra` computes a DIFFERENCE between two highly-correlated curves (before/after this
  // purchase) whose tail-extrapolation errors mostly cancel. This is called once per candidate
  // researched per step, so it dominates the calendar-lookup cost of a large milestone chain if
  // left at the full horizon.
  const nextTransitions = boostTransitionsFrom(
    nextSnapshot,
    absoluteSimTimeAtBuy,
    ROI_PAYBACK_TRANSITION_HORIZON_SECONDS
  );
  const atBuyTransitions = boostTransitionsFrom(
    snapshotAtBuy,
    absoluteSimTimeAtBuy,
    ROI_PAYBACK_TRANSITION_HORIZON_SECONDS
  );

  let roiSeconds = Infinity;
  const maxTime = MAX_ROI_PAYBACK_SEARCH_SECONDS;
  const getExtra = (t: number) =>
    calculateEarningsForTime(t, nextSnapshot, nextTransitions) -
    calculateEarningsForTime(t, snapshotAtBuy, atBuyTransitions);

  if (getExtra(maxTime) >= price) {
    let low = 0;
    let high = maxTime;
    for (let i = 0; i < 60; i++) {
      const mid = (low + high) / 2;
      if (getExtra(mid) >= price) {
        high = mid;
      } else {
        low = mid;
      }
    }
    roiSeconds = high;
  }

  const earningsDelta = roiSeconds !== Infinity && roiSeconds > 0 ? price / roiSeconds : 0;
  const totalRoiSeconds = timeToBuySeconds + roiSeconds;

  const completesAt = absoluteSimTime + timeToBuySeconds;

  // Deliberately NOT waived just because this purchase happens to land during a real sale — a
  // discount doesn't make a slow payback fast. `roiDeadline` is what actually decides how much
  // slack this purchase gets: the calendar's very next sale for manual/default callers, or a
  // caller-supplied later one for auto callers already committed to riding out several sales (see
  // `ROICalculationInput.eventTiming.roiDeadline`'s own doc comment). `isActuallyDuringSale` still
  // matters elsewhere (the `duringSale` display flag, and `meetsSaleAwareDeadline`'s narrower
  // transitional-purchase exception for live execution) — just not here.
  const showSaleWarning = !meetsROIByDeadline(earningsDelta, price, completesAt, roiDeadline, 70);

  const showDeadlineWarning = isResearchSaleActive(absoluteSimTime) && completesAt > researchSaleDeadline;

  const showBuyNowRoiWarning = computeShowBuyNowRoiWarning(
    purchase.duringSale,
    earningsDelta,
    price,
    completesAt,
    absoluteSimTime
  );
  const showFullRoiWarning = computeShowFullRoiWarning(earningsDelta, price, completesAt, fullRoiDeadline);

  return {
    roiSeconds,
    totalRoiSeconds,
    earningsDelta,
    price,
    duringSale: purchase.duringSale,
    showSaleWarning,
    showDeadlineWarning,
    showBuyNowRoiWarning,
    showFullRoiWarning,
    timeToBuySeconds,
    nextSnapshot,
  };
}

/**
 * Whether a purchase that `getSaleAwareTimeToSave` decided to buy at today's price (`purchaseDuringSale:
 * false` — i.e. buying now beat waiting for any future sale on raw speed) should nonetheless be
 * deferred to the next real sale instead, because it wouldn't earn back 70% of its own cost before
 * `roiDeadline` at full price. Buying "fast" isn't the same as buying "well": a purchase a few
 * minutes from being affordable at full price can still be strictly worse than waiting those few
 * minutes for a 70% discount, if it wouldn't pay for itself by the time that discount would've
 * landed anyway. Only meaningful for research that actually moves earnings — the ROI bar is
 * meaningless for anything else, so this never defers a non-earnings purchase.
 *
 * This is the single source of truth behind the manual planner's `syncEventStateForItem`
 * (`checkRoiGate`, only enforced by "Buy Entire Chain") and the auto engine's `buyResearch`
 * (`checkRoiGate`, only enforced by milestone-chain replay) — both call this rather than keeping
 * their own copy, specifically because an earlier independent copy of this same idea inside
 * `computeResearchMilestoneChain`'s own planning loop (a strict `completesAt < nextSaleStart` gate
 * plus a same-week sweep that rejected the one candidate landing exactly on the boundary) diverged
 * from this version under exactly this "lands exactly at the boundary" edge case, silently pushing a
 * purchase that should've landed at the very next sale out to the sale after that instead.
 *
 * Deliberately does NOT decide anything about affordability — a caller electing to defer still needs
 * to actually wait out `getNextSaleStart(absoluteSimTime) - absoluteSimTime` (the calendar's very
 * next real sale — always where the caller actually waits to, regardless of how far out
 * `roiDeadline` itself reaches; this will always be affordable by then: money only grows while idle,
 * and the sale price is never higher than the full price this branch already confirmed reachable in
 * `<=` that same span — see `getSaleAwareTimeToSave`'s own doc comment) and then re-price the
 * purchase fresh from the new, later state, rather than trusting anything computed here as still
 * valid once time has actually moved.
 */
export function shouldDeferToNextSale(
  research: CommonResearch,
  level: number,
  mods: ResearchCostModifiers,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  absoluteSimTime: number,
  roiDeadline: number,
  researchSaleDeadline: number,
  isSaleActive: boolean,
  transitions: EarningsRateTransition[],
  purchaseDuringSale: boolean
): boolean {
  // Already timed to land during a real sale (or a later one) — the ROI gate's own during-sale
  // bypass would pass trivially, so there's nothing to defer.
  if (purchaseDuringSale) return false;

  const roi = calculateResearchROI({
    research,
    level,
    mods,
    snapshot,
    context,
    eventTiming: { absoluteSimTime, roiDeadline, researchSaleDeadline, isSaleActive, transitions },
  });

  return roi.earningsDelta > 0 && roi.showSaleWarning;
}
