import {
  type CommonResearch,
  getCommonResearches,
  getDiscountedVirtuePrice,
  isTierUnlocked,
  type ResearchCostModifiers,
} from './commonResearch';
import {
  calculateResearchROI,
  getSaleAwareTimeToSave,
  isActuallyDuringSale,
  meetsROIByDeadline,
  computeShowBuyNowRoiWarning,
  computeShowFullRoiWarning,
  MAX_ROI_PAYBACK_SEARCH_SECONDS,
  findEventCrossings,
  type PurchaseEventCrossings,
} from './researchROI';
import { calculateMaxVehicleSlots, calculateMaxTrainLength } from './shippingCapacity';
import { getOptimalELRSet } from '@/lib/artifacts/virtue';
import { calculateArtifactModifiers } from '@/lib/artifacts';
import { computeRealisticELR } from './realisticELR';
import type { SimulationContext, EngineState } from '@/engine/types';
import type { CalculationsSnapshot } from '@/types';
import { computeSnapshot } from '@/engine/compute';
import { createBaseEngineState } from '@/engine/adapter';
import { applyAction, applyTime, getTimeToSave, calculateEarningsForTime, boostTransitionsFrom } from '@/engine/apply';
import { createSimAction } from '@/types/actions/meta';
import { getNextPacificTime, isEarningsBoostActive, isResearchSaleActive } from '@/lib/events';
import { ei } from 'lib';

// Research categories to exclude from specific ranking views
const ROI_EXCLUDED_CATEGORIES = [
  'hatchery_capacity',
  'internal_hatchery_rate',
  'running_chicken_bonus',
  'hatchery_refill_rate',
];
const ELR_EXCLUDED_CATEGORIES = [
  'hatchery_capacity',
  'internal_hatchery_rate',
  'running_chicken_bonus',
  'hatchery_refill_rate',
  'egg_value',
];
const DELIVERY_IMPACT_CATEGORIES = new Set(['hab_capacity', 'fleet_size', 'egg_laying_rate', 'shipping_capacity']);

// Evaluation IDs for ELR "potential" mode
const FLEET_RESEARCH_IDS = [
  'vehicle_reliablity',
  'excoskeletons',
  'traffic_management',
  'egg_loading_bots',
  'autonomous_vehicles',
];
const TRAIN_CAR_RESEARCH_ID = 'micro_coupling';

function filterByCategories(r: CommonResearch, excluded: string[]): boolean {
  const categories = r.categories.split(',').map(c => c.trim());
  return !categories.some(c => excluded.includes(c));
}

function buildMaxVehiclesSnapshot(
  baseSnapshot: CalculationsSnapshot,
  researchLevels: Record<string, number>,
  context: SimulationContext
): CalculationsSnapshot {
  const maxSlots = calculateMaxVehicleSlots(researchLevels);
  const maxTrainLen = calculateMaxTrainLength(researchLevels);
  const engineState = createBaseEngineState(baseSnapshot);
  const modifiedState = {
    ...engineState,
    researchLevels,
    vehicles: Array(maxSlots)
      .fill(null)
      .map(() => ({ vehicleId: 11, trainLength: maxTrainLen })),
  };
  // `skipEpochConversion` keeps `lastStepTime` in `baseSnapshot`'s own reference frame — this is a
  // hypothetical "what if maxed" snapshot built FROM an existing snapshot, not a fresh ascension
  // state, so it must not re-trigger the one-time epoch/catch-up conversion `computeSnapshot` does
  // for genuinely fresh states (see `smartBuyPreview.ts`'s `simulateSaleAwareBuy` for the full story
  // on what happens when a loop's repeated snapshots don't skip it).
  return computeSnapshot(modifiedState, context, { skipEpochConversion: true });
}

/**
 * Common shape for a ranked research candidate. Raw numeric data only — no formatted
 * strings/labels (those are a view-layer concern, derived by the caller, same convention as
 * `calculateResearchROI` and `milestoneChain.ts`). Not every field is populated by every ranking
 * function: the ROI-specific fields are only set by `rankResearchByROI`, the ELR-specific fields
 * only by `rankResearchByELRImpact`.
 */
export interface ResearchRankingItem {
  research: CommonResearch;
  price: number;
  currentLevel: number;
  targetLevel: number;
  canBuy: boolean;
  // Only set by rankResearchByROI. rankResearchByELRImpact intentionally leaves this unset —
  // matching the pre-hoist behavior — so callers fall back to computing it live off the current
  // earnings rate instead of a value that may already be stale by the time it's read.
  timeToBuySeconds?: number;

  // ROI ranking fields (rankResearchByROI)
  roiSeconds?: number;
  totalRoiSeconds?: number;
  pairRoiSeconds?: number;
  pairPartnerResearch?: CommonResearch;
  isLaying?: boolean;
  isShipping?: boolean;

  // ELR ranking fields (rankResearchByELRImpact)
  impact?: number;
  hpp?: number;
  timeRoiSeconds?: number;
  realisticStats?: { layRate: number; shippingRate: number; elr: number; elrDelta: number };
  lookahead?: {
    minLevels: number;
    impact: number;
    hpp: number;
    timeRoiSeconds: number;
    realisticStats: { layRate: number; shippingRate: number; elr: number; elrDelta: number };
  };

  showSaleWarning?: boolean;
  showDeadlineWarning?: boolean;
  // Smart Buy's own two gates (see calculateResearchROI's doc comments in researchROI.ts) — only
  // ever set (and only ever read) by the sale-aware buy flow (`rankResearchByROI`'s own
  // `fullRoiDeadline` param, via `simulateSaleAwareBuy`). Every other consumer of this ranking (ROI
  // view, milestone chain) ignores both.
  showBuyNowRoiWarning?: boolean;
  showFullRoiWarning?: boolean;

  // Whether this candidate's price reflects a research sale (decision-time truth, matching what
  // would actually be charged), and whether the wait to afford it would complete during a 2x
  // earnings boost — same semantics as MilestoneChainItem's fields of the same name.
  duringSale: boolean;
  duringEarningsBoost: boolean;
  // Only set by rankResearchByROI — the extra $/sec this purchase would add to earnings once
  // bought (already computed internally via calculateResearchROI, just not previously surfaced).
  // Not a meaningful concept for rankResearchByELRImpact's lay-rate/shipping-impact candidates.
  earningsDelta?: number;
}

/**
 * Ranks unpurchased research by earnings ROI (how fast it pays for itself), with the "immediate
 * impact" mode's bottleneck-pairing logic: a laying/shipping research with poor solo ROI (because
 * the other side of the pipeline bottlenecks it) is paired with the best-ROI research on the
 * *other* side, and ranked by their combined payback time if that's better than either alone.
 */
