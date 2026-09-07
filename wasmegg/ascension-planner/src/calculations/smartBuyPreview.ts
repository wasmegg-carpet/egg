import { type ResearchCostModifiers, getCommonResearches, getResearchById, getResearchByTier } from './commonResearch';
import {
  rankResearchByROI,
  rankResearchByELRImpact,
  buyWhilePassingCheck,
  buyUntilRealSaleStarts,
} from './researchRanking';
import { meetsROIByDeadline, getSaleAwareTimeToSave } from './researchROI';
import { findSmartBuyCandidate } from './smartBuyCandidate';
import type { CalculationsSnapshot } from '@/types';
import type { SimulationContext, EngineState } from '@/engine/types';
import { createBaseEngineState } from '@/engine/adapter';
import { computeSnapshot } from '@/engine/compute';
import { applyAction, applyTime, boostTransitionsFrom } from '@/engine/apply';
import { isResearchSaleActive, getNextSaleEnd } from '@/lib/events';
import { DEBUG_SALE_AWARE_BUY } from '@/lib/debugFlags';
import { ei } from 'lib';

/**
 * Safety-net cap shared by every dry run below — protects against a runaway loop, not a real
 * per-scenario budget (it comfortably exceeds the total number of individual research levels in
 * the game). Matches the same "guard rail, not a tuning knob" role Quick Buy's real execution loop
 * already gives its own iteration cap.
 */
const MAX_SIMULATED_PURCHASES = 2000;

/**
 * Safety-net cap on the earnings-prelude loop specifically (`simulateEarningsPreludeForSaleEnd`) —
 * every prelude LENGTH tried triggers its own full delivery-loop re-run in `simulateSaleEndsBuy`'s
 * trim search below, so this needs to stay much smaller than `MAX_SIMULATED_PURCHASES` to keep that
 * search's worst case (this many extra delivery-loop runs, each up to `MAX_SIMULATED_PURCHASES`
 * iterations) from stalling the tab. A single research sale's window realistically can't fit
 * anywhere near this many sequential ROI-qualifying purchases.
 */
const MAX_PRELUDE_PURCHASES = 200;

/**
 * Safety-net cap on `simulateFinalSaleGapBuy`'s own candidate loop — deliberately much smaller than
 * `MAX_PRELUDE_PURCHASES`: every candidate considered there costs up to two full
 * `simulateSaleEndsBuy` runs (see that function's own doc comment), and a single idle gap between
 * two sales realistically can't fit anywhere near this many sequential ROI-qualifying delivery
 * purchases.
 */
const MAX_GAP_FILL_CANDIDATES = 200;

function buyResearchAction(researchId: string, fromLevel: number, cost: number) {
  return {
    type: 'buy_research' as const,
    payload: { researchId, fromLevel, toLevel: fromLevel + 1 },
    cost,
  };
}

export interface SaleAwarePlanEntry {
  researchId: string;
  duringSale: boolean;
  purchaseTimestamp: number;
  price: number;
}

export interface SaleAwareBuyPlan {
  /** Full sequence, INCLUDING any sale-bypass entry still pending cleanup (see below). */
  entries: SaleAwarePlanEntry[];
  /** Final levels after the same bypass-cleanup the real flow's post-hoc sweep does. */
  endLevels: Record<string, number>;
  /** Scratch snapshot at that same final (post-cleanup) state — not used by this feature's own
   *  UI, but already carries offlineEarnings/elr/etc. for a future "current vs. post-purchase
   *  rate" comparison without needing to touch this function again. */
  endSnapshot: CalculationsSnapshot;
}

export interface SimpleBuyPlan {
  /** Purchase order, one entry per level bought (may repeat the same id for multi-level buys). */
  researchIds: string[];
  endLevels: Record<string, number>;
  endSnapshot: CalculationsSnapshot;
  /** Sum of each purchase's own "time to save" — how long accumulating for all of them normally
   *  would have taken, back to back. Quick Buy itself never simulates a wait (see below), so this
   *  isn't real elapsed time; it's just the figure the Quick Buy note reports as time saved. Only
   *  populated by `simulateThresholdBuy` — other `SimpleBuyPlan` producers leave it unset. */
  totalSecondsToSave?: number;
  /** Sum of each purchase's price — the Quick Buy note's "gems spent" figure. Only populated by
   *  `simulateThresholdBuy` — other `SimpleBuyPlan` producers leave it unset. */
  totalGemsSpent?: number;
}

/**
 * Dry run of the sale-aware ROI buy flow ("70% Return") — mirrors `runSaleAwareBuyFlow` in
 * ResearchActions.vue, but against disposable scratch state instead of the live plan, so it can run
 * reactively for a preview. Re-derives sale state from the simulated clock via
 * `isResearchSaleActive` at each step rather than replicating the real flow's
 * `insertWait`/`insertToggleSale` bookkeeping — that machinery only writes real history records for
 * the player to see later, it doesn't change which research gets picked.
 *
 * In its NEW dual-gate mode (`fullRoiDeadline` supplied — see the parameter doc comments below), a
 * candidate must clear BOTH of `rankResearchByROI`'s two gates to be bought — see
 * `showBuyNowRoiWarning`/`showFullRoiWarning`'s doc comments in researchROI.ts (and
 * SMART_BUY_DUAL_ROI_DESIGN.md §1/§2.3) for the full asymmetric rule: near-term "would waiting a few
 * minutes have been better" sanity check (bypassed once actually buying at a live discount), plus a
 * "will this really pay for itself by the end of the ride" floor that's always active, sale or not.
 * The OLD single-gate mode (`roiDeadlineOverride`) still exists alongside it for a caller out of this
 * redesign's scope — see that parameter's own doc comment.
 *
 * Returns the plan `ResearchActions.vue`'s real handler executes directly (see its own comments) —
 * this function is the single source of truth for "what gets bought, in what order" for both the
 * preview and the real purchase.
 */
export function simulateSaleAwareBuy(
  researchLevels: Record<string, number>,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteSimTime: number,
  researchSaleDeadline: number,
  nextSaleStart: number,
  roiMode: 'immediate' | 'maxed_vehicles',
  deliveryImpactOnly: boolean,
  // Two mutually-exclusive modes, mirroring `rankResearchByROI`'s own two independent parameters of
  // the same names (see their doc comments there for the full story):
  //
  // - `roiDeadlineOverride`: the OLD single-gate mode — candidate selection uses `showSaleWarning`
  //   (70%-by-`roiDeadlineOverride`-or-calendar-default). Only ever used by
  //   `milestoneChain.ts`'s `sweepUntilNextSale`, buying earnings research en route to a milestone —
  //   out of scope for the Smart Buy redesign (SMART_BUY_DUAL_ROI_DESIGN.md decision #1), kept
  //   working exactly as before.
  // - `fullRoiDeadline`: Smart Buy's NEW dual-gate mode — candidate selection uses
  //   `showBuyNowRoiWarning`/`showFullRoiWarning` instead. Used by the manual planner's "70% Return"
  //   button and C3's step 3, both via this same function so preview/execution/auto-planning never
  //   diverge.
  //
  // Every current caller sets exactly one of the two (never both, never neither) — see this
  // function's own doc comment for which.
  roiDeadlineOverride?: number,
  fullRoiDeadline?: number
): SaleAwareBuyPlan {
  if (DEBUG_SALE_AWARE_BUY) {
    const fullRoiDeadlineLabel = fullRoiDeadline !== undefined ? new Date(fullRoiDeadline * 1000).toISOString() : 'n/a';
    const roiDeadlineOverrideLabel =
      roiDeadlineOverride !== undefined ? new Date(roiDeadlineOverride * 1000).toISOString() : 'n/a';
    console.log(
      `[smartBuyPreview] simulateSaleAwareBuy: start, absoluteSimTime=${new Date(absoluteSimTime * 1000).toISOString()}, nextSaleStart=${new Date(nextSaleStart * 1000).toISOString()}, fullRoiDeadline=${fullRoiDeadlineLabel}, roiDeadlineOverride=${roiDeadlineOverrideLabel}, bank=${snapshot.bankValue}, offlineEarnings=${snapshot.offlineEarnings}, levelsSet=${Object.keys(researchLevels).length}`
    );
  }
  let simState: EngineState = { ...createBaseEngineState(snapshot), researchLevels: { ...researchLevels } };
  let simSnapshot = snapshot;
  let simTime = absoluteSimTime;

  interface LogEntry {
    id: string;
    researchId: string;
    fromLevel: number;
    price: number;
    duringSale: boolean;
    purchaseTimestamp: number;
  }
  const log: LogEntry[] = [];
  let pending: (LogEntry & { timeToBuySeconds: number }) | undefined;

  const result = buyUntilRealSaleStarts(
    () => {
      const isSale = isResearchSaleActive(simTime);
      const ranked = rankResearchByROI(
        simState.researchLevels,
        simSnapshot,
        context,
        mods,
        isSale,
        simTime,
        researchSaleDeadline,
        roiMode,
        deliveryImpactOnly,
        roiDeadlineOverride,
        fullRoiDeadline
      );
      // NOTE: intentionally NOT `meetsSaleAwareDeadline` (which `nextRoiCandidate` in
      // ResearchActions.vue used to use, for its own button-enabled/highlight preview only — not
      // purchase execution; that computed has since been replaced by reading this very plan's own
      // entries instead, for exactly this reason). That function derives eligibility from the
      // candidate's SOLO price/earningsDelta/duringSale, which is wrong for a bottleneck-paired
      // candidate: its own solo earningsDelta can be zero (that's what "bottlenecked" means) even when
      // the PAIR it was ranked alongside genuinely clears the relevant gate(s). `rankResearchByROI`
      // already computes both modes' fields correctly for both cases (solo ROI normally, pair-combined
      // ROI when a pairing beats the solo figure — see its own bottleneck-pairing block), so reading
      // them here instead keeps this loop consistent with the ranking that produced `ranked`'s own
      // sort order, rather than re-deriving a second, pairing-blind answer.
      //
      // `fullRoiDeadline !== undefined` selects which of the two mutually-exclusive modes this call is
      // in — see this function's own parameter doc comments.
      const candidate =
        fullRoiDeadline !== undefined
          ? ranked.find(item => item.canBuy && !item.showBuyNowRoiWarning && !item.showFullRoiWarning)
          : ranked.find(item => item.canBuy && !item.showSaleWarning);
      if (!candidate) {
        if (DEBUG_SALE_AWARE_BUY) {
          console.log(
            `[smartBuyPreview] simulateSaleAwareBuy: no candidate found (${log.length} bought so far, ${ranked.length} ranked total). Top 10 ranked:`,
            ranked.slice(0, 10).map(item => ({
              id: item.research.id,
              level: item.currentLevel,
              canBuy: item.canBuy,
              price: item.price,
              earningsDelta: item.earningsDelta,
              timeToBuySeconds: item.timeToBuySeconds,
              purchaseTimestamp: simTime + (item.timeToBuySeconds ?? 0),
              duringSale: item.duringSale,
              showSaleWarning: item.showSaleWarning,
              showBuyNowRoiWarning: item.showBuyNowRoiWarning,
              showFullRoiWarning: item.showFullRoiWarning,
              pairRoiSeconds: item.pairRoiSeconds,
              pairPartner: item.pairPartnerResearch?.id,
            }))
          );
        }
        return undefined;
      }

      const timeToBuySeconds = candidate.timeToBuySeconds ?? 0;
      const purchaseTimestamp = simTime + timeToBuySeconds;
      pending = {
        id: String(log.length),
        researchId: candidate.research.id,
        fromLevel: simState.researchLevels[candidate.research.id] || 0,
        price: candidate.price,
        duringSale: candidate.duringSale,
        purchaseTimestamp,
        timeToBuySeconds,
      };
      return {
        researchId: pending.researchId,
        duringSale: pending.duringSale,
        purchaseTimestamp: pending.purchaseTimestamp,
      };
    },
    researchId => {
      if (!pending || pending.researchId !== researchId) return false;
      simState = applyAction(simState, buyResearchAction(researchId, pending.fromLevel, pending.price));
      simState = applyTime(simState, pending.timeToBuySeconds, simSnapshot);
      simTime += pending.timeToBuySeconds;
      // `skipEpochConversion` keeps `lastStepTime` in the incoming snapshot's own reference frame
      // (relative or absolute) across this loop's repeated `computeSnapshot` calls — same reasoning
      // as `engine/simulate.ts`'s identical flag on its own per-step snapshot. Without it, the first
      // call here can silently flip `lastStepTime` from a small relative offset to an absolute epoch
      // timestamp mid-loop, corrupting any elapsed-time delta a caller derives from before/after
      // snapshots (confirmed: this is what produced a `>999d` milestone-chain result).
      simSnapshot = computeSnapshot(simState, context, { skipEpochConversion: true });
      log.push(pending);
      return true;
    },
    () => simTime >= nextSaleStart,
    () => log[log.length - 1]?.id,
    MAX_SIMULATED_PURCHASES
  );

  // Same rule the real flow's post-hoc sweep applies via `executeUndo`: a purchase that only
  // passed via the `duringSale` bypass AND landed at-or-after the target deadline gets reverted.
  const revertIds = new Set(
    result.duringSalePurchases.filter(p => p.purchaseTimestamp >= nextSaleStart).map(p => p.actionId)
  );
  let cleanState = simState;
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (revertIds.has(entry.id)) {
      cleanState = {
        ...cleanState,
        researchLevels: { ...cleanState.researchLevels, [entry.researchId]: entry.fromLevel },
        bankValue: (cleanState.bankValue || 0) + entry.price,
      };
    }
  }
  const endSnapshot = computeSnapshot(cleanState, context, { skipEpochConversion: true });

  return {
    entries: log.map(e => ({
      researchId: e.researchId,
      duringSale: e.duringSale,
      purchaseTimestamp: e.purchaseTimestamp,
      price: e.price,
    })),
    endLevels: cleanState.researchLevels,
    endSnapshot,
  };
}