export function rankResearchByROI(
  researchLevels: Record<string, number>,
  startSnapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  isSale: boolean,
  absoluteSimTime: number,
  researchSaleDeadline: number,
  roiMode: 'immediate' | 'maxed_vehicles',
  deliveryImpactOnly: boolean,
  // Deadline `showSaleWarning` (the OLD, single-gate field — still used as-is by the ROI view and by
  // `milestoneChain.ts`'s `sweepUntilNextSale`/`findRoiDetour`, both out of scope for the Smart Buy
  // redesign per decision #1) judges 70%-ROI payback against. Defaults to the calendar's very next
  // sale start; callers already committed to riding out several sales in a row can pass a later
  // deadline instead — see `ROICalculationInput.eventTiming.roiDeadline`'s own doc comment. Completely
  // independent of `fullRoiDeadline` below, which feeds Smart Buy's own two NEW gates instead of this
  // one — see that parameter's own doc comment for why the two don't interact.
  roiDeadlineOverride?: number,
  // Smart Buy's "100% by ride end" gate (Gate B) deadline — see `computeShowFullRoiWarning`'s doc
  // comment (researchROI.ts) for the full two-gate design this feeds. `undefined` for every caller
  // except the sale-aware buy flow's NEW dual-gate mode (`simulateSaleAwareBuy`, only when it itself
  // receives a `fullRoiDeadline`) — makes `showFullRoiWarning` an unconditional `false`, a no-op.
  // Deliberately does NOT affect `roiDeadline`/`showSaleWarning` above in any way — Smart Buy's own
  // near-term gate (`showBuyNowRoiWarning`) is judged independently, against the immediate next sale
  // or bypassed while already mid-sale, never against this value or `roiDeadlineOverride` above. See
  // SMART_BUY_DUAL_ROI_DESIGN.md §2.3.
  fullRoiDeadline?: number
): ResearchRankingItem[] {
  const baseState = createBaseEngineState(startSnapshot);
  const currentEarnings = startSnapshot.offlineEarnings;

  const calendarNextSaleStart = getNextPacificTime(5, 9, absoluteSimTime);
  // `Math.max`, not a plain `??`: `roiDeadlineOverride` is typically a FIXED point a caller
  // computed once up front (e.g. a milestone-chain caller riding out several sales), threaded
  // unchanged through many rounds as simulated time advances. Once `absoluteSimTime` catches up to
  // or passes it, using it as-is would hand `meetsROIByDeadline` a deadline at-or-before "now,"
  // making every candidate fail regardless of economics — the opposite of the intended generosity.
  // Falling back to whichever's later keeps the override purely additive: it can only grant MORE
  // runway than the calendar default, never less.
  const roiDeadline =
    roiDeadlineOverride !== undefined ? Math.max(roiDeadlineOverride, calendarNextSaleStart) : calendarNextSaleStart;
  // Computed once and reused for every candidate below — all candidates share the same
  // `startSnapshot`/`absoluteSimTime`, so redoing `boostTransitionsFrom`'s (multi-year-horizon)
  // walk per-candidate would multiply an already expensive operation by the candidate count.
  const transitions = boostTransitionsFrom(startSnapshot, absoluteSimTime);

  if (currentEarnings <= 0) return [];

  const unpurchased = getCommonResearches().filter(
    r => (researchLevels[r.id] || 0) < r.levels && filterByCategories(r, ROI_EXCLUDED_CATEGORIES)
  );
  const uniqueUnpurchased = Array.from(new Map(unpurchased.map(r => [r.id, r])).values());

  const baseMaxVehiclesSnapshot =
    roiMode === 'maxed_vehicles' ? buildMaxVehiclesSnapshot(startSnapshot, researchLevels, context) : null;

  const basicCandidates = uniqueUnpurchased.map(r => {
    const level = researchLevels[r.id] || 0;
    const canBuy = isTierUnlocked(researchLevels, r.tier);
    const categories = r.categories.split(',').map(c => c.trim());
    const isLaying = categories.includes('egg_laying_rate');
    const isShipping = categories.includes('shipping_capacity');

    let roiSeconds: number;
    let totalRoiSeconds: number;
    let showSaleWarning: boolean;
    let showDeadlineWarning: boolean;
    let showBuyNowRoiWarning: boolean;
    let showFullRoiWarning: boolean;
    let resultTimeToBuySeconds: number;
    let resultEarningsDelta: number;
    let resultPrice: number;
    let resultDuringSale: boolean;
    let nextSnapshot: CalculationsSnapshot;

    if (roiMode === 'maxed_vehicles' && baseMaxVehiclesSnapshot) {
      const purchase = getSaleAwareTimeToSave(r, level, mods, isSale, absoluteSimTime, startSnapshot, transitions);
      resultPrice = purchase.price;
      resultDuringSale = purchase.duringSale;
      resultTimeToBuySeconds = purchase.waitSeconds;
      const afterMaxSnapshot = buildMaxVehiclesSnapshot(
        startSnapshot,
        { ...researchLevels, [r.id]: level + 1 },
        context
      );
      nextSnapshot = afterMaxSnapshot;
      const maxTime = MAX_ROI_PAYBACK_SEARCH_SECONDS;
      const getExtra = (t: number) =>
        calculateEarningsForTime(t, afterMaxSnapshot) - calculateEarningsForTime(t, baseMaxVehiclesSnapshot);
      if (getExtra(maxTime) >= resultPrice) {
        let low = 0,
          high = maxTime;
        for (let i = 0; i < 60; i++) {
          const mid = (low + high) / 2;
          if (getExtra(mid) >= resultPrice) high = mid;
          else low = mid;
        }
        roiSeconds = high;
      } else {
        roiSeconds = Infinity;
      }
      totalRoiSeconds = isFinite(resultTimeToBuySeconds) ? resultTimeToBuySeconds + roiSeconds : Infinity;
      resultEarningsDelta = roiSeconds !== Infinity && roiSeconds > 0 ? resultPrice / roiSeconds : 0;
      // Must match the `immediate` mode's check (`calculateResearchROI`'s `showSaleWarning`) exactly:
      // a real 70%-payback-by-deadline test, not just "does this complete before the deadline," and
      // NOT waived just because this purchase happens to land during a real sale — a discount
      // doesn't make a slow payback fast (see `roiDeadline`'s own doc comment above). The old
      // version here only checked completion time, so a purchase that finishes early but never pays
      // for itself (`resultEarningsDelta === 0`, i.e. `roiSeconds` hit the `Infinity` branch above)
      // still passed — which is exactly how a slow, unprofitable item like `timeline_diversion` kept
      // getting bought after the next sale start had already rolled forward past a completed sale,
      // dragging the loop out to the sale *after* next.
      showSaleWarning = !meetsROIByDeadline(
        resultEarningsDelta,
        resultPrice,
        absoluteSimTime + resultTimeToBuySeconds,
        roiDeadline,
        70
      );
      showDeadlineWarning =
        isResearchSaleActive(absoluteSimTime) && absoluteSimTime + resultTimeToBuySeconds > researchSaleDeadline;
      // Smart Buy's own two gates — same `computeShowBuyNowRoiWarning`/`computeShowFullRoiWarning`
      // (researchROI.ts) `calculateResearchROI` itself calls, since this branch's ROI math never
      // routes through that function.
      {
        const maxedVehiclesCompletesAt = absoluteSimTime + resultTimeToBuySeconds;
        showBuyNowRoiWarning = computeShowBuyNowRoiWarning(
          resultDuringSale,
          resultEarningsDelta,
          resultPrice,
          maxedVehiclesCompletesAt,
          absoluteSimTime
        );
        showFullRoiWarning = computeShowFullRoiWarning(
          resultEarningsDelta,
          resultPrice,
          maxedVehiclesCompletesAt,
          fullRoiDeadline
        );
      }
    } else {
      const roiResult = calculateResearchROI({
        research: r,
        level,
        mods,
        snapshot: startSnapshot,
        context,
        eventTiming: {
          absoluteSimTime,
          roiDeadline,
          researchSaleDeadline,
          isSaleActive: isSale,
          transitions,
          fullRoiDeadline,
        },
      });
      ({
        roiSeconds,
        totalRoiSeconds,
        showSaleWarning,
        showDeadlineWarning,
        showBuyNowRoiWarning,
        showFullRoiWarning,
        nextSnapshot,
      } = roiResult);
      resultTimeToBuySeconds = roiResult.timeToBuySeconds;
      resultEarningsDelta = roiResult.earningsDelta;
      resultPrice = roiResult.price;
      resultDuringSale = roiResult.duringSale;
    }

    return {
      research: r,
      price: resultPrice,
      currentLevel: level,
      targetLevel: level + 1,
      timeToBuySeconds: resultTimeToBuySeconds,
      canBuy,
      roiSeconds,
      totalRoiSeconds,
      isLaying,
      isShipping,
      nextSnapshot,
      showSaleWarning,
      showDeadlineWarning,
      showBuyNowRoiWarning,
      showFullRoiWarning,
      earningsDelta: resultEarningsDelta,
      duringSale: resultDuringSale,
      duringEarningsBoost: isEarningsBoostActive(absoluteSimTime + resultTimeToBuySeconds),
    };
  });

  const bestLaying = [...basicCandidates]
    .filter(c => c.isLaying && c.canBuy && c.roiSeconds !== Infinity)
    .sort((a, b) => a.roiSeconds - b.roiSeconds)[0];

  const bestShipping = [...basicCandidates]
    .filter(c => c.isShipping && c.canBuy && c.roiSeconds !== Infinity)
    .sort((a, b) => a.roiSeconds - b.roiSeconds)[0];

  return basicCandidates
    .map((c): ResearchRankingItem => {
      let pairRoiSeconds: number | undefined;
      let pairPartnerResearch: CommonResearch | undefined;
      let showSaleWarning = c.showSaleWarning;
      let showBuyNowRoiWarning = c.showBuyNowRoiWarning;
      let showFullRoiWarning = c.showFullRoiWarning;

      if (roiMode === 'immediate') {
        const isBottlenecked = c.roiSeconds === Infinity || c.roiSeconds > 3600 * 24 * 7;

        if (isBottlenecked && (c.isLaying || c.isShipping)) {
          const partner = c.isLaying ? bestShipping : bestLaying;
          if (partner && partner.research.id !== c.research.id) {
            const level1 = researchLevels[c.research.id] || 0;
            const level2 = researchLevels[partner.research.id] || 0;

            let pairState = applyAction(
              baseState,
              createSimAction(
                'buy_research',
                {
                  researchId: c.research.id,
                  fromLevel: level1,
                  toLevel: level1 + 1,
                },
                c.price
              )
            );

            pairState = applyAction(
              pairState,
              createSimAction(
                'buy_research',
                {
                  researchId: partner.research.id,
                  fromLevel: level2,
                  toLevel: level2 + 1,
                },
                partner.price
              )
            );

            // Hypothetical "bought both" snapshot built FROM `baseState`, not a fresh ascension
            // state — see `buildMaxVehiclesSnapshot`'s identical comment above.
            const pairSnapshot = computeSnapshot(pairState, context, { skipEpochConversion: true });
            const pairEarnings = pairSnapshot.offlineEarnings;
            const partnerEarnings = partner.nextSnapshot.offlineEarnings;

            if (pairEarnings > partnerEarnings) {
              const pairTotalCost = c.price + partner.price;
              const pairDelta = pairEarnings - currentEarnings;
              const combinedRoiSeconds = pairTotalCost / pairDelta;

              if (combinedRoiSeconds < c.roiSeconds) {
                pairRoiSeconds = combinedRoiSeconds;
                pairPartnerResearch = partner.research;

                // This item alone won't reach 70% payback before the deadline, but it only makes
                // sense to buy as part of the pair — so judge the sale warning against the pair's
                // combined payback time instead of this item's solo ROI. Not waived just because
                // this purchase happens to land during a real sale, same as the solo case above —
                // see `roiDeadline`'s own doc comment.
                //
                // An earlier version of this check used `!isResearchSaleActive(absoluteSimTime)` —
                // "is a real sale active right now, at evaluation time" — as a blanket permission to
                // waive the warning. That's the wrong question: it doesn't matter whether a sale
                // happens to be active THIS INSTANT, only whether THIS purchase's own completion
                // (`absoluteSimTime + c.timeToBuySeconds`) pays off by `roiDeadline`. Evaluating late
                // in a real sale's window (as here — this render's `absoluteSimTime` can land minutes
                // before that sale's own end) made `isResearchSaleActive` true and permanently
                // disabled the warning for every bottlenecked laying/shipping candidate with any
                // viable partner, regardless of how far past the deadline its actual completion time
                // was. This is exactly how a slow, partner-bottlenecked research (e.g. one with
                // `roiSeconds: Infinity`) kept getting bought well past the next real sale, dragging
                // `handleBuyUntilSaleWarning` out by extra days each time.
                showSaleWarning = !meetsROIByDeadline(
                  pairDelta,
                  pairTotalCost,
                  absoluteSimTime + c.timeToBuySeconds,
                  roiDeadline,
                  70
                );

                // Smart Buy's own two gates need the same pair-aware override, and for the same
                // reason: this candidate's solo earningsDelta/price are meaningless (that's what
                // "bottlenecked" means), so both must be judged against the pair's combined
                // economics instead — see `computeShowBuyNowRoiWarning`/`computeShowFullRoiWarning`'s
                // own doc comments in researchROI.ts for what each gate actually checks. `c.duringSale`
                // (the anchor candidate's own resolved pricing) is reused for the bypass check, same
                // as `pairCompletesAt` reuses the anchor's own `timeToBuySeconds` above — the partner
                // is priced/bought AFTER `c` finishes, so `c`'s own timing is what "is this pair
                // purchase landing in a sale" should be judged against.
                const pairCompletesAt = absoluteSimTime + c.timeToBuySeconds;
                showBuyNowRoiWarning = computeShowBuyNowRoiWarning(
                  c.duringSale,
                  pairDelta,
                  pairTotalCost,
                  pairCompletesAt,
                  absoluteSimTime
                );
                showFullRoiWarning = computeShowFullRoiWarning(
                  pairDelta,
                  pairTotalCost,
                  pairCompletesAt,
                  fullRoiDeadline
                );
              }
            }
          }
        }
      }

      return {
        research: c.research,
        price: c.price,
        currentLevel: c.currentLevel,
        targetLevel: c.targetLevel,
        timeToBuySeconds: c.timeToBuySeconds,
        canBuy: c.canBuy,
        roiSeconds: c.roiSeconds,
        totalRoiSeconds: c.totalRoiSeconds,
        isLaying: c.isLaying,
        isShipping: c.isShipping,
        pairRoiSeconds,
        pairPartnerResearch,
        showSaleWarning,
        showDeadlineWarning: c.showDeadlineWarning,
        showBuyNowRoiWarning,
        showFullRoiWarning,
        earningsDelta: c.earningsDelta,
        duringSale: c.duringSale,
        duringEarningsBoost: c.duringEarningsBoost,
      };
    })
    .filter(c => {
      if (!deliveryImpactOnly) return true;
      const cats = c.research.categories.split(',').map(s => s.trim());
      return cats.some(cat => DELIVERY_IMPACT_CATEGORIES.has(cat));
    })
    .sort((a, b) => {
      if (a.canBuy !== b.canBuy) return a.canBuy ? -1 : 1;
      const aSortSeconds =
        a.pairRoiSeconds !== undefined ? Math.min(a.totalRoiSeconds!, a.pairRoiSeconds) : a.totalRoiSeconds!;
      const bSortSeconds =
        b.pairRoiSeconds !== undefined ? Math.min(b.totalRoiSeconds!, b.pairRoiSeconds) : b.totalRoiSeconds!;
      if (aSortSeconds === bSortSeconds) {
        return a.price - b.price;
      }
      return aSortSeconds - bSortSeconds;
    });
}