export interface EarningsPreludePurchase {
  researchId: string;
  price: number;
  waitSeconds: number;
  purchaseTimestamp: number;
}

/** One point along an earnings-prelude purchase sequence — `purchases` is every earnings research
 *  bought so far to reach this point, in order (empty for the starting checkpoint at index 0). */
export interface EarningsPreludeCheckpoint {
  purchases: EarningsPreludePurchase[];
  researchLevels: Record<string, number>;
  snapshot: CalculationsSnapshot;
  simTime: number;
}

/**
 * Simulates buying earnings research, best-ROI-first, for as long as each purchase can still earn
 * back 100% of its own price before `researchSaleDeadline` — the end of the CURRENTLY ACTIVE
 * research sale, not the next sale start (unlike `simulateSaleAwareBuy`'s 70% Return plan, which
 * targets the next sale). Always ranks across every research category in 'immediate' ROI mode,
 * regardless of the Smart Buy tab's own `deliveryImpactOnly`/`roiMode` settings — deciding what
 * earnings research is worth buying before switching to delivery research this sale is a distinct
 * question from that button's, with its own fixed answer, not something meant to follow whatever
 * the tab happens to be configured for.
 *
 * Deliberately does NOT use `meetsSaleAwareDeadline`'s during-sale bypass. That bypass exists so the
 * 70% Return button buys through an already-active sale at its real discount without also
 * demanding it clears the ROI bar (missing the discount, not the ROI bar, is the real cost there).
 * This function only ever runs while a sale is active (see `simulateSaleEndsBuy`'s own gating), so
 * reusing that bypass here would let nearly every candidate through regardless of ROI and defeat the
 * point of this function entirely — a plain `meetsROIByDeadline` check is used instead.
 *
 * Returns every intermediate checkpoint (one per prefix of the purchase sequence, including the
 * empty prefix at index 0) rather than just the final state, so callers can evaluate "what if I
 * stopped buying earnings research k purchases early" without re-simulating this loop from scratch
 * for each k — see `simulateSaleEndsBuy`'s trim search below, the first consumer. Exported so other
 * flows can reuse this same "which earnings research pays for itself before X" simulation with their
 * own start state/deadline.
 */
export function simulateEarningsPreludeForSaleEnd(
  researchLevels: Record<string, number>,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteSimTime: number,
  researchSaleDeadline: number,
  maxIterations: number = MAX_PRELUDE_PURCHASES
): EarningsPreludeCheckpoint[] {
  let simState: EngineState = { ...createBaseEngineState(snapshot), researchLevels: { ...researchLevels } };
  let simSnapshot = snapshot;
  let simTime = absoluteSimTime;

  const checkpoints: EarningsPreludeCheckpoint[] = [
    { purchases: [], researchLevels: simState.researchLevels, snapshot: simSnapshot, simTime },
  ];

  for (let i = 0; i < maxIterations && simTime < researchSaleDeadline; i++) {
    const isSale = isResearchSaleActive(simTime);
    const ranked = rankResearchByROI(
      simState.researchLevels,
      simSnapshot,
      context,
      mods,
      isSale,
      simTime,
      researchSaleDeadline,
      'immediate',
      false
    );
    const candidate = ranked.find(item => {
      if (!item.canBuy || item.earningsDelta === undefined || item.timeToBuySeconds === undefined) return false;
      return meetsROIByDeadline(
        item.earningsDelta,
        item.price,
        simTime + item.timeToBuySeconds,
        researchSaleDeadline,
        100
      );
    });
    if (!candidate) break;

    const waitSeconds = candidate.timeToBuySeconds ?? 0;
    const level = simState.researchLevels[candidate.research.id] || 0;

    simState = applyAction(simState, buyResearchAction(candidate.research.id, level, candidate.price));
    simState = applyTime(simState, waitSeconds, simSnapshot);
    simTime += waitSeconds;
    // See `simulateSaleAwareBuy`'s identical comment — keeps `lastStepTime` in its incoming frame
    // across this loop's repeated snapshots instead of risking a mid-loop epoch flip.
    simSnapshot = computeSnapshot(simState, context, { skipEpochConversion: true });

    checkpoints.push({
      purchases: [
        ...checkpoints[checkpoints.length - 1].purchases,
        { researchId: candidate.research.id, price: candidate.price, waitSeconds, purchaseTimestamp: simTime },
      ],
      researchLevels: simState.researchLevels,
      snapshot: simSnapshot,
      simTime,
    });
  }

  return checkpoints;
}

export interface DeliveryPurchase {
  researchId: string;
  purchaseTimestamp: number;
  price: number;
}

export interface DeliveryLoopResult {
  purchases: DeliveryPurchase[];
  endLevels: Record<string, number>;
  endSnapshot: CalculationsSnapshot;
}

/**
 * Simulates buying delivery-impact research, best-impact-first (`rankResearchByELRImpact`), from
 * `researchLevels`/`snapshot`/`absoluteSimTime` until nothing more can finish before
 * `researchSaleDeadline`. Generalized out of what used to be `simulateSaleEndsBuy`'s own inline loop
 * so it can be re-run from any starting point — `simulateSaleEndsBuy`'s trim search below re-runs it
 * from several different earnings-prelude checkpoints, but it's exported for any other caller that
 * wants the same "buy delivery research until a deadline" simulation from its own start state.
 */
export function runDeliveryBuyLoop(
  researchLevels: Record<string, number>,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteSimTime: number,
  researchSaleDeadline: number,
  elrViewMode: 'realistic' | 'potential',
  elrSortMode: 'efficiency' | 'impact',
  rawBackup: ei.IBackup | null | undefined,
  maxIterations: number = MAX_SIMULATED_PURCHASES
): DeliveryLoopResult {
  let simState: EngineState = { ...createBaseEngineState(snapshot), researchLevels: { ...researchLevels } };
  let simSnapshot = snapshot;
  let simTime = absoluteSimTime;
  const purchases: DeliveryPurchase[] = [];

  buyWhilePassingCheck(
    () => {
      // Explicit stop condition, NOT delegated to `showDeadlineWarning` alone (unlike a plain
      // candidate filter — this loop needs a hard bound `buyWhilePassingCheck` itself has no concept
      // of). `showDeadlineWarning` is gated behind `isResearchSaleActive(simTime)`, correct for its
      // OTHER job (a live-browsing badge that should stay silent when no sale is happening at all —
      // ResearchFlatView.vue/ResearchItem.vue), but wrong as this loop's only stopping mechanism:
      // once `simTime` (walked forward by each purchase's own wait) crosses past the sale's real end,
      // `isResearchSaleActive(simTime)` flips to `false`, silently disabling `showDeadlineWarning`
      // for every remaining candidate and letting this loop keep buying — confirmed in practice,
      // producing a "plan" that reported finishing in a few hours but actually took 6+ real days to
      // execute. Checking `simTime >= researchSaleDeadline` directly here, the same way
      // `simulateEarningsPreludeForSaleEnd`'s own loop condition already does (`for (...; simTime <
      // researchSaleDeadline; ...)`) and `simulateSaleAwareBuy`'s `buyUntilRealSaleStarts` does via
      // its own explicit `shouldStop`, closes that gap.
      if (simTime >= researchSaleDeadline) return undefined;
      const isSale = isResearchSaleActive(simTime);
      const ranked = rankResearchByELRImpact(
        simState.researchLevels,
        rawBackup,
        simSnapshot,
        context,
        mods,
        isSale,
        simTime,
        researchSaleDeadline,
        elrViewMode,
        elrSortMode
      );
      const candidate = ranked.find(item => item.canBuy && !item.showDeadlineWarning);
      return candidate ? { researchId: candidate.research.id } : undefined;
    },
    researchId => {
      const research = getResearchById(researchId);
      if (!research) return false;
      const level = simState.researchLevels[researchId] || 0;
      const isSale = isResearchSaleActive(simTime);
      const transitions = boostTransitionsFrom(simSnapshot, simTime);
      const purchase = getSaleAwareTimeToSave(research, level, mods, isSale, simTime, simSnapshot, transitions);
      simState = applyAction(simState, buyResearchAction(researchId, level, purchase.price));
      simState = applyTime(simState, purchase.waitSeconds, simSnapshot);
      simTime += purchase.waitSeconds;
      // See `simulateSaleAwareBuy`'s identical comment — keeps `lastStepTime` in its incoming frame
      // across this loop's repeated snapshots instead of risking a mid-loop epoch flip.
      simSnapshot = computeSnapshot(simState, context, { skipEpochConversion: true });
      purchases.push({ researchId, purchaseTimestamp: simTime, price: purchase.price });
      return true;
    },
    maxIterations
  );

  return { purchases, endLevels: simState.researchLevels, endSnapshot: simSnapshot };
}

/** Whether every research/level pair in `target` has been reached in `endLevels`. */
function achievesTarget(endLevels: Record<string, number>, target: Map<string, number>): boolean {
  for (const [researchId, level] of target) {
    if ((endLevels[researchId] || 0) < level) return false;
  }
  return true;
}

/**
 * Walks `run`'s purchases in order, starting from `startLevels`, and returns the timestamp at which
 * every entry in `target` first becomes simultaneously satisfied — i.e. when the run has finished
 * buying (at least) the target set, which may be earlier than when the run itself stops (it can keep
 * buying further research afterward with whatever budget/time is left). Assumes
 * `achievesTarget(run.endLevels, target)` is already true and `target` is non-empty; the caller
 * (`simulateSaleEndsBuy`) checks both before calling this.
 */