/**
 * Ranks unpurchased research by Delivery Rate impact. `realistic` mode runs the full pipeline
 * (optimal artifacts + max habs/vehicles via `getOptimalELRSet`/`computeRealisticELR`), with a
 * lookahead search for multi-level research where level+1 alone has zero impact. `potential` mode
 * uses a cheaper formula-based estimate instead. Both compute `hpp` (hours per impact-percentage-
 * point) and can be sorted by it (`efficiency`) or by raw impact (`impact`).
 *
 * `realistic` mode's `getOptimalELRSet` calls (one baseline call, then one per candidate, then up
 * to `r.levels - level` more per candidate inside the lookahead search) all reuse the baseline
 * call's own artifact structure via `forcedArtifacts` rather than each re-running their own
 * up-to-495-combo search — see that option's own doc comment in virtue.ts for why the structure is
 * safe to hold fixed across every one of these calls even though stone placement isn't.
 */
export function rankResearchByELRImpact(
  researchLevels: Record<string, number>,
  rawBackup: ei.IBackup | null | undefined,
  startSnapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  isSale: boolean,
  absoluteSimTime: number,
  researchSaleDeadline: number,
  viewMode: 'realistic' | 'potential',
  sortMode: 'efficiency' | 'impact'
): ResearchRankingItem[] {
  const unpurchased = getCommonResearches().filter(
    r => (researchLevels[r.id] || 0) < r.levels && filterByCategories(r, ELR_EXCLUDED_CATEGORIES)
  );
  const uniqueUnpurchased = Array.from(new Map(unpurchased.map(r => [r.id, r])).values());

  let candidates: ResearchRankingItem[];

  if (viewMode === 'realistic') {
    if (!rawBackup) return [];

    const baselineOptimal = getOptimalELRSet(rawBackup, {
      assumeMaxHabsVehicles: true,
      excludeGusset: false,
      commonResearch: researchLevels,
      epicResearchLevels: context.epicResearchLevels,
      colleggtibleModifiers: context.colleggtibleModifiers,
    });
    const baselineArtifactMods = calculateArtifactModifiers(baselineOptimal);
    const baseline = computeRealisticELR(
      researchLevels,
      baselineArtifactMods,
      context.epicResearchLevels,
      context.colleggtibleModifiers
    );

    if (baseline.effectiveRate <= 0) return [];

    // Which ARTIFACTS are worth equipping is driven by owned inventory and target-artifact tiers —
    // nothing a research purchase changes — so the structure this baseline call already searched
    // for stays optimal for every candidate/lookahead evaluation below too; only stone placement
    // (tachyon vs. quantum per slot) actually depends on the research state, since that's decided
    // by which of lay rate/shipping capacity is the current bottleneck. Every `getOptimalELRSet`
    // call below force-feeds this same structure via `forcedArtifacts` so it skips straight to
    // re-solving stones, rather than repeating the up-to-495-combo structure search unchanged.
    const baselineArtifactIds = baselineOptimal.map(slot => slot.artifactId);

    candidates = uniqueUnpurchased
      .map((r): ResearchRankingItem => {
        const level = researchLevels[r.id] || 0;
        // Two separate sale-aware decisions: "no bank" is a fair cross-item comparison metric
        // (hpp/timeRoiSeconds), "with bank" is what actually gets charged/shown — they can
        // legitimately disagree about whether waiting for the sale wins, since a bigger bank
        // shortens the "buy now" wait without changing the "wait for sale" one.
        const noBankSnapshot = { ...startSnapshot, bankValue: 0 };
        const transitions = boostTransitionsFrom(startSnapshot, absoluteSimTime);
        const noBankPurchase = getSaleAwareTimeToSave(
          r,
          level,
          mods,
          isSale,
          absoluteSimTime,
          noBankSnapshot,
          transitions
        );
        const withBankPurchase = getSaleAwareTimeToSave(
          r,
          level,
          mods,
          isSale,
          absoluteSimTime,
          startSnapshot,
          transitions
        );
        const price = withBankPurchase.price;
        const secondsToBuyNoBank = noBankPurchase.waitSeconds;
        const secondsToBuyWithBank = withBankPurchase.waitSeconds;

        const tempLevels = { ...researchLevels, [r.id]: level + 1 };
        const tempOptimal = getOptimalELRSet(rawBackup, {
          assumeMaxHabsVehicles: true,
          excludeGusset: false,
          commonResearch: tempLevels,
          epicResearchLevels: context.epicResearchLevels,
          colleggtibleModifiers: context.colleggtibleModifiers,
          forcedArtifacts: baselineArtifactIds,
        });
        const tempArtifactMods = calculateArtifactModifiers(tempOptimal);
        const stats = computeRealisticELR(
          tempLevels,
          tempArtifactMods,
          context.epicResearchLevels,
          context.colleggtibleModifiers
        );
        const impact = (stats.effectiveRate - baseline.effectiveRate) / baseline.effectiveRate;

        const hoursToBuy = secondsToBuyNoBank / 3600;
        const hpp = impact > 0 ? hoursToBuy / (impact * 100) : Infinity;
        const timeRoiSeconds = impact > 0 ? secondsToBuyNoBank / impact : Infinity;

        // Lookahead: find the minimum N levels that unlock positive ELR impact.
        let lookahead:
          | {
              minLevels: number;
              impact: number;
              hpp: number;
              timeRoiSeconds: number;
              realisticStats: { layRate: number; shippingRate: number; elr: number; elrDelta: number };
            }
          | undefined;
        if (impact <= 0 && level + 1 < r.levels) {
          for (let n = 2; n <= r.levels - level; n++) {
            const laLevels = { ...researchLevels, [r.id]: level + n };
            const laOptimal = getOptimalELRSet(rawBackup, {
              assumeMaxHabsVehicles: true,
              excludeGusset: false,
              commonResearch: laLevels,
              epicResearchLevels: context.epicResearchLevels,
              colleggtibleModifiers: context.colleggtibleModifiers,
              forcedArtifacts: baselineArtifactIds,
            });
            const laArtifactMods = calculateArtifactModifiers(laOptimal);
            const laStats = computeRealisticELR(
              laLevels,
              laArtifactMods,
              context.epicResearchLevels,
              context.colleggtibleModifiers
            );
            const laImpact = (laStats.effectiveRate - baseline.effectiveRate) / baseline.effectiveRate;
            if (laImpact > 0) {
              let totalPriceForN = 0;
              for (let l = level; l < level + n; l++) {
                totalPriceForN += getDiscountedVirtuePrice(r, l, mods, isSale);
              }
              const totalSecondsForN = getTimeToSave(totalPriceForN, noBankSnapshot);
              const totalHoursForN = totalSecondsForN / 3600;
              lookahead = {
                minLevels: n,
                impact: laImpact,
                hpp: totalHoursForN / (laImpact * 100),
                timeRoiSeconds: totalSecondsForN / laImpact,
                realisticStats: {
                  layRate: laStats.layRate * 3600,
                  shippingRate: laStats.shippingRate * 3600,
                  elr: laStats.effectiveRate * 3600,
                  elrDelta: (laStats.effectiveRate - baseline.effectiveRate) * 3600,
                },
              };
              break;
            }
          }
        }

        return {
          research: r,
          price,
          currentLevel: level,
          targetLevel: level + 1,
          canBuy: isTierUnlocked(researchLevels, r.tier),
          impact,
          hpp,
          timeRoiSeconds,
          lookahead,
          realisticStats: {
            layRate: stats.layRate * 3600,
            shippingRate: stats.shippingRate * 3600,
            elr: stats.effectiveRate * 3600,
            elrDelta: (stats.effectiveRate - baseline.effectiveRate) * 3600,
          },
          showDeadlineWarning:
            isResearchSaleActive(absoluteSimTime) && absoluteSimTime + secondsToBuyWithBank > researchSaleDeadline,
          duringSale: isActuallyDuringSale(
            withBankPurchase.duringSale,
            absoluteSimTime + secondsToBuyWithBank,
            absoluteSimTime
          ),
          duringEarningsBoost: isEarningsBoostActive(absoluteSimTime + secondsToBuyWithBank),
        };
      })
      .filter(c => (c.impact ?? 0) > 0 || c.lookahead !== undefined);
  } else {
    const currentSlots = calculateMaxVehicleSlots(researchLevels);
    const currentMaxCars = calculateMaxTrainLength(researchLevels);

    candidates = uniqueUnpurchased
      .map((r): ResearchRankingItem => {
        const level = researchLevels[r.id] || 0;
        // Two separate sale-aware decisions: "no bank" is a fair cross-item comparison metric
        // (hpp/timeRoiSeconds), "with bank" is what actually gets charged/shown — they can
        // legitimately disagree about whether waiting for the sale wins, since a bigger bank
        // shortens the "buy now" wait without changing the "wait for sale" one.
        const noBankSnapshot = { ...startSnapshot, bankValue: 0 };
        const transitions = boostTransitionsFrom(startSnapshot, absoluteSimTime);
        const noBankPurchase = getSaleAwareTimeToSave(
          r,
          level,
          mods,
          isSale,
          absoluteSimTime,
          noBankSnapshot,
          transitions
        );
        const withBankPurchase = getSaleAwareTimeToSave(
          r,
          level,
          mods,
          isSale,
          absoluteSimTime,
          startSnapshot,
          transitions
        );
        const price = withBankPurchase.price;
        const secondsToBuyNoBank = noBankPurchase.waitSeconds;
        const secondsToBuyWithBank = withBankPurchase.waitSeconds;
        const impact = FLEET_RESEARCH_IDS.includes(r.id)
          ? 1 / currentSlots
          : r.id === TRAIN_CAR_RESEARCH_ID
            ? 1 / currentMaxCars
            : r.per_level / (1 + level * r.per_level);

        const hoursToBuy = secondsToBuyNoBank / 3600;
        const hpp = impact > 0 ? hoursToBuy / (impact * 100) : Infinity;
        const timeRoiSeconds = impact > 0 ? secondsToBuyNoBank / impact : Infinity;

        return {
          research: r,
          price,
          currentLevel: level,
          targetLevel: level + 1,
          canBuy: isTierUnlocked(researchLevels, r.tier),
          impact,
          hpp,
          timeRoiSeconds,
          showDeadlineWarning:
            isResearchSaleActive(absoluteSimTime) && absoluteSimTime + secondsToBuyWithBank > researchSaleDeadline,
          duringSale: isActuallyDuringSale(
            withBankPurchase.duringSale,
            absoluteSimTime + secondsToBuyWithBank,
            absoluteSimTime
          ),
          duringEarningsBoost: isEarningsBoostActive(absoluteSimTime + secondsToBuyWithBank),
        };
      })
      .filter(c => (c.impact ?? 0) > 0);
  }

  if (sortMode === 'efficiency') {
    candidates.sort((a, b) => {
      if (a.canBuy !== b.canBuy) return a.canBuy ? -1 : 1;
      if (isFinite(a.hpp!) || isFinite(b.hpp!)) {
        if (a.hpp !== b.hpp) return a.hpp! - b.hpp!;
      }
      return b.impact! - a.impact!;
    });
  } else {
    candidates.sort((a, b) => {
      if (a.canBuy !== b.canBuy) return a.canBuy ? -1 : 1;
      if (a.impact !== b.impact) return b.impact! - a.impact!;
      return a.hpp! - b.hpp!;
    });
  }

  // Note: `hpp`/`timeRoiSeconds`/`realisticStats`/`impact` above are the item's own (pre-lookahead)
  // values; when `lookahead` is set, the caller displays *its* hpp/timeRoiSeconds/realisticStats/
  // impact instead (this item alone has no positive impact, so its own stats aren't meaningful to
  // show) — that swap is a view-layer formatting choice, done by the caller, not baked in here.
  return candidates;
}

/**
 * Shared "buy the next passing candidate, repeat" loop shape behind the manual planner's "Buy
 * Until Sale Warning" / "Buy Until Sale Ends" buttons and the auto-planner's equivalents.
 * `getCandidate` re-ranks and picks the next candidate each call — the caller closes over
 * whatever current state it's re-ranking against (Pinia stores for the manual planner, a mutable
 * `EngineState` for the auto planner) — so buying research on one iteration is reflected in the
 * next call's ranking.
 */
export function buyWhilePassingCheck(
  getCandidate: () => { researchId: string } | undefined,
  buyOne: (researchId: string) => boolean,
  maxIterations = 1000
): number {
  let purchased = 0;
  for (let i = 0; i < maxIterations; i++) {
    const next = getCandidate();
    if (!next) break;
    if (!buyOne(next.researchId)) break;
    purchased++;
  }
  return purchased;
}

/** What `buyUntilRealSaleStarts`'s `getCandidate` returns each iteration. */
export interface SaleAwareCandidate {
  researchId: string;
  duringSale: boolean;
  // Absolute time this specific purchase actually completes at — needed (alongside `duringSale`)
  // to tell "used an already-active, different sale's real current price" apart from "crossed
  // INTO the target sale via the bypass" during cleanup. See `buyUntilRealSaleStarts`'s own doc
  // comment.
  purchaseTimestamp: number;
}