function findTargetCompletionTime(
  run: DeliveryLoopResult,
  target: Map<string, number>,
  startLevels: Record<string, number>
): number {
  const levels = { ...startLevels };
  const remaining = new Map(target);
  for (const p of run.purchases) {
    levels[p.researchId] = (levels[p.researchId] || 0) + 1;
    const targetLevel = remaining.get(p.researchId);
    if (targetLevel !== undefined && levels[p.researchId] >= targetLevel) {
      remaining.delete(p.researchId);
    }
    if (remaining.size === 0) return p.purchaseTimestamp;
  }
  return Infinity;
}

export interface SaleEndsPlan extends SimpleBuyPlan {
  /** Just the earnings-prelude portion of `researchIds`, in purchase order. */
  earningsResearchIds: string[];
  /** Just the delivery portion of `researchIds`, in purchase order. */
  deliveryResearchIds: string[];
  /** Levels right after the earnings-prelude portion, before any delivery research is bought — the
   *  midpoint between the plan's start levels and `endLevels`. Lets a caller show the earnings and
   *  delivery portions of the plan as two separate before/after summaries instead of one combined
   *  diff. */
  earningsEndLevels: Record<string, number>;
  /** Snapshot at that same midpoint — carries `offlineEarnings`/etc. for a "current vs.
   *  post-earnings-prelude rate" comparison, same idea as `SaleAwareBuyPlan.endSnapshot`'s doc
   *  comment. */
  earningsEndSnapshot: CalculationsSnapshot;
  /** Absolute timestamp the LAST purchase in this plan (earnings or delivery, whichever comes
   *  later) actually completes at — falls back to the plan's own starting `absoluteSimTime` when
   *  nothing was bought at all. This is what a caller should use for "how long do these purchases
   *  span," NOT `researchSaleDeadline - absoluteSimTime`: that's just the structural window this
   *  plan is bounded BY, not how long it actually takes — a plan that runs out of qualifying
   *  candidates early legitimately finishes well before the deadline, and should say so. See
   *  `saleAwareStats70`'s identical fix (useResearchViews.ts) for the same bug on the "70% Return"
   *  card. */
  lastPurchaseTimestamp: number;
}

/**
 * Dry run of the Delivery Impact "Buy Until Sale Ends" flow — mirrors `handleBuyUntilSaleDeadline`.
 * No cleanup sweep needed (the real handler doesn't do one either).
 *
 * Buying delivery research directly, from today's levels, isn't actually the fastest way to
 * maximize delivery research bought before the sale ends: spending part of the sale on earnings
 * research first raises the earn rate for the rest of the window, which can let MORE delivery
 * research get bought by the deadline than skipping straight to it — but only up to a point, since
 * every second spent buying earnings research is a second not spent buying delivery research
 * directly. This runs a full earnings-research prelude
 * (`simulateEarningsPreludeForSaleEnd` — up to 100% ROI by the sale's end), simulates the delivery
 * research that unlocks (the target set `D`), then trims purchases off the END of that prelude one
 * at a time — keeping each trim only if the resulting plan still buys all of `D` AND finishes buying
 * it strictly sooner than the previous (untrimmed-further) iteration did — stopping, and rolling back
 * one step, at the first trim that loses a target purchase or doesn't finish sooner. This greedy
 * trim isn't an exhaustive search of every possible prelude length, but it never ends up worse than
 * skipping the prelude entirely (`n = 0`, i.e. no earnings research clears the ROI bar, degenerates
 * to the old direct-delivery-only behavior), and the final delivery run is left free to keep buying
 * past `D` with whatever time/budget remains — so the result can end up buying the same delivery
 * research as the untrimmed prelude, or more, never less.
 */
export function simulateSaleEndsBuy(
  researchLevels: Record<string, number>,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteSimTime: number,
  researchSaleDeadline: number,
  elrViewMode: 'realistic' | 'potential',
  elrSortMode: 'efficiency' | 'impact',
  rawBackup: ei.IBackup | null | undefined
): SaleEndsPlan {
  const checkpoints = simulateEarningsPreludeForSaleEnd(
    researchLevels,
    snapshot,
    context,
    mods,
    absoluteSimTime,
    researchSaleDeadline
  );
  const n = checkpoints.length - 1;

  const runDeliveryFromCheckpoint = (k: number) =>
    runDeliveryBuyLoop(
      checkpoints[k].researchLevels,
      checkpoints[k].snapshot,
      context,
      mods,
      checkpoints[k].simTime,
      researchSaleDeadline,
      elrViewMode,
      elrSortMode,
      rawBackup
    );

  let bestK = n;
  let bestRun = runDeliveryFromCheckpoint(n);

  // The target set D: every research this baseline (full prelude) run bought, at the level it
  // ended up at. Fixed once, up front — every trimmed iteration below is judged against this same
  // set, not whatever it happens to buy itself.
  const target = new Map<string, number>();
  for (const p of bestRun.purchases) {
    target.set(p.researchId, bestRun.endLevels[p.researchId]);
  }

  let bestCompletionTime =
    target.size === 0
      ? checkpoints[n].simTime
      : findTargetCompletionTime(bestRun, target, checkpoints[n].researchLevels);

  for (let k = n - 1; k >= 0; k--) {
    const run = runDeliveryFromCheckpoint(k);
    if (!achievesTarget(run.endLevels, target)) break;
    const completionTime =
      target.size === 0 ? checkpoints[k].simTime : findTargetCompletionTime(run, target, checkpoints[k].researchLevels);
    if (!(completionTime < bestCompletionTime)) break;
    bestK = k;
    bestRun = run;
    bestCompletionTime = completionTime;
  }

  const earningsResearchIds = checkpoints[bestK].purchases.map(p => p.researchId);
  const deliveryResearchIds = bestRun.purchases.map(p => p.researchId);
  const totalGemsSpent =
    checkpoints[bestK].purchases.reduce((sum, p) => sum + p.price, 0) +
    bestRun.purchases.reduce((sum, p) => sum + p.price, 0);
  // The delivery run's own last purchase if it bought anything, else wherever the (possibly-trimmed)
  // earnings prelude left off — `checkpoints[bestK].simTime` already covers BOTH "some prelude, no
  // delivery" and "no prelude, no delivery" (it's `absoluteSimTime` itself at k=0), so no separate
  // fallback is needed for the fully-empty case.
  const lastPurchaseTimestamp =
    bestRun.purchases.length > 0
      ? bestRun.purchases[bestRun.purchases.length - 1].purchaseTimestamp
      : checkpoints[bestK].simTime;

  return {
    researchIds: [...earningsResearchIds, ...deliveryResearchIds],
    earningsResearchIds,
    deliveryResearchIds,
    earningsEndLevels: checkpoints[bestK].researchLevels,
    earningsEndSnapshot: checkpoints[bestK].snapshot,
    endLevels: bestRun.endLevels,
    endSnapshot: bestRun.endSnapshot,
    totalGemsSpent,
    lastPurchaseTimestamp,
  };
}