/**
 * Wraps `buyWhilePassingCheck` with the two extra behaviors shared by any "buy until a sale-aware
 * deadline" flow (the manual planner's "Buy Until Sale Warning" and "Buy Until ROI Deadline"
 * buttons today; anything else built on `meetsSaleAwareDeadline`-style candidate selection later):
 *
 * 1. Stops the run once `shouldStop()` says the target deadline has been reached. Deliberately
 *    NOT "is some sale live right now": a caller invoked while a DIFFERENT, already-active sale is
 *    in progress (e.g. the button gets clicked mid-sale) has a real deadline that's the sale AFTER
 *    that one (`getNextPacificTime`'s "always strictly after" guarantee means the caller's own
 *    captured deadline already reflects this), and should keep buying — at whatever the real
 *    current price happens to be — right through that already-active sale, not bail out
 *    immediately just because a sale of some kind happens to be live. Typical callers capture
 *    their target deadline once, before the run starts, and pass `() => currentTime() >=
 *    capturedDeadline` — evaluated fresh each iteration since `currentTime()` advances as
 *    purchases get made, but compared against a fixed target rather than "is a sale active" so a
 *    same-instant match (see 2) is unambiguous.
 * 2. `meetsSaleAwareDeadline`-based candidate selection can only make a candidate whose own wait
 *    crosses into the TARGET sale (`duringSale: true`) pass at all by letting it through
 *    unconditionally (see that function's doc comment) — which is necessary for the wait/toggle
 *    insertion that purchase triggers to happen, but leaves an actual sale-priced purchase in the
 *    plan. Every purchase bought while `duringSale` was true AND whose own `purchaseTimestamp` is
 *    at-or-after the caller's target deadline gets undone afterward via `removeAction`, in reverse
 *    order (undoing the most recently added action first keeps each removal's own dependent-action
 *    bookkeeping simple) — leaving the wait/toggle actions those purchases depended on untouched,
 *    since nothing else depends on removing them. The `purchaseTimestamp` filter matters exactly
 *    for the "already mid-sale at the start" case in (1): a purchase priced at that OTHER,
 *    already-active sale's real discount necessarily completes well before the target deadline
 *    (`meetsROIByDeadline`'s own `targetTimestamp > purchaseTime` requirement guarantees this for
 *    any candidate that isn't itself the bypass) and is legitimate, so it should stay — only the
 *    purchase that actually lands at-or-after the target deadline is the bypass this cleanup
 *    exists for.
 *
 * `getLastActionId` is called immediately after a successful `buyOne` to identify which action to
 * potentially remove later — callers with append-only action lists (true for both the manual
 * planner's Pinia store and the auto-planner's `EngineState`) can just return their last action's
 * id.
 *
 * Cleanup is deliberately left for the caller to `await` (this function itself stays synchronous,
 * like `buyWhilePassingCheck`) rather than folded in here, so callers can decide whether it needs
 * to happen inside or outside their own batching — the manual planner runs it after its `batch(...)`
 * call completes, not inside it.
 */
export function buyUntilRealSaleStarts(
  getCandidate: () => SaleAwareCandidate | undefined,
  buyOne: (researchId: string) => boolean,
  shouldStop: () => boolean,
  getLastActionId: () => string | undefined,
  maxIterations = 1000
): { purchased: number; duringSalePurchases: { actionId: string; purchaseTimestamp: number }[] } {
  const duringSalePurchases: { actionId: string; purchaseTimestamp: number }[] = [];
  let pending: SaleAwareCandidate | undefined;

  const purchased = buyWhilePassingCheck(
    () => {
      if (shouldStop()) return undefined;
      const next = getCandidate();
      pending = next;
      return next ? { researchId: next.researchId } : undefined;
    },
    researchId => {
      const bought = buyOne(researchId);
      if (bought && pending?.duringSale) {
        const actionId = getLastActionId();
        if (actionId) duringSalePurchases.push({ actionId, purchaseTimestamp: pending.purchaseTimestamp });
      }
      return bought;
    },
    maxIterations
  );

  return { purchased, duringSalePurchases };
}

/** One purchase within a `simulatePurchaseSequence` result — same shape as `MilestoneChainItem`
 *  minus the fields that only make sense once a caller decides where the sequence lands in a
 *  larger chain (`buyToHereSeconds`) or how to display its ROI (`roiSeconds`/`totalRoiSeconds`/
 *  `showSaleWarning`/`showDeadlineWarning` — a paired purchase's own solo figures are misleading;
 *  see `buildRoiCandidateSequences`'s doc comment). */