export interface FinalSaleGapPurchase {
  researchId: string;
  price: number;
  purchaseTimestamp: number;
}

export interface FinalSaleGapPlan {
  /** In purchase order. Empty when there was no gap to fill, or nothing in it cleared both gates. */
  purchases: FinalSaleGapPurchase[];
  endLevels: Record<string, number>;
  endSnapshot: CalculationsSnapshot;
}

/**
 * C3's "final-sale gap fill": when the last earnings-ROI sweep before a multi-sale ride's FINAL
 * sale (`buyUntilSaleWarning` in c3.ts, targeting that sale's own start) runs out of ROI-qualifying
 * candidates before actually reaching that deadline, the remaining stretch between wherever it
 * stopped and the final sale's start would otherwise sit completely idle — nothing else in C3 buys
 * anything there, since the only pass that knows what delivery research this ride is going to end
 * up buying (`buyUntilSaleEnds`) doesn't run until the final sale actually starts.
 *
 * That idle stretch isn't actually empty of opportunity: some of what `buyUntilSaleEnds` buys for
 * delivery impact ALSO raises earnings, and delivery research is picked purely by ELR impact
 * (`rankResearchByELRImpact`), never gated on ROI at all — so it's going to get bought during the
 * final sale regardless of whether it makes economic sense to buy it *now* instead. That reframes
 * the question this function answers from "is this purchase worth making at all" (already yes) to
 * "is it worth making sooner, at today's likely-full off-sale price, than waiting for the final
 * sale's own discount" — exactly a 70%-ROI-by-deadline question, just judged against
 * `finalSaleStart` instead of the calendar's next real sale.
 *
 * Each iteration:
 * 1. Ranks unpurchased research via `rankResearchByROI('immediate', deliveryImpactOnly: true,
 *    roiDeadlineOverride: finalSaleStart)` — the OLD single-gate mode (`showSaleWarning`), NOT the
 *    dual-gate mode `buyUntilSaleWarning` itself uses: Smart Buy's own near-term gate
 *    (`showBuyNowRoiWarning`) is unconditionally anchored to the calendar's very next real sale
 *    regardless of any deadline override (see its own doc comment in researchROI.ts) — reusing it
 *    here would just reproduce the exact exclusion that left this candidate stranded in the idle
 *    gap to begin with. `deliveryImpactOnly: true` additionally restricts candidates to the
 *    categories `buyUntilSaleEnds`'s own delivery pass can actually buy
 *    (`DELIVERY_IMPACT_CATEGORIES`) — a candidate outside those categories has no bearing on the
 *    delivery outcome this function exists to protect, and pulling one forward here would just be
 *    re-deciding a question `buyUntilSaleWarning` already answered correctly under its own
 *    (correctly calendar-anchored) gate.
 * 2. Takes the fastest-ROI candidate that clears gate 1 and hasn't already been rejected this call
 *    (already `rankResearchByROI`'s own sort order — see its doc comment), and checks whether
 *    buying it now leaves the eventual delivery outcome at `buildPhaseEnd` at least as good as not
 *    buying it: both branches are projected forward to `finalSaleStart` first (an idle wait,
 *    mirroring what this stretch would do with the time anyway) before running the real
 *    `simulateSaleEndsBuy` plan from there, so the comparison isn't contaminated by one branch
 *    simply having more elapsed time than the other. `endSnapshot.elr` — the real projected
 *    delivery rate at `buildPhaseEnd`, not a hypothetical maxed-vehicles one — is the comparison
 *    metric; non-negative (not strictly positive) is the bar, since a candidate that leaves the
 *    final delivery rate merely unchanged still isn't making anything worse, and it's still earning
 *    extra along the way.
 * 3. A candidate that clears step 2 is bought for real (committing time/state), and its own "with
 *    purchase" delivery-outcome run becomes the new baseline for the next iteration's comparison —
 *    it already IS exactly "current committed state, projected and delivery-simulated," so nothing
 *    needs recomputing. A candidate that fails step 2 is rejected for the rest of this call (added
 *    to a skip set) rather than retried on a later iteration — a single greedy pass, not an
 *    exhaustive search of every accept/reject combination; see `simulateSaleEndsBuy`'s own doc
 *    comment for the same tradeoff made for the same reason elsewhere in this file.
 *
 * Each candidate considered costs up to two full `simulateSaleEndsBuy` runs (step 2's baseline
 * reuse trims this to one for every candidate after the first) — expensive relative to everything
 * else in this file, but bounded by `MAX_GAP_FILL_CANDIDATES`, and the candidate pool here is
 * inherently small: at most a single week's worth of ROI-qualifying delivery research.
 *
 * Returns an empty plan immediately if there's no gap left to fill (`absoluteSimTime >=
 * finalSaleStart`) — callers don't need their own guard for that case.
 */