export interface SequencedPurchase {
  research: CommonResearch;
  targetLevel: number;
  currentLevel: number;
  price: number;
  timeToBuySeconds: number;
  duringSale: boolean;
  duringEarningsBoost: boolean;
  eventCrossings: PurchaseEventCrossings;
}

/**
 * Simulates buying a sequence of research purchases back-to-back, starting from `state`/
 * `snapshot`/`startAbsoluteTime`, each priced/waited via `getSaleAwareTimeToSave` at the moment
 * it's actually reached — so a later purchase in the sequence correctly sees the earlier one's
 * cost already paid, and any resulting change in earnings. Generic building block for any
 * multi-purchase ROI-buying flow; pair with `buildRoiCandidateSequences` below to get pairing-
 * aware sequences worth trying in the first place.
 *
 * Returns `null` if any purchase in the sequence turns out unaffordable (`waitSeconds ===
 * Infinity`) rather than a partial result — a sequence that can't fully complete isn't a valid
 * purchase plan, half-bought or not.
 */
export function simulatePurchaseSequence(
  sequence: { research: CommonResearch; level: number }[],
  state: EngineState,
  snapshot: CalculationsSnapshot,
  startAbsoluteTime: number,
  mods: ResearchCostModifiers,
  context: SimulationContext
): {
  state: EngineState;
  snapshot: CalculationsSnapshot;
  items: SequencedPurchase[];
  totalSecondsSpent: number;
} | null {
  let curState = state;
  let curSnapshot = snapshot;
  let curTime = startAbsoluteTime;
  let totalSecondsSpent = 0;
  const purchasedItems: SequencedPurchase[] = [];

  for (const { research, level } of sequence) {
    const isSaleNow = isResearchSaleActive(curTime);
    const transitionsNow = boostTransitionsFrom(curSnapshot, curTime);
    const purchase = getSaleAwareTimeToSave(research, level, mods, isSaleNow, curTime, curSnapshot, transitionsNow);
    if (purchase.waitSeconds === Infinity) return null;

    purchasedItems.push({
      research,
      targetLevel: level + 1,
      currentLevel: level,
      price: purchase.price,
      timeToBuySeconds: purchase.waitSeconds,
      duringSale: purchase.duringSale,
      duringEarningsBoost: isEarningsBoostActive(curTime + purchase.waitSeconds),
      eventCrossings: findEventCrossings(curTime, purchase.waitSeconds, isSaleNow, isEarningsBoostActive(curTime)),
    });

    curState = applyTime(
      applyAction(curState, {
        type: 'buy_research',
        payload: { researchId: research.id, fromLevel: level, toLevel: level + 1 },
        cost: purchase.price,
      }),
      purchase.waitSeconds,
      curSnapshot,
      { transitions: transitionsNow }
    );
    // See `smartBuyPreview.ts`'s `simulateSaleAwareBuy` for why a sequential loop like this one
    // must keep `lastStepTime` in its incoming frame across repeated snapshots.
    curSnapshot = computeSnapshot(curState, context, { skipEpochConversion: true });
    curTime += purchase.waitSeconds;
    totalSecondsSpent += purchase.waitSeconds;
  }

  return { state: curState, snapshot: curSnapshot, items: purchasedItems, totalSecondsSpent };
}

/**
 * Expands a `rankResearchByROI` candidate into the purchase sequence(s) worth trying in order to
 * actually acquire it: always the solo purchase, plus — when the candidate only ranked this high
 * because pairing it with `pairPartnerResearch` gives a great COMBINED payback (see
 * `rankResearchByROI`'s bottleneck-pairing logic) and that partner is itself still purchasable —
 * both orderings of buying the pair together (whichever's cheaper to save up for first can finish
 * sooner). A bottlenecked laying/shipping research moves earnings by ~0 bought alone — that's
 * exactly why it needed pairing to rank well at all — so any caller evaluating "is this candidate
 * worth buying" against solo economics alone needs the pair option too, not just the single item.
 *
 * `excludeResearchId` guards against the partner happening to be whatever the caller is separately
 * buying toward (e.g. a milestone's own target research) — pass that id to keep the pairing from
 * silently reaching into a purchase the caller already accounts for elsewhere.
 *
 * Pure/cheap (no simulation) — feed each returned sequence through `simulatePurchaseSequence` to
 * actually price/wait it out, then apply whatever decision policy fits the caller (the milestone
 * chain takes whichever sequence beats buying its target directly; a plain "keep buying the best
 * ROI" loop can just always prefer the pair sequence when one exists, since `rankResearchByROI`
 * only offers it when the combined payback beats the solo one).
 */
export function buildRoiCandidateSequences(
  candidate: ResearchRankingItem,
  levels: Record<string, number>,
  excludeResearchId?: string
): { research: CommonResearch; level: number }[][] {
  const sequences: { research: CommonResearch; level: number }[][] = [
    [{ research: candidate.research, level: candidate.currentLevel }],
  ];

  const partner = candidate.pairPartnerResearch;
  const partnerLevel = partner ? levels[partner.id] || 0 : undefined;
  const partnerEligible =
    !!partner && partner.id !== excludeResearchId && partnerLevel !== undefined && partnerLevel < partner.levels;

  if (partnerEligible && partner) {
    sequences.push([
      { research: candidate.research, level: candidate.currentLevel },
      { research: partner, level: partnerLevel! },
    ]);
    sequences.push([
      { research: partner, level: partnerLevel! },
      { research: candidate.research, level: candidate.currentLevel },
    ]);
  }

  return sequences;
}

/** A purchase produced by `reorderPurchaseListByROI`: a `SequencedPurchase` plus the running total
 *  and ROI display fields a caller building a purchase chain (e.g. the milestone chain) needs per
 *  item. */
export interface RankedPurchase extends SequencedPurchase {
  buyToHereSeconds: number;
  roiSeconds?: number;
  totalRoiSeconds?: number;
  showSaleWarning?: boolean;
  showDeadlineWarning?: boolean;
}

/**
 * Re-sequences a FIXED set of purchases (same researches, same levels — just picked by whatever
 * order the caller originally chose them in, e.g. cheapest-first) into ROI order instead. The set
 * of purchases and their total price don't change, but since each purchase's own price only
 * depends on its own current level (never on what else has been bought), buying the ROI-positive
 * ones earlier can only grow earnings sooner and speed up the rest — never slower than the
 * original order. Per-research level order is preserved (you can't buy level N+1 before level N of
 * the same research).
 *
 * Generic reordering step for any flow that has already committed to a fixed purchase list and
 * just wants it bought in the fastest achievable order — used by the milestone chain's tier-unlock
 * path today (re-sequencing its cheapest-first tail) but not tied to tiers in any way; only
 * `research`/`targetLevel` are read from each input item.
 *
 * Doesn't consider bottleneck pairing (`buildRoiCandidateSequences`) — every item here is already
 * committed to being bought regardless of its own ROI, unlike a detour candidate that's only taken
 * if it's worthwhile, so there's no "is this worth pairing to justify" decision to make here.
 */
export function reorderPurchaseListByROI(
  fixedItems: { research: CommonResearch; targetLevel: number }[],
  startState: EngineState,
  startSnapshot: CalculationsSnapshot,
  startTotalSeconds: number,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteSimTimeAtStart: number,
  researchSaleDeadline: number
): { items: RankedPurchase[]; totalSeconds: number } {
  const pendingByResearch = new Map<string, { research: CommonResearch; levels: number[] }>();
  for (const item of fixedItems) {
    const entry = pendingByResearch.get(item.research.id);
    if (entry) {
      entry.levels.push(item.targetLevel);
    } else {
      pendingByResearch.set(item.research.id, { research: item.research, levels: [item.targetLevel] });
    }
  }

  let state = startState;
  let snapshot = startSnapshot;
  let totalSeconds = startTotalSeconds;
  const items: RankedPurchase[] = [];

  while (items.length < fixedItems.length) {
    const currentAbsoluteTime = absoluteSimTimeAtStart + totalSeconds;
    const isSale = isResearchSaleActive(currentAbsoluteTime);
    const transitions = boostTransitionsFrom(snapshot, currentAbsoluteTime);
    const roiDeadline = getNextPacificTime(5, 9, currentAbsoluteTime);

    const candidates = Array.from(pendingByResearch.values())
      .filter(entry => entry.levels.length > 0)
      .map(entry => {
        const targetLevel = entry.levels[0];
        const level = targetLevel - 1;
        const roiResult = calculateResearchROI({
          research: entry.research,
          level,
          mods,
          snapshot,
          context,
          eventTiming: {
            absoluteSimTime: currentAbsoluteTime,
            roiDeadline,
            researchSaleDeadline,
            isSaleActive: isSale,
            transitions,
          },
        });
        return { research: entry.research, level, targetLevel, roiResult };
      });

    if (candidates.length === 0) break;

    // Sort by totalRoiSeconds (wait-to-afford + payback), not roiSeconds (payback alone) — same
    // convention `rankResearchByROI`'s final sort already uses. Sorting by payback alone can pick
    // an expensive item with a slightly faster payback over several cheaper, still-decent-ROI items
    // that are individually affordable much sooner, forcing one long idle wait instead of buying
    // things as money allows.
    candidates.sort((a, b) => {
      if (a.roiResult.totalRoiSeconds !== b.roiResult.totalRoiSeconds) {
        return a.roiResult.totalRoiSeconds - b.roiResult.totalRoiSeconds;
      }
      return a.roiResult.price - b.roiResult.price;
    });

    const best = candidates[0];
    // Re-derive the actual purchase with this file's own boost-staleness-aware `transitions`
    // (calculateResearchROI's internal wait, used above for ranking, is precise about the sale but
    // uses a simpler earnings-boost transition — fine for ranking, not for the wait we execute).
    const bestPurchase = getSaleAwareTimeToSave(
      best.research,
      best.level,
      mods,
      isSale,
      currentAbsoluteTime,
      snapshot,
      transitions
    );
    const secondsToBuy = bestPurchase.waitSeconds;
    if (secondsToBuy === Infinity) break;

    totalSeconds += secondsToBuy;

    state = applyAction(state, {
      type: 'buy_research',
      payload: { researchId: best.research.id, fromLevel: best.level, toLevel: best.targetLevel },
      cost: bestPurchase.price,
    });
    state = applyTime(state, secondsToBuy, snapshot, { transitions });
    // See `smartBuyPreview.ts`'s `simulateSaleAwareBuy` for why a sequential loop like this one
    // must keep `lastStepTime` in its incoming frame across repeated snapshots.
    snapshot = computeSnapshot(state, context, { skipEpochConversion: true });

    items.push({
      research: best.research,
      targetLevel: best.targetLevel,
      currentLevel: best.level,
      price: bestPurchase.price,
      timeToBuySeconds: secondsToBuy,
      buyToHereSeconds: totalSeconds,
      roiSeconds: best.roiResult.roiSeconds,
      totalRoiSeconds: best.roiResult.totalRoiSeconds,
      showSaleWarning: best.roiResult.showSaleWarning,
      showDeadlineWarning: best.roiResult.showDeadlineWarning,
      duringSale: bestPurchase.duringSale,
      duringEarningsBoost: isEarningsBoostActive(currentAbsoluteTime + secondsToBuy),
      eventCrossings: findEventCrossings(
        currentAbsoluteTime,
        secondsToBuy,
        isSale,
        isEarningsBoostActive(currentAbsoluteTime)
      ),
    });

    pendingByResearch.get(best.research.id)!.levels.shift();
  }

  return { items, totalSeconds };
}