export function simulateFinalSaleGapBuy(
  researchLevels: Record<string, number>,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteSimTime: number,
  finalSaleStart: number,
  buildPhaseEnd: number,
  elrViewMode: 'realistic' | 'potential',
  elrSortMode: 'efficiency' | 'impact',
  rawBackup: ei.IBackup | null | undefined
): FinalSaleGapPlan {
  if (absoluteSimTime >= finalSaleStart) {
    return { purchases: [], endLevels: researchLevels, endSnapshot: snapshot };
  }

  // Projects `levels`/`stateSnapshot` forward from `fromTime` to `finalSaleStart` doing nothing
  // else (a pure idle wait — the same thing this gap would otherwise spend doing), then runs the
  // real "Buy Until Sale Ends" delivery plan from there through `buildPhaseEnd`. This is the shared
  // "what would the eventual delivery outcome actually be" projection both the baseline and each
  // candidate branch below need — factored out since it's called at least twice (baseline once,
  // once more per candidate actually considered).
  const projectToDeliveryOutcome = (
    levels: Record<string, number>,
    stateSnapshot: CalculationsSnapshot,
    fromTime: number
  ): SaleEndsPlan => {
    const idleSeconds = Math.max(0, finalSaleStart - fromTime);
    let projectedSnapshot = stateSnapshot;
    if (idleSeconds > 0) {
      const engineState: EngineState = { ...createBaseEngineState(stateSnapshot), researchLevels: { ...levels } };
      const projectedState = applyTime(engineState, idleSeconds, stateSnapshot);
      // See `simulateSaleAwareBuy`'s identical comment — keeps `lastStepTime` in its incoming frame
      // across this projection instead of risking a mid-loop epoch flip.
      projectedSnapshot = computeSnapshot(projectedState, context, { skipEpochConversion: true });
    }
    return simulateSaleEndsBuy(
      levels,
      projectedSnapshot,
      context,
      mods,
      finalSaleStart,
      buildPhaseEnd,
      elrViewMode,
      elrSortMode,
      rawBackup
    );
  };

  let simState: EngineState = { ...createBaseEngineState(snapshot), researchLevels: { ...researchLevels } };
  let simSnapshot = snapshot;
  let simTime = absoluteSimTime;

  const purchases: FinalSaleGapPurchase[] = [];
  const rejectedIds = new Set<string>();
  let baseline = projectToDeliveryOutcome(simState.researchLevels, simSnapshot, simTime);

  for (let i = 0; i < MAX_GAP_FILL_CANDIDATES && simTime < finalSaleStart; i++) {
    const isSale = isResearchSaleActive(simTime);
    const ranked = rankResearchByROI(
      simState.researchLevels,
      simSnapshot,
      context,
      mods,
      isSale,
      simTime,
      getNextSaleEnd(simTime),
      'immediate',
      true,
      finalSaleStart,
      undefined
    );
    // `!item.showSaleWarning` alone isn't enough: `showSaleWarning` is `!meetsROIByDeadline(...,
    // finalSaleStart, 70)`, and `meetsROIByDeadline`'s own `targetTimestamp <= purchaseTime` guard
    // unconditionally fails whenever a candidate's completion lands AT-OR-AFTER `finalSaleStart` —
    // which is common here, since `finalSaleStart` is also the calendar's own next real sale from
    // early in this gap, so `getSaleAwareTimeToSave` routinely resolves an expensive candidate's
    // wait to "however long it takes to land exactly at that sale's start, buy at its discount."
    // This is the same "transitional candidate" trap `meetsSaleAwareDeadline` already documents and
    // works around elsewhere in this codebase, just NOT via that function's own `isActuallyDuringSale`
    // bypass: that bypass answers "is this landing in the sale nearest to right now," which is the
    // wrong question this far out — early in the gap, `simTime` itself can still be inside the
    // PRECEDING (non-final) sale's own window, making the "nearest" sale from `simTime` that earlier
    // one, not `finalSaleStart`. What actually matters here is simpler and doesn't need calendar
    // lookahead at all: is this specific candidate actually landing inside SOME real, currently-
    // resolvable sale discount (`item.duringSale` — either the one active right now, or, by
    // construction, `finalSaleStart` itself, since nothing else sits between here and there)? If so,
    // there's no "would waiting have been better" question left to ask, same reasoning as every other
    // during-sale bypass in this file — pre-buying it now still isn't free, though: it's still
    // trading part of this otherwise-idle gap for a purchase `buyUntilSaleEnds` would otherwise have
    // to spend part of the final sale's own tight window on, which is exactly the win this function
    // exists to bank (see this function's own doc comment). `item.duringSale`/`item.timeToBuySeconds`
    // are already the pairing-aware anchor fields `showSaleWarning` itself was computed from (see
    // `rankResearchByROI`'s bottleneck-pairing block), so this bypass stays consistent with whichever
    // economics (solo or paired) actually decided this candidate's rank.
    const candidate = ranked.find(
      item => item.canBuy && (!item.showSaleWarning || item.duringSale) && !rejectedIds.has(item.research.id)
    );
    if (!candidate) break;

    const timeToBuySeconds = candidate.timeToBuySeconds ?? 0;
    // Doesn't even finish saving up before the final sale starts — nothing left to compare, and
    // waiting won't change that verdict, so reject and move on rather than looping on it again.
    if (simTime + timeToBuySeconds > finalSaleStart) {
      rejectedIds.add(candidate.research.id);
      continue;
    }

    const level = simState.researchLevels[candidate.research.id] || 0;
    const candidateState = applyTime(
      applyAction(simState, buyResearchAction(candidate.research.id, level, candidate.price)),
      timeToBuySeconds,
      simSnapshot
    );
    // See `simulateSaleAwareBuy`'s identical comment — keeps `lastStepTime` in its incoming frame.
    const candidateSnapshot = computeSnapshot(candidateState, context, { skipEpochConversion: true });
    const candidateResult = projectToDeliveryOutcome(
      candidateState.researchLevels,
      candidateSnapshot,
      simTime + timeToBuySeconds
    );

    if (candidateResult.endSnapshot.elr < baseline.endSnapshot.elr) {
      rejectedIds.add(candidate.research.id);
      continue;
    }

    simState = candidateState;
    simSnapshot = candidateSnapshot;
    simTime += timeToBuySeconds;
    purchases.push({ researchId: candidate.research.id, price: candidate.price, purchaseTimestamp: simTime });
    // This candidate's own "with purchase" run already IS the next baseline — see this function's
    // own doc comment (step 3) for why recomputing it fresh next iteration would be redundant.
    baseline = candidateResult;
  }

  return {
    purchases,
    endLevels: simState.researchLevels,
    endSnapshot: simSnapshot,
  };
}

/**
 * Dry run of the threshold-based buy flow shared by Quick Buy's one-time click and Auto Buy's
 * background sweep — mirrors `handleThresholdBuy`. Never simulates a wait (matches Quick Buy/Auto
 * Buy's real "buy instantly at today's price" behavior) — just repeatedly buys whatever's already
 * affordable within `thresholdSeconds` until nothing else qualifies.
 */
export function simulateThresholdBuy(
  researchLevels: Record<string, number>,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  isSale: boolean,
  thresholdSeconds: number
): SimpleBuyPlan {
  let simState: EngineState = { ...createBaseEngineState(snapshot), researchLevels: { ...researchLevels } };
  let simSnapshot = snapshot;
  const researchIds: string[] = [];
  let totalSecondsToSave = 0;
  let totalGemsSpent = 0;

  for (let i = 0; i < MAX_SIMULATED_PURCHASES; i++) {
    const candidate = findSmartBuyCandidate(simState.researchLevels, mods, isSale, simSnapshot, thresholdSeconds);
    if (!candidate) break;
    const level = simState.researchLevels[candidate.research.id] || 0;
    simState = applyAction(simState, buyResearchAction(candidate.research.id, level, candidate.price));
    // See `simulateSaleAwareBuy`'s identical comment — keeps `lastStepTime` in its incoming frame
    // across this loop's repeated snapshots instead of risking a mid-loop epoch flip.
    simSnapshot = computeSnapshot(simState, context, { skipEpochConversion: true });
    researchIds.push(candidate.research.id);
    totalSecondsToSave += candidate.secondsToSave;
    totalGemsSpent += candidate.price;
  }

  return {
    researchIds,
    endLevels: simState.researchLevels,
    endSnapshot: simSnapshot,
    totalSecondsToSave,
    totalGemsSpent,
  };
}

export interface ResearchSummaryItem {
  text: string;
  premium?: boolean;
}

/**
 * Compact "what changed" summary in `CuriositySummary.vue`'s visual language (contiguous
 * maxed-tier ranges collapse to "Max Tier(s) X(-Y)", everything else reads as "Name (start -> end)"
 * or "Max Name") — a trimmed, non-Vue port of that component's grouping algorithm, driven by two
 * plain level maps instead of an executed `Action[]` list (so it works for a hypothetical plan, not
 * just real history) and without the action-id/click-to-scroll behavior (nothing to scroll to for a
 * purchase that hasn't happened).
 */
export function summarizeResearchLevelChanges(
  startLevels: Record<string, number>,
  endLevels: Record<string, number>
): ResearchSummaryItem[] {
  const items: ResearchSummaryItem[] = [];

  const modifiedResearchIds = new Set<string>();
  const modifiedTiers = new Set<number>();
  for (const r of getCommonResearches()) {
    const start = startLevels[r.id] || 0;
    const end = endLevels[r.id] || 0;
    if (end > start) {
      modifiedResearchIds.add(r.id);
      modifiedTiers.add(r.tier);
    }
  }
  if (modifiedResearchIds.size === 0) return [];

  const maxedTiers: number[] = [];
  const handledResearchIds = new Set<string>();
  const researchByTier = getResearchByTier();
  const sortedModifiedTiers = Array.from(modifiedTiers).sort((a, b) => a - b);

  for (const tier of sortedModifiedTiers) {
    const tierResearches = researchByTier.get(tier) || [];
    const isTierMaxed = tierResearches.every(r => (endLevels[r.id] || 0) >= r.levels);
    if (isTierMaxed) {
      maxedTiers.push(tier);
      tierResearches.forEach(r => handledResearchIds.add(r.id));
    }
  }

  if (maxedTiers.length > 0) {
    let rangeStart = maxedTiers[0];
    let prev = maxedTiers[0];
    for (let i = 1; i <= maxedTiers.length; i++) {
      const curr = maxedTiers[i];
      if (curr === prev + 1) {
        prev = curr;
      } else {
        items.push({
          premium: true,
          text: rangeStart === prev ? `Max Tier ${rangeStart}` : `Max Tiers ${rangeStart}-${prev}`,
        });
        rangeStart = curr;
        prev = curr;
      }
    }
  }

  const remaining = Array.from(modifiedResearchIds)
    .filter(id => !handledResearchIds.has(id))
    .map(id => getResearchById(id)!)
    .sort((a, b) => a.serial_id - b.serial_id);

  for (const r of remaining) {
    const startLevel = startLevels[r.id] || 0;
    const finalLevel = endLevels[r.id] || 0;
    if (startLevel >= finalLevel) continue;
    const isMaxed = finalLevel >= r.levels;
    items.push({
      text: isMaxed ? `Max ${r.name}` : `${r.name} (${startLevel} -> ${finalLevel})`,
    });
  }

  return items;
}
