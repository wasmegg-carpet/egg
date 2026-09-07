import { ref, computed, watch, watchEffect } from 'vue';
import {
  getCommonResearches,
  getTiers,
  getResearchByTier,
  getTierSummary,
  getDiscountedVirtuePrice,
  isTierUnlocked,
  TIER_UNLOCK_THRESHOLDS,
  type CommonResearch,
} from '@/calculations/commonResearch';
import { formatDuration, formatAbsoluteTime } from '@/lib/format';
import { useCommonResearchStore } from '@/stores/commonResearch';
import { useInitialStateStore } from '@/stores/initialState';
import { useActionsStore } from '@/stores/actions';
import { useVirtueStore } from '@/stores/virtue';
import { computeSnapshot } from '@/engine/compute';
import { getSimulationContext, createBaseEngineState } from '@/engine/adapter';
import { applyAction, applyTime, getTimeToSave } from '@/engine/apply';
import { calculateShippingCapacity } from '@/calculations/shippingCapacity';
import {
  getNextPacificTime,
  getBuildPhaseEndForSaleCount,
  countSalesThrough,
  isResearchSaleActive as isRealSaleActiveAt,
} from '@/lib/events';
import { type CalculationsSnapshot } from '@/types';
import { getOptimalELRSet } from '@/lib/artifacts/virtue';
import { calculateArtifactModifiers } from '@/lib/artifacts';
import { calculateLayRate } from '@/calculations/layRate';
import { calculateEffectiveLayRate } from '@/calculations/effectiveLayRate';
import { calculateHabCapacity_Full } from '@/calculations/habCapacity';
import { computeRealisticELR } from '@/calculations/realisticELR';
import {
  type MilestoneTarget,
  type MilestoneChainItem,
  type MilestoneChainResult,
  isMilestoneReached,
  computeMilestoneBaseline,
  computeMilestoneSummaryCore,
} from '@/calculations/milestoneChain';
import { type ResearchRankingItem, rankResearchByROI, rankResearchByELRImpact } from '@/calculations/researchRanking';
import { type PurchaseEventCrossings, isActuallyDuringSale } from '@/calculations/researchROI';
import {
  summarizeResearchLevelChanges,
  type SaleAwareBuyPlan,
  type SaleEndsPlan,
} from '@/calculations/smartBuyPreview';
import { useResearchCalcWorker } from '@/composables/useResearchCalcWorker';
import type { SimulationContext } from '@/engine/types';
import { ei } from 'lib';

/**
 * Shared by `realisticSummary` (current research levels) and the Smart Buy tab's before/after
 * delivery-rate comparisons (simulated post-purchase levels) — same "optimal artifacts + max
 * habs/vehicles" pipeline, just parameterized over which research levels to evaluate instead of
 * always reading the live store, so both callers stay in sync by construction.
 */
function computeRealisticDeliverySummary(
  researchLevels: Record<string, number>,
  rawBackup: ei.IBackup | null | undefined,
  context: SimulationContext
): { layRate: number; shippingRate: number; elr: number } | null {
  if (!rawBackup) return null;

  const optimal = getOptimalELRSet(rawBackup, {
    assumeMaxHabsVehicles: true,
    excludeGusset: false,
    commonResearch: researchLevels,
    epicResearchLevels: context.epicResearchLevels,
    colleggtibleModifiers: context.colleggtibleModifiers,
  });
  const artifactMods = calculateArtifactModifiers(optimal);
  const stats = computeRealisticELR(
    researchLevels,
    artifactMods,
    context.epicResearchLevels,
    context.colleggtibleModifiers
  );

  return {
    layRate: stats.layRate * 3600,
    shippingRate: stats.shippingRate * 3600,
    elr: stats.effectiveRate * 3600,
  };
}

export type { MilestoneTarget } from '@/calculations/milestoneChain';

export type ViewType = 'game' | 'cheapest' | 'roi' | 'elr' | 'milestones' | 'smart_buy';
export type ElrViewMode = 'realistic' | 'potential';
export type ElrSortMode = 'efficiency' | 'impact';
export type ElrRoiDisplayMode = 'hpp' | 'time';
export type RoiMode = 'immediate' | 'maxed_vehicles';

/**
 * Common interface for research items across different views.
 */
export interface ResearchViewItem {
  research: CommonResearch;
  targetLevel: number;
  currentLevel: number;
  price: number;
  timeToBuy: string;
  // Only the cheapest/roi/milestone branches simulate this step-by-step; the elr branch omits it
  // so consumers fall back to a live rate-based estimate instead (see ResearchFlatView.vue).
  timeToBuySeconds?: number;
  canBuy: boolean;
  isMaxed: boolean;
  canBuyToHere?: boolean;

  // ROI specific
  roiSeconds?: number;
  totalRoiSeconds?: number;
  roiLabel?: string;
  totalRoiLabel?: string;
  isLaying?: boolean;
  isShipping?: boolean;
  recommendationNote?: string;
  pairRoiSeconds?: number;
  showSaleWarning?: boolean;
  showDeadlineWarning?: boolean;
  // Whether this purchase's price reflects a research sale, and whether it would complete during
  // a 2x earnings boost. Distinct from showSaleWarning/showDeadlineWarning ("you should hold off").
  duringSale?: boolean;
  duringEarningsBoost?: boolean;
  // Event boundaries (if any) this purchase's own wait crosses while saving up. Only set on the
  // milestones branch — lets the preview show the same wait/toggle split the manual planner
  // inserts when actually executing the chain, instead of only revealing it after clicking "Buy".
  eventCrossings?: PurchaseEventCrossings;
  // Extra $/sec this purchase would add to earnings once bought. Only set on the roi branch
  // (see ResearchRankingItem's field of the same name).
  earningsDelta?: number;
  // Absolute sim timestamp (seconds) this purchase would actually complete at (absoluteSimTime +
  // timeToBuySeconds). Only set on the roi branch — lets callers run meetsROIByDeadline against an
  // arbitrary target without re-deriving absoluteSimTime themselves.
  purchaseTimestamp?: number;

  // ELR specific
  impact?: number;
  hpp?: number;
  timeRoiSeconds?: number;
  lookahead?: { minLevels: number; impact: number; hpp: number };

  // Cheapest specific / generic
  buyToHereTime?: string;
  buyToHereSeconds?: number;
  showDivider?: boolean;
  unlockTier?: number;
  extraStats?: string;
  extraLabel?: string;
  extraSeconds?: number;
  buyToHereTooltip?: string;
  realisticStats?: { layRate: number; shippingRate: number; elr: number; elrDelta: number };
}

export const VIEWS = [
  { id: 'game', label: 'Game View', description: 'Grouped by tier, exactly like the game.' },
  // Hidden for now (not removed in case someone asks for it back):
  // { id: 'cheapest', label: 'Cheapest First', description: 'All unpurchased researches sorted by price.' },
  { id: 'roi', label: 'Earnings ROI', description: 'Prioritizes upgrades that pay for themselves fastest.' },
  { id: 'elr', label: 'Delivery Impact', description: 'Sorted by impact to your Delivery Rate.' },
  { id: 'milestones', label: 'Milestones', description: 'Fastest ROI path to a tier unlock or research level.' },
  {
    id: 'smart_buy',
    label: 'Smart Buy',
    description: 'Auto-buy research: sale-aware and threshold-based buying in one place.',
  },
] as const;

const RESEARCH_VIEW_STORAGE_KEY = 'ascension_research_view';
const ELR_VIEW_MODE_STORAGE_KEY = 'ascension_research_elr_view_mode';
const ELR_SORT_MODE_STORAGE_KEY = 'ascension_research_elr_sort_mode';
const ELR_ROI_DISPLAY_MODE_STORAGE_KEY = 'ascension_research_elr_roi_display_mode';
const DELIVERY_IMPACT_ONLY_STORAGE_KEY = 'ascension_research_delivery_impact_only';
const ROI_MODE_STORAGE_KEY = 'ascension_research_roi_mode';
const MILESTONE_TARGET_STORAGE_KEY = 'ascension_research_milestone_target';
const SMART_BUY_SALE_TARGET_END_STORAGE_KEY = 'ascension_smart_buy_sale_target_end';

const DEFAULT_RESEARCH_VIEW: ViewType = 'smart_buy';

/** Upper bound on how many sales out the "70% Return" card's sale-count stepper can reach — matches
 *  C3's own default max `saleCount` (see `auto/shifts/c3.ts`'s `runC3Variants`), keeping the manual
 *  tool aligned with what auto-planning actually considers. */
export const SMART_BUY_SALE_COUNT_CAP = 3;

function loadStoredResearchView(): ViewType {
  const stored = localStorage.getItem(RESEARCH_VIEW_STORAGE_KEY);
  return VIEWS.some(v => v.id === stored) ? (stored as ViewType) : DEFAULT_RESEARCH_VIEW;
}

/**
 * Called when the player shifts into Curiosity so the research tab greets them with Smart Buy
 * again, rather than leaving them on whatever view they last happened to be looking at.
 */
export function resetResearchViewForCuriosityShift(): void {
  localStorage.setItem(RESEARCH_VIEW_STORAGE_KEY, DEFAULT_RESEARCH_VIEW);
}

function loadStoredElrViewMode(): ElrViewMode {
  const stored = localStorage.getItem(ELR_VIEW_MODE_STORAGE_KEY);
  return stored === 'realistic' || stored === 'potential' ? stored : 'realistic';
}

function loadStoredElrSortMode(): ElrSortMode {
  const stored = localStorage.getItem(ELR_SORT_MODE_STORAGE_KEY);
  return stored === 'efficiency' || stored === 'impact' ? stored : 'efficiency';
}

function loadStoredElrRoiDisplayMode(): ElrRoiDisplayMode {
  const stored = localStorage.getItem(ELR_ROI_DISPLAY_MODE_STORAGE_KEY);
  return stored === 'hpp' || stored === 'time' ? stored : 'hpp';
}

function loadStoredDeliveryImpactOnly(): boolean {
  return localStorage.getItem(DELIVERY_IMPACT_ONLY_STORAGE_KEY) === 'true';
}

function loadStoredRoiMode(): RoiMode {
  const stored = localStorage.getItem(ROI_MODE_STORAGE_KEY);
  return stored === 'immediate' || stored === 'maxed_vehicles' ? stored : 'immediate';
}

/**
 * The "70% Return" card's pinned full-ROI-deadline timestamp — `null` means "no pin, track the live
 * default" (see `smartBuyFullRoiDeadline`'s own doc comment below for what the default is and why a
 * stale/expired pin falls back to it automatically without needing this loader to validate anything
 * itself).
 */
function loadStoredSmartBuySaleTargetEnd(): number | null {
  const stored = localStorage.getItem(SMART_BUY_SALE_TARGET_END_STORAGE_KEY);
  if (!stored) return null;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? parsed : null;
}

function loadStoredMilestoneTarget(): MilestoneTarget | null {
  const stored = localStorage.getItem(MILESTONE_TARGET_STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    if (parsed?.kind === 'tier' && typeof parsed.tier === 'number') {
      return { kind: 'tier', tier: parsed.tier };
    }
    if (
      parsed?.kind === 'research' &&
      typeof parsed.researchId === 'string' &&
      typeof parsed.targetLevel === 'number'
    ) {
      return { kind: 'research', researchId: parsed.researchId, targetLevel: parsed.targetLevel };
    }
  } catch {
    // ignore malformed storage
  }
  return null;
}

export function useResearchViews() {
  const commonResearchStore = useCommonResearchStore();
  const initialStateStore = useInitialStateStore();
  const actionsStore = useActionsStore();
  const virtueStore = useVirtueStore();
  // Owns the one Web Worker all four heavy research-plan simulations below run on — see
  // useResearchCalcWorker.ts's doc comment for why (keeps a large computation from tripping
  // Chrome's main-thread-only "Page Unresponsive" hang detector). `computeThresholdBuy` is unused
  // here — it's returned below purely so ResearchActions.vue's own `quickBuyPlan` watchEffect can
  // share this same worker instance instead of spawning a second one.
  const { computeMilestoneChain, computeSaleAwareBuy, computeSaleEndsBuy, computeThresholdBuy } =
    useResearchCalcWorker();

  const currentView = ref<ViewType>(loadStoredResearchView());
  watch(currentView, v => localStorage.setItem(RESEARCH_VIEW_STORAGE_KEY, v));
  const elrViewMode = ref<ElrViewMode>(loadStoredElrViewMode());
  watch(elrViewMode, v => localStorage.setItem(ELR_VIEW_MODE_STORAGE_KEY, v));
  const elrSortMode = ref<ElrSortMode>(loadStoredElrSortMode());
  watch(elrSortMode, v => localStorage.setItem(ELR_SORT_MODE_STORAGE_KEY, v));
  const elrRoiDisplayMode = ref<ElrRoiDisplayMode>(loadStoredElrRoiDisplayMode());
  watch(elrRoiDisplayMode, v => localStorage.setItem(ELR_ROI_DISPLAY_MODE_STORAGE_KEY, v));
  const deliveryImpactOnly = ref(loadStoredDeliveryImpactOnly());
  watch(deliveryImpactOnly, v => localStorage.setItem(DELIVERY_IMPACT_ONLY_STORAGE_KEY, String(v)));
  const roiMode = ref<RoiMode>(loadStoredRoiMode());
  watch(roiMode, v => localStorage.setItem(ROI_MODE_STORAGE_KEY, v));
  // The "70% Return" card's pinned full-ROI-deadline (Gate B) target — `null` = no pin, track the
  // live default. Persisted like every other Smart Buy pref above, but unlike them this can hold a
  // stale value indefinitely (a timestamp from days ago) without correctness issues: nothing here
  // ever needs to actively clear it, because `smartBuyFullRoiDeadline` below already ignores a pin
  // once it's in the past and falls back to the live default on its own — see that computed's doc
  // comment for the full reasoning (SMART_BUY_DUAL_ROI_DESIGN.md §2.1/§2.2).
  const smartBuySaleTargetEnd = ref<number | null>(loadStoredSmartBuySaleTargetEnd());
  watch(smartBuySaleTargetEnd, v => {
    if (v === null) localStorage.removeItem(SMART_BUY_SALE_TARGET_END_STORAGE_KEY);
    else localStorage.setItem(SMART_BUY_SALE_TARGET_END_STORAGE_KEY, String(v));
  });
  const milestoneTarget = ref<MilestoneTarget | null>(loadStoredMilestoneTarget());
  watch(
    milestoneTarget,
    v => {
      if (v) {
        localStorage.setItem(MILESTONE_TARGET_STORAGE_KEY, JSON.stringify(v));
      } else {
        localStorage.removeItem(MILESTONE_TARGET_STORAGE_KEY);
      }
    },
    { deep: true }
  );
  // `milestoneTarget` is a localStorage-backed ref, entirely outside the Pinia store system —
  // resetAllStores() (which every mode-init flow calls first) only resets Pinia stores, so it never
  // touches this. Left alone, a milestone target selected in one plan (possibly deep into a
  // developed save) silently survives into a brand new blank ascension and immediately re-triggers
  // an expensive computation against a near-zero earn rate — this is exactly the "cross-mode state
  // leakage" resetAllStores() exists to prevent (see its own doc comment), just missed because this
  // particular piece of state doesn't live in a store. Clear it in lockstep with isPlanInitializing
  // so it's gone before the milestoneChain watchEffect below gets a chance to act on it.
  watch(
    () => actionsStore.isPlanInitializing,
    initializing => {
      if (initializing && milestoneTarget.value !== null) {
        milestoneTarget.value = null;
      }
    }
  );

  const realisticSummary = computed(() => {
    if (elrViewMode.value !== 'realistic') return null;
    return computeRealisticDeliverySummary(
      commonResearchStore.researchLevels,
      initialStateStore.rawBackup,
      getSimulationContext()
    );
  });

  const viewDescription = computed(() => {
    switch (currentView.value) {
      case 'game':
        return 'Grouped by tier, exactly like the game. Best for familiar navigation.';
      case 'cheapest':
        return 'All unpurchased researches sorted by price. Strategically unlock tiers with "Buy to here".';
      case 'roi':
        return 'Prioritizes upgrades that pay for themselves fastest based on your current earnings.';
      case 'elr': {
        const view = elrViewMode.value;
        const sort = elrSortMode.value;
        if (view === 'potential' && sort === 'efficiency') {
          return 'Theoretical max impact to Delivery Rate, sorted by time efficiency.';
        } else if (view === 'potential' && sort === 'impact') {
          return 'Theoretical max impact to Delivery Rate, sorted by total impact.';
        } else if (view === 'realistic' && sort === 'efficiency') {
          return 'True Delivery Rate impact with optimal artifacts and max habs/vehicles, sorted by time efficiency.';
        } else {
          return 'True Delivery Rate impact with optimal artifacts and max habs/vehicles, sorted by total impact.';
        }
      }
      case 'milestones':
        return 'Pick a tier unlock or a specific research level, and see the fastest ROI-optimal path to it.';
      case 'smart_buy':
        return 'Auto-buy research: sale-aware ROI buying and threshold-based smart buy, all in one place.';
      default:
        return '';
    }
  });

  const costModifiers = computed(() => ({
    labUpgradeLevel: initialStateStore.epicResearchLevels['cheaper_research'] || 0,
    researchCostMultiplier: initialStateStore.colleggtibleModifiers.researchCost,
    puzzleCubeMultiplier: initialStateStore.artifactModifiers.researchCost.totalMultiplier,
  }));

  const isResearchSaleActive = computed(() => actionsStore.effectiveSnapshot.activeSales.research);

  const tiers = computed(() => getTiers());
  const researchByTier = computed(() => getResearchByTier());

  const milestoneNextLockedTier = computed(() => {
    const levels = commonResearchStore.researchLevels;
    return tiers.value.find(tier => !isTierUnlocked(levels, tier)) ?? null;
  });

  const milestoneResearchOptions = computed(() => {
    const levels = commonResearchStore.researchLevels;
    return getCommonResearches()
      .filter(r => (levels[r.id] || 0) < r.levels && isTierUnlocked(levels, r.tier))
      .map(r => ({ research: r, currentLevel: levels[r.id] || 0 }));
  });

  const tierSummaries = computed(() => {
    const summaries: Record<number, ReturnType<typeof getTierSummary>> = {};
    for (const tier of tiers.value) {
      summaries[tier] = getTierSummary(
        tier,
        commonResearchStore.researchLevels,
        costModifiers.value,
        isResearchSaleActive.value
      );
    }
    return summaries;
  });

  const researchSaleDeadline = computed(() => {
    const baseTimestamp = virtueStore.planStartTime.getTime() / 1000;
    const offset = actionsStore.planStartOffset;
    const absoluteSimTime = baseTimestamp + (actionsStore.effectiveSnapshot.lastStepTime - offset);
    return getNextPacificTime(6, 9, absoluteSimTime);
  });

  const nextSaleStart = computed(() => {
    const baseTimestamp = virtueStore.planStartTime.getTime() / 1000;
    const offset = actionsStore.planStartOffset;
    const absoluteSimTime = baseTimestamp + (actionsStore.effectiveSnapshot.lastStepTime - offset);
    return getNextPacificTime(5, 9, absoluteSimTime);
  });

  // Converts the pure-calculation MilestoneChainItem shape (raw seconds, no formatting) into the
  // view's ResearchViewItem shape. roiSeconds/totalRoiSeconds are only set on detour items — both
  // computeTierMilestoneChain's ROI-reorder path and computeResearchMilestoneChain's ROI-ranked
  // detour path populate them the same way; direct target/cheapest-first purchases leave them
  // unset.
  //
  // `item.duringSale` (from `getSaleAwareTimeToSave`) means "priced at a sale discount, whichever
  // sale that turns out to be" — correct for the actual gems charged, but not what the "Sale" badge
  // should mean to a player glancing at the list: a purchase that only becomes worthwhile several
  // sale cycles out is still priced at a discount, but showing the same badge as an item landing in
  // NEXT week's sale is misleading. `isActuallyDuringSale` (already re-derived against calendar
  // truth for `showSaleWarning`'s sake) narrows it to "actually the very next sale" for display.
  // Anchored on THIS item's own purchase-start time (`completesAt - timeToBuySeconds`, i.e. when its
  // wait began), not the live `nextSaleStart`/"now" — a chain item several purchases (or idle-forward
  // sale-boundary crossings) deep can be evaluated well after the plan's own start, and using the
  // live "now" instead of the chain's simulated "now" at that point is the same "which sale is
  // actually next" mistake `isActuallyDuringSale` itself guards against internally.
  function toResearchViewItem(item: MilestoneChainItem, startAbsoluteTime: number): ResearchViewItem {
    const completesAt = startAbsoluteTime + item.buyToHereSeconds;
    const purchaseStartTime = completesAt - item.timeToBuySeconds;
    const result: ResearchViewItem = {
      research: item.research,
      targetLevel: item.targetLevel,
      currentLevel: item.currentLevel,
      price: item.price,
      timeToBuy: item.timeToBuySeconds < 0.1 ? '0s' : formatDuration(item.timeToBuySeconds),
      timeToBuySeconds: item.timeToBuySeconds,
      buyToHereTime: item.buyToHereSeconds < 0.1 ? '0s' : formatDuration(item.buyToHereSeconds),
      buyToHereSeconds: item.buyToHereSeconds,
      canBuy: true,
      isMaxed: false,
      canBuyToHere: true,
      showSaleWarning: item.showSaleWarning,
      showDeadlineWarning: item.showDeadlineWarning,
      duringSale: isActuallyDuringSale(item.duringSale, completesAt, purchaseStartTime),
      duringEarningsBoost: item.duringEarningsBoost,
      eventCrossings: item.eventCrossings,
    };

    if (item.roiSeconds !== undefined) {
      const roiLabel =
        item.roiSeconds === Infinity || item.roiSeconds > 999 * 86400 ? '>999d' : formatDuration(item.roiSeconds);
      result.roiSeconds = item.roiSeconds;
      result.totalRoiSeconds = item.totalRoiSeconds;
      result.roiLabel = roiLabel;
      result.extraStats = roiLabel;
      result.extraLabel = 'ROI';
      result.extraSeconds = item.roiSeconds;
    }

    return result;
  }

  // Converts the pure-calculation ResearchRankingItem shape (raw seconds, no formatting) from
  // rankResearchByROI into the view's ResearchViewItem shape.
  function toResearchViewItemFromROI(item: ResearchRankingItem, absoluteSimTime: number): ResearchViewItem {
    const roiSeconds = item.roiSeconds!;
    const totalRoiSeconds = item.totalRoiSeconds!;
    const timeToBuySeconds = item.timeToBuySeconds!;
    const roiLabel = roiSeconds === Infinity || roiSeconds > 999 * 86400 ? '>999d' : formatDuration(roiSeconds);
    const totalRoiLabel =
      totalRoiSeconds === Infinity || totalRoiSeconds > 999 * 86400
        ? '>999d'
        : totalRoiSeconds < 1
          ? '0s'
          : formatDuration(totalRoiSeconds);

    return {
      research: item.research,
      price: item.price,
      currentLevel: item.currentLevel,
      targetLevel: item.targetLevel,
      timeToBuy:
        timeToBuySeconds > 0
          ? timeToBuySeconds === Infinity
            ? '∞'
            : timeToBuySeconds < 1
              ? '0s'
              : formatDuration(timeToBuySeconds)
          : '',
      timeToBuySeconds,
      canBuy: item.canBuy,
      isMaxed: false,
      roiSeconds,
      totalRoiSeconds,
      roiLabel,
      totalRoiLabel,
      isLaying: item.isLaying,
      isShipping: item.isShipping,
      recommendationNote:
        item.pairPartnerResearch && item.pairRoiSeconds !== undefined
          ? `Buying this with "${item.pairPartnerResearch.name}" would have a much better combined payback time of ${formatDuration(item.pairRoiSeconds)}.`
          : undefined,
      pairRoiSeconds: item.pairRoiSeconds,
      showSaleWarning: item.showSaleWarning,
      showDeadlineWarning: item.showDeadlineWarning,
      // See `toResearchViewItem`'s identical comment: narrow "priced at a sale, whichever one" down
      // to "actually the very next sale" for the badge's sake, anchored on this ranking's own `now`
      // rather than the live `nextSaleStart`.
      duringSale: isActuallyDuringSale(item.duringSale, absoluteSimTime + timeToBuySeconds, absoluteSimTime),
      duringEarningsBoost: item.duringEarningsBoost,
      earningsDelta: item.earningsDelta,
      purchaseTimestamp: absoluteSimTime + timeToBuySeconds,
      extraStats: totalRoiLabel,
      extraLabel: 'Achieve ROI',
      extraSeconds: totalRoiSeconds,
    };
  }

  // Converts the pure-calculation ResearchRankingItem shape from rankResearchByELRImpact into the
  // view's ResearchViewItem shape. Deliberately omits timeToBuySeconds (see ResearchViewItem's
  // doc comment) — matches pre-hoist behavior of never populating it for this view.
  function toResearchViewItemFromELR(item: ResearchRankingItem): ResearchViewItem {
    const la = item.lookahead;
    return {
      research: item.research,
      price: item.price,
      currentLevel: item.currentLevel,
      targetLevel: item.targetLevel,
      timeToBuy: '',
      canBuy: item.canBuy,
      isMaxed: false,
      impact: item.impact,
      hpp: la ? la.hpp : item.hpp,
      timeRoiSeconds: la ? la.timeRoiSeconds : item.timeRoiSeconds,
      realisticStats: la ? la.realisticStats : item.realisticStats,
      lookahead: la ? { minLevels: la.minLevels, impact: la.impact, hpp: la.hpp } : undefined,
      showDeadlineWarning: item.showDeadlineWarning,
      duringSale: item.duringSale,
      duringEarningsBoost: item.duringEarningsBoost,
      extraStats: `+${((la ? la.impact : item.impact!) * 100).toFixed(3)}%`,
      extraLabel: la ? `${la.minLevels}-lvl impact` : 'Impact',
    };
  }

  // `computeTierMilestoneChain`/`computeResearchMilestoneChain` can take a couple of seconds for a
  // large tier-unlock chain — long enough, run on the main thread, to trip Chrome's "Page
  // Unresponsive" hang detector (confirmed happening in practice, not just theoretical). Both now
  // run in a Web Worker instead (`computeMilestoneChain`, from useResearchCalcWorker.ts — see its
  // doc comment for why that fixes the hang detector specifically, not just the visual freeze). A
  // plain `computed` still couldn't drive the loading flag below correctly even with the computation
  // off-thread: Vue computeds are fully synchronous, and `await`ing inside one isn't meaningful —
  // Vue never awaits a computed getter's return value. So this stays a `watchEffect`, which captures
  // every reactive dependency it needs SYNCHRONOUSLY (so Vue's automatic dependency tracking — which
  // only sees reads before the first `await` — still picks all of them up), flips the loading flag,
  // then `await`s the worker request.
  const isComputingMilestoneChain = ref(false);
  const milestoneChainResultRef = ref<MilestoneChainResult>({
    items: [],
    reached: false,
    totalSeconds: 0,
  });
  // Paired with `milestoneChainResultRef` so `toResearchViewItem` can turn each item's
  // chain-relative `buyToHereSeconds` into an absolute completion time (needed to correctly gate
  // its "Sale" badge — see that function's own comment). Always the exact `absoluteSimTime` the
  // chain currently in `milestoneChainResultRef` was computed from, kept in sync with it below.
  const milestoneChainStartTimeRef = ref(0);
  let milestoneChainGeneration = 0;

  watchEffect(async () => {
    // Must be the first read so Vue tracks it and re-runs this effect once mode-init settles.
    // While a mode switch (start from scratch / plan future / reconcile / load plan / etc.) is
    // resetting stores, they briefly disagree with each other (e.g. virtueStore already reset while
    // actionsStore still holds the previous plan's snapshot) — computing a milestone chain against
    // that transitional mix has produced nonsensical absolute timestamps and hung the tab.
    if (actionsStore.isPlanInitializing) {
      return;
    }

    // Same reasoning as `saleAwarePlan70`'s watchEffect in the Smart Buy section below: a bulk
    // purchase mutates `actionsStore.effectiveSnapshot` once per item bought, then again when
    // recalculateFrom() installs the final recalculated result — without this guard this effect
    // computes the chain once against the doomed mid-batch intermediate state, then again against
    // the final one once things settle.
    if (actionsStore.batchMode || actionsStore.isRecalculating) {
      return;
    }

    const target = milestoneTarget.value;
    const generation = ++milestoneChainGeneration;

    if (!target) {
      milestoneChainResultRef.value = { items: [], reached: false, totalSeconds: 0 };
      // Must clear this here too, not just after a completed compute below: if a prior invocation
      // (for the previous target) is still in flight when the target is cleared, it will later find
      // itself superseded (`generation !== milestoneChainGeneration`) and discard its result without
      // touching this flag — leaving the overlay stuck on forever with nothing left computing.
      isComputingMilestoneChain.value = false;
      return;
    }

    const context = getSimulationContext();
    const startSnapshot = actionsStore.effectiveSnapshot;
    const mods = costModifiers.value;
    const deadline = researchSaleDeadline.value;
    const baseTimestamp = virtueStore.planStartTime.getTime() / 1000;
    const offset = actionsStore.planStartOffset;
    const absoluteSimTime = baseTimestamp + (startSnapshot.lastStepTime - offset);

    // No explicit yield needed here (unlike this file's other watchEffects before this one moved to
    // a worker): `await computeMilestoneChain(...)` below is a genuine postMessage round-trip, so
    // control already returns to the browser — and the loading flag set just above gets to paint —
    // before the (now off-main-thread) computation itself even starts.
    isComputingMilestoneChain.value = true;

    let result: MilestoneChainResult;
    try {
      result = await computeMilestoneChain({ target, startSnapshot, context, mods, absoluteSimTime, deadline });
    } finally {
      // In this `finally` (not just after a successful compute below) so a thrown error still stops
      // the milestones panel spinning — even showing a stale chain — rather than leaving it dimmed
      // forever with nothing left to reset it.
      if (generation === milestoneChainGeneration) {
        isComputingMilestoneChain.value = false;
      }
    }

    // Discard if a newer invocation has started since (e.g. the user changed the milestone target
    // again before this one finished) — only the latest result should ever land.
    if (generation === milestoneChainGeneration) {
      milestoneChainResultRef.value = result;
      milestoneChainStartTimeRef.value = absoluteSimTime;
    }
  });

  const milestoneChainResult = computed(() => milestoneChainResultRef.value);

  // Baseline comparison ("without this research"). For a research-level milestone there's a
  // well-defined direct alternative — just save up and buy that research's next level with no
  // detours — which is exactly what the chain algorithm above compares each detour against, so
  // using the same number here keeps "with" guaranteed no worse than "without". A tier-unlock
  // milestone has no single "direct" purchase, so its baseline is buying cheapest-first (no ROI
  // reordering) until the tier unlocks — the naive strategy already used elsewhere in the app.
  const milestoneBaselineResult = computed(() => {
    const target = milestoneTarget.value;
    if (!target) return { reached: false, totalSeconds: 0 };

    const context = getSimulationContext();
    const startSnapshot = actionsStore.effectiveSnapshot;
    const baseTimestamp = virtueStore.planStartTime.getTime() / 1000;
    const offset = actionsStore.planStartOffset;
    const absoluteSimTime = baseTimestamp + (startSnapshot.lastStepTime - offset);
    return computeMilestoneBaseline(target, startSnapshot, context, costModifiers.value, absoluteSimTime);
  });

  // Whether the currently-selected milestone target is already reached at the current research
  // levels — exposed separately from `milestoneSummary` (which returns `null` in this case) so
  // `ResearchFlatView`'s empty state can tell "already done" apart from "chain got stuck/truncated
  // with zero purchases queued," which also produces an empty `sortedResearches` list but means
  // something very different.
  const milestoneAlreadyReached = computed(() => {
    const target = milestoneTarget.value;
    if (!target) return false;
    return isMilestoneReached(target, commonResearchStore.researchLevels);
  });

  const milestoneSummary = computed(() => {
    const target = milestoneTarget.value;
    if (!target) return null;
    if (milestoneAlreadyReached.value) return null;

    const core = computeMilestoneSummaryCore(milestoneChainResult.value, milestoneBaselineResult.value);

    if (core.truncated) {
      return {
        truncated: true as const,
        partialPurchaseCount: core.partialPurchaseCount ?? 0,
        partialSeconds: core.partialSeconds ?? 0,
      };
    }

    const baseTimestamp =
      virtueStore.planStartTime.getTime() +
      (actionsStore.effectiveSnapshot.lastStepTime - actionsStore.planStartOffset) * 1000;

    return {
      truncated: false as const,
      baselineSeconds: core.baselineSeconds!,
      optimizedSeconds: core.optimizedSeconds!,
      timeSavedSeconds: core.timeSavedSeconds!,
      purchaseCount: core.purchaseCount!,
      gemsSpent: core.gemsSpent!,
      finishAbsoluteTime: formatAbsoluteTime(core.optimizedSeconds!, baseTimestamp, virtueStore.ascensionTimezone),
    };
  });

  const gameViewTimes = computed(() => {
    if (currentView.value !== 'game') return { tiers: {}, researches: {}, tierSeconds: {}, researchSeconds: {} };

    const context = getSimulationContext();
    const baseSnapshot = actionsStore.effectiveSnapshot;
    const mods = costModifiers.value;

    const resultResearches: Record<string, string> = {};
    const resultTiers: Record<number, string> = {};
    const resultResearchSeconds: Record<string, number> = {};
    const resultTierSeconds: Record<number, number> = {};

    const levels = commonResearchStore.researchLevels;

    for (const tier of tiers.value) {
      const researches = researchByTier.value.get(tier) || [];

      for (const r of researches) {
        const currentLevel = levels[r.id] || 0;
        if (currentLevel >= r.levels) continue;

        let rState = createBaseEngineState(baseSnapshot);
        let rSnapshot = baseSnapshot;
        let rSeconds = 0;
        let rInfinite = false;
        const rVirtualBank = baseSnapshot.bankValue || 0;

        for (let l = currentLevel; l < r.levels; l++) {
          const price = getDiscountedVirtuePrice(r, l, mods, rSnapshot.activeSales.research);
          const seconds = getTimeToSave(price, rSnapshot);

          if (seconds === Infinity) {
            rInfinite = true;
            break;
          }
          rSeconds += seconds;

          rState = applyAction(rState, {
            type: 'buy_research',
            payload: { researchId: r.id, fromLevel: l, toLevel: l + 1 },
            cost: price,
          });
          rState = applyTime(rState, seconds, rSnapshot);
          rSnapshot = computeSnapshot(rState, context);
        }
        resultResearches[r.id] = rInfinite ? '∞' : rSeconds < 0.1 ? '0s' : formatDuration(rSeconds);
        resultResearchSeconds[r.id] = rInfinite ? Infinity : rSeconds;
      }

      let tierState = createBaseEngineState(baseSnapshot);
      let tierSnapshot = baseSnapshot;
      let tierSeconds = 0;
      let tierInfinite = false;
      let anyUnpurchasedInTier = false;

      for (const r of researches) {
        const currentLevel = levels[r.id] || 0;
        for (let l = currentLevel; l < r.levels; l++) {
          anyUnpurchasedInTier = true;
          const price = getDiscountedVirtuePrice(r, l, mods, tierSnapshot.activeSales.research);
          const seconds = getTimeToSave(price, tierSnapshot);

          if (seconds === Infinity) {
            tierInfinite = true;
            break;
          }
          tierSeconds += seconds;

          tierState = applyAction(tierState, {
            type: 'buy_research',
            payload: { researchId: r.id, fromLevel: l, toLevel: l + 1 },
            cost: price,
          });
          tierState = applyTime(tierState, seconds, tierSnapshot);
          tierSnapshot = computeSnapshot(tierState, context);
        }
        if (tierInfinite) break;
      }

      if (anyUnpurchasedInTier) {
        resultTiers[tier] = tierInfinite ? '∞' : tierSeconds < 1 ? '0s' : formatDuration(tierSeconds);
        resultTierSeconds[tier] = tierInfinite ? Infinity : tierSeconds;
      }
    }

    return {
      tiers: resultTiers,
      researches: resultResearches,
      tierSeconds: resultTierSeconds,
      researchSeconds: resultResearchSeconds,
    };
  });

  // Independent, reactive wrapper around `rankResearchByROI` — deliberately has no `currentView`
  // dependency of its own. Vue computeds are lazy (only re-run when actually read), so whether this
  // does real work already tracks "is something currently reading it" rather than "which tab is
  // selected" — the roi/elr/smart_buy tabs' own `v-if`s already gate that for template consumers.
  // Baking a view check in here would just mean updating an allowlist by hand every time a new
  // consumer (e.g. the smart_buy tab) needs this list, which is the exact rigidity being avoided.
  const roiRankedResearches = computed(() => {
    const researchLevels = commonResearchStore.researchLevels;
    const isSale = isResearchSaleActive.value;
    const mods = costModifiers.value;
    const context = getSimulationContext();
    const effectiveSnapshot = actionsStore.effectiveSnapshot;

    const baseTimestamp = virtueStore.planStartTime.getTime() / 1000;
    const offset = actionsStore.planStartOffset;
    const absoluteSimTime = baseTimestamp + (effectiveSnapshot.lastStepTime - offset);

    const ranked = rankResearchByROI(
      researchLevels,
      effectiveSnapshot,
      context,
      mods,
      isSale,
      absoluteSimTime,
      researchSaleDeadline.value,
      roiMode.value,
      deliveryImpactOnly.value
    );

    return ranked.map(item => toResearchViewItemFromROI(item, absoluteSimTime));
  });

  // Independent, reactive wrapper around `rankResearchByELRImpact` — see `roiRankedResearches`'
  // doc comment above for why this has no `currentView` dependency of its own either.
  const elrRankedResearches = computed(() => {
    const researchLevels = commonResearchStore.researchLevels;
    const isSale = isResearchSaleActive.value;
    const mods = costModifiers.value;
    const context = getSimulationContext();

    const baseTimestamp = virtueStore.planStartTime.getTime() / 1000;
    const offset = actionsStore.planStartOffset;
    const absoluteSimTime = baseTimestamp + (actionsStore.effectiveSnapshot.lastStepTime - offset);

    const ranked = rankResearchByELRImpact(
      researchLevels,
      initialStateStore.rawBackup,
      actionsStore.effectiveSnapshot,
      context,
      mods,
      isSale,
      absoluteSimTime,
      researchSaleDeadline.value,
      elrViewMode.value,
      elrSortMode.value
    );

    return ranked.map(toResearchViewItemFromELR);
  });

  // The "70% Return" card's own live "now" — same formula every other absolute-time computed in this
  // file already repeats inline (`nextSaleStart`/`researchSaleDeadline` above, etc.); kept as its own
  // small helper here since the sale-count stepper logic below reads it from three separate places.
  function smartBuyAbsoluteSimTime(): number {
    const baseTimestamp = virtueStore.planStartTime.getTime() / 1000;
    const offset = actionsStore.planStartOffset;
    return baseTimestamp + (actionsStore.effectiveSnapshot.lastStepTime - offset);
  }

  // The "70% Return" card's Gate B deadline (see `rankResearchByROI`'s `fullRoiDeadline` doc comment
  // in researchRanking.ts) — "how many sales are in play," default 1 (the very next sale). Pinned to
  // a captured absolute timestamp once the stepper's touched (`smartBuySaleTargetEnd`), rather than
  // continuously re-derived as "N sales from whatever now happens to be": re-deriving live would mean
  // riding out a chosen sale, one button click per cycle, silently re-targets one sale further out
  // after each click, since "now" keeps advancing — defeating the entire point of picking a fixed
  // target (see SMART_BUY_DUAL_ROI_DESIGN.md §2.1). A pin that's fallen into the past (the ride it
  // pointed at already finished) is treated exactly like no pin at all — this is what makes
  // persisting `smartBuySaleTargetEnd` across sessions safe (§2.2): a stale timestamp from days ago
  // just falls back to today's live default on its own, without needing anything to actively clear it.
  const smartBuyFullRoiDeadline = computed(() => {
    const pinned = smartBuySaleTargetEnd.value;
    if (pinned !== null && pinned > smartBuyAbsoluteSimTime()) return pinned;
    return getBuildPhaseEndForSaleCount(smartBuyAbsoluteSimTime(), 1);
  });

  // The "70% Return" flow's structural per-click stop point (fed to `simulateSaleAwareBuy`'s own
  // `nextSaleStart` param, and `runSaleAwareBuyFlow`'s `targetDeadline` in ResearchActions.vue) —
  // normally just `nextSaleStart` itself (the immediate next sale: one click handles "before that
  // sale," riding out further sales is "click again next week" — see `runSaleAwareBuyFlow`'s own doc
  // comment), but capped at `smartBuyFullRoiDeadline` so a click that's already buying WITHIN the
  // ride's final sale doesn't get pushed an entire extra week further, into a sale beyond what this
  // ride was ever aiming for.
  //
  // `Math.min` is a no-op outside that case: `nextSaleStart` is always earlier than
  // `smartBuyFullRoiDeadline` for every sale before the final one (the ride's deadline is, by
  // definition, further out than the very next sale until you actually reach it), and only drops
  // below it once `getNextSaleStart` has skipped past a currently-active sale to the FOLLOWING one
  // (its "always strictly after now" guarantee) while `smartBuyFullRoiDeadline` — this active sale's
  // own end, if it's the final one — hasn't. Confirmed via a live report: with N=1 (default) picked
  // while 2 hours into a sale, this used to pad the clock a full 6 more days to the sale after next,
  // even though `smartBuyFullRoiDeadline` (this same sale's own end) was only 22 hours out.
  const smartBuyStructuralDeadline = computed(() => Math.min(nextSaleStart.value, smartBuyFullRoiDeadline.value));

  // Whether the cap above actually won — i.e. purchasing is already happening WITHIN the ride's
  // final sale, rather than in the ordinary "before the next sale starts" case. `runSaleAwareBuyFlow`
  // (ResearchActions.vue) reads this to decide whether it's worth padding the plan's clock the rest
  // of the way to `smartBuyStructuralDeadline` once the buy loop stops: when `false` (the deadline is
  // `nextSaleStart`, a sale START), parking the clock there is useful setup for whatever comes next
  // — the sale toggling on, more purchases becoming affordable, etc. When `true` (the deadline is
  // this active sale's own END), there's nothing waiting at that boundary once purchasing has
  // genuinely run out of qualifying candidates — advancing to it would just burn the rest of the sale
  // for no reason, so that flow stops right after the last real purchase instead.
  const smartBuyDeadlineIsFinalSaleCap = computed(() => smartBuyFullRoiDeadline.value < nextSaleStart.value);

  // How many sales `smartBuyFullRoiDeadline` currently represents — display value for the stepper,
  // and what its own `+`/`-` handlers below count from/to. Derived from the deadline itself (not
  // tracked as separate state) so it can never disagree with what's actually being sent to the plan.
  const smartBuySaleCount = computed(() => countSalesThrough(smartBuyAbsoluteSimTime(), smartBuyFullRoiDeadline.value));

  function incrementSmartBuySaleCount(): void {
    const nextCount = Math.min(SMART_BUY_SALE_COUNT_CAP, smartBuySaleCount.value + 1);
    smartBuySaleTargetEnd.value = getBuildPhaseEndForSaleCount(smartBuyAbsoluteSimTime(), nextCount);
  }

  function decrementSmartBuySaleCount(): void {
    const nextCount = Math.max(1, smartBuySaleCount.value - 1);
    smartBuySaleTargetEnd.value = getBuildPhaseEndForSaleCount(smartBuyAbsoluteSimTime(), nextCount);
  }

  // Dry-run plan for the sale-aware ROI buy flow ("70% Return") — the single source of truth for
  // "what gets bought, in what order" for both the Smart Buy preview and the real button click
  // (see `simulateSaleAwareBuy`'s own doc comment). No `currentView` gate, same rationale as
  // `roiRankedResearches` above.
  //
  // Unlike `roiRankedResearches`, this dry-run simulates purchases one at a time (same class of
  // work as the milestone chain above) and can take a noticeable moment against a large backlog —
  // long enough on the main thread to trip Chrome's "Page Unresponsive" hang detector (confirmed in
  // practice). So, same as the milestone chain, this runs in the shared Web Worker
  // (`computeSaleAwareBuy`, from useResearchCalcWorker.ts) instead of a plain `computed`, with its
  // own `isComputingSaleAwarePlan` flag so the "Buy Earnings research" card can show a spinner
  // scoped to just that card while it (re)computes.
  const isComputingSaleAwarePlan = ref(false);
  const saleAwarePlan70Ref = ref<SaleAwareBuyPlan>({
    entries: [],
    endLevels: {},
    endSnapshot: actionsStore.effectiveSnapshot,
  });
  let saleAwarePlanGeneration = 0;

  watchEffect(async () => {
    // Same transitional-state guard as the milestone chain watchEffect below, PLUS `batchMode`/
    // `isRecalculating`: a bulk purchase (Quick Buy, 70% Return, Buy Until Sale Ends, Buy Entire
    // Chain) pushes one action onto `actionsStore.actions` per item bought, then — once the whole
    // batch is applied — recalculateFrom() splices the final recalculated result back in. Both are
    // mutations of the exact array `effectiveSnapshot` (read below) depends on, so without this
    // guard this effect fires once on the mid-batch intermediate state (already obsolete the moment
    // recalculation finishes) AND once more on the final state — paying for two full simulated
    // buy-throughs, of which only the second's result is ever actually used. Waiting for
    // `batchMode`/`isRecalculating` to clear means only the state that's actually going to stick
    // ever gets simulated.
    if (actionsStore.isPlanInitializing || actionsStore.batchMode || actionsStore.isRecalculating) {
      return;
    }

    const researchLevels = commonResearchStore.researchLevels;
    const startSnapshot = actionsStore.effectiveSnapshot;
    const context = getSimulationContext();
    const mods = costModifiers.value;
    const deadline = researchSaleDeadline.value;
    const saleStart = smartBuyStructuralDeadline.value;
    const fullRoiDeadline = smartBuyFullRoiDeadline.value;
    const baseTimestamp = virtueStore.planStartTime.getTime() / 1000;
    const offset = actionsStore.planStartOffset;
    const absoluteSimTime = baseTimestamp + (startSnapshot.lastStepTime - offset);

    const generation = ++saleAwarePlanGeneration;
    // No explicit yield needed: `await computeSaleAwareBuy(...)` below is a genuine postMessage
    // round-trip to the worker, so control already returns to the browser before the computation
    // itself starts.
    isComputingSaleAwarePlan.value = true;

    try {
      // `roiMode: 'immediate'`/`deliveryImpactOnly: false` are hardcoded here, not read from the
      // `roiMode`/`deliveryImpactOnly` refs above (those still back the separate ROI tab) — there's
      // exactly one correct way to run Smart Buy's sale-aware purchasing, so the card offers no
      // override for either. This also means changing the ROI tab's own mode can no longer silently
      // change what this card buys, which it used to.
      const result = await computeSaleAwareBuy({
        researchLevels,
        startSnapshot,
        context,
        mods,
        absoluteSimTime,
        deadline,
        nextSaleStart: saleStart,
        roiMode: 'immediate',
        deliveryImpactOnly: false,
        fullRoiDeadline,
      });

      // Discard if a newer invocation has started since — only the latest result should ever land.
      if (generation === saleAwarePlanGeneration) {
        saleAwarePlan70Ref.value = result;
      }
    } finally {
      // In a `finally`, not just after a successful assignment above: if the worker request throws
      // (or rejects — see useResearchCalcWorker.ts's `onerror` handling), the card should stop
      // spinning (even showing a stale plan) rather than being stuck dimmed forever with no way for
      // a future run to know it needs to reset this.
      if (generation === saleAwarePlanGeneration) {
        isComputingSaleAwarePlan.value = false;
      }
    }
  });

  const saleAwarePlan70 = computed(() => saleAwarePlan70Ref.value);

  const saleAwarePreview = computed(() =>
    summarizeResearchLevelChanges(commonResearchStore.researchLevels, saleAwarePlan70.value.endLevels)
  );

  // Dry-run plan for "Buy Until Sale Ends" — only computed while a sale is actually active, same
  // gating `canBuyUntilSaleDeadline` already applies (there's nothing meaningful to preview
  // otherwise). Same worker treatment as `saleAwarePlan70` above, for the same reason — its own
  // `isComputingSaleEndsPlan` flag scopes the spinner to the "Buy Delivery Research" card. The
  // no-active-sale branch stays a cheap synchronous assignment (nothing to wait on, nothing worth a
  // worker round-trip for), same as the original computed's early return.
  const isComputingSaleEndsPlan = ref(false);
  const saleEndsPlanRef = ref<SaleEndsPlan>({
    researchIds: [],
    earningsResearchIds: [],
    deliveryResearchIds: [],
    earningsEndLevels: {},
    earningsEndSnapshot: actionsStore.effectiveSnapshot,
    endLevels: {},
    endSnapshot: actionsStore.effectiveSnapshot,
    lastPurchaseTimestamp: 0,
  });
  let saleEndsPlanGeneration = 0;

  watchEffect(async () => {
    // Same reasoning as `saleAwarePlan70`'s watchEffect above — wait for a bulk purchase's
    // intermediate mid-batch state to settle rather than simulating it too.
    if (actionsStore.isPlanInitializing || actionsStore.batchMode || actionsStore.isRecalculating) {
      return;
    }

    const isSaleActive = isResearchSaleActive.value;
    const generation = ++saleEndsPlanGeneration;

    if (!isSaleActive) {
      saleEndsPlanRef.value = {
        researchIds: [],
        earningsResearchIds: [],
        deliveryResearchIds: [],
        earningsEndLevels: {},
        earningsEndSnapshot: actionsStore.effectiveSnapshot,
        endLevels: {},
        endSnapshot: actionsStore.effectiveSnapshot,
        lastPurchaseTimestamp: 0,
      };
      isComputingSaleEndsPlan.value = false;
      return;
    }

    const researchLevels = commonResearchStore.researchLevels;
    const startSnapshot = actionsStore.effectiveSnapshot;
    const context = getSimulationContext();
    const mods = costModifiers.value;
    const deadline = researchSaleDeadline.value;
    const mode = elrViewMode.value;
    const sort = elrSortMode.value;
    const rawBackup = initialStateStore.rawBackup;
    const baseTimestamp = virtueStore.planStartTime.getTime() / 1000;
    const offset = actionsStore.planStartOffset;
    const absoluteSimTime = baseTimestamp + (startSnapshot.lastStepTime - offset);

    // No explicit yield needed — see `saleAwarePlan70`'s watchEffect above.
    isComputingSaleEndsPlan.value = true;

    try {
      const result = await computeSaleEndsBuy({
        researchLevels,
        startSnapshot,
        context,
        mods,
        absoluteSimTime,
        deadline,
        elrViewMode: mode,
        elrSortMode: sort,
        rawBackup,
      });

      if (generation === saleEndsPlanGeneration) {
        saleEndsPlanRef.value = result;
      }
    } finally {
      // See `saleAwarePlan70`'s watchEffect above for why this is in a `finally`.
      if (generation === saleEndsPlanGeneration) {
        isComputingSaleEndsPlan.value = false;
      }
    }
  });

  const saleEndsPlan = computed(() => saleEndsPlanRef.value);

  // Split into two summaries instead of one combined diff, so the UI can label the earnings-prelude
  // purchases (bought purely to speed up the delivery research that follows) separately from the
  // delivery research they were bought to speed up. `earningsEndLevels` is the midpoint `simulateSaleEndsBuy`
  // already computes between the plan's start levels and its final `endLevels`.
  const saleEndsEarningsPreview = computed(() =>
    summarizeResearchLevelChanges(commonResearchStore.researchLevels, saleEndsPlan.value.earningsEndLevels)
  );

  const saleEndsPreview = computed(() =>
    summarizeResearchLevelChanges(saleEndsPlan.value.earningsEndLevels, saleEndsPlan.value.endLevels)
  );

  // Current vs. simulated-post-purchase earnings rate for the 70% Return button — the
  // `endSnapshot` the plan already carries (see `simulateSaleAwareBuy`'s doc comment) is exactly
  // what this needed, no extra simulation required.
  const currentOfflineEarningsHourly = computed(() => actionsStore.effectiveSnapshot.offlineEarnings * 3600);

  const saleAwareEarningsSummary70 = computed(() => ({
    before: currentOfflineEarningsHourly.value,
    after: saleAwarePlan70.value.endSnapshot.offlineEarnings * 3600,
  }));

  // Purchase count / duration spanned / gems spent for the "70% Return" card — the same three
  // figures its note reports (`buildSaleAwareBuyNotePayload` in `src/lib/actions/notes.ts`), shown
  // live in the card itself before the button is clicked.
  //
  // `seconds` is the ACTUAL plan's own span (last purchase's `purchaseTimestamp` minus now), not
  // `nextSaleStart - now` (the structural boundary this used to report unconditionally, pre-dating
  // the sale-count picker). That structural figure never changed no matter what deadline was picked
  // — before the picker existed there was nothing to contrast it against, but it's actively
  // misleading now: a tight Gate B (e.g. "1 sale," mid-sale) legitimately stops finding qualifying
  // candidates well before the structural cap, and the card should show that shorter span, not
  // "6d 22h" every single time regardless of what was actually bought. Falls back to `0` when the
  // plan is empty (nothing to span).
  const saleAwareStats70 = computed(() => {
    const baseTimestamp = virtueStore.planStartTime.getTime() / 1000;
    const offset = actionsStore.planStartOffset;
    const absoluteSimTime = baseTimestamp + (actionsStore.effectiveSnapshot.lastStepTime - offset);
    const entries = saleAwarePlan70.value.entries;
    const lastPurchaseTimestamp = entries.length > 0 ? entries[entries.length - 1].purchaseTimestamp : absoluteSimTime;
    return {
      purchaseCount: entries.length,
      seconds: Math.max(0, lastPurchaseTimestamp - absoluteSimTime),
      gems: entries.reduce((sum, entry) => sum + entry.price, 0),
    };
  });

  // Current vs. simulated-post-earnings-prelude earnings rate for "Buy Until Sale Ends" — same
  // shape as `saleAwareEarningsSummary70` above, just measured at `earningsEndSnapshot` (the
  // midpoint between the plan's earnings-prelude and delivery portions) instead of a whole plan's
  // `endSnapshot`.
  const saleEndsEarningsSummary = computed(() => ({
    before: currentOfflineEarningsHourly.value,
    after: saleEndsPlan.value.earningsEndSnapshot.offlineEarnings * 3600,
  }));

  // Purchase count / duration spanned / gems spent for "Buy Until Sale Ends" — the same three
  // figures its note reports (`buildSaleEndsBuyNotePayload` in `src/lib/actions/notes.ts`), shown
  // live in the card itself before the button is clicked.
  //
  // `seconds` is the plan's own span (`lastPurchaseTimestamp - now`), not `researchSaleDeadline -
  // now` — the latter is just the structural window this plan is bounded BY, not how long it
  // actually takes; a plan that runs out of qualifying candidates early legitimately finishes well
  // before the sale ends, and should say so (same fix as `saleAwareStats70` above, for the same
  // reason — see that computed's own comment).
  const saleEndsStats = computed(() => {
    const baseTimestamp = virtueStore.planStartTime.getTime() / 1000;
    const offset = actionsStore.planStartOffset;
    const absoluteSimTime = baseTimestamp + (actionsStore.effectiveSnapshot.lastStepTime - offset);
    return {
      purchaseCount: saleEndsPlan.value.researchIds.length,
      seconds: Math.max(0, saleEndsPlan.value.lastPurchaseTimestamp - absoluteSimTime),
      gems: saleEndsPlan.value.totalGemsSpent ?? 0,
    };
  });

  // Current vs. simulated-post-purchase Delivery Rate for "Buy Until Sale Ends" — same "realistic"
  // (optimal artifacts + max habs/vehicles) calculation `realisticSummary` uses, just evaluated
  // against the plan's simulated end levels instead of the live research levels.
  const saleEndsDeliverySummary = computed(() => {
    const rawBackup = initialStateStore.rawBackup;
    const context = getSimulationContext();
    const before = computeRealisticDeliverySummary(commonResearchStore.researchLevels, rawBackup, context);
    const after = computeRealisticDeliverySummary(saleEndsPlan.value.endLevels, rawBackup, context);
    if (!before || !after) return null;
    return { before: before.elr, after: after.elr };
  });

  const sortedResearches = computed(() => {
    if (currentView.value === 'game' || currentView.value === 'smart_buy') return [];

    if (currentView.value === 'roi') return roiRankedResearches.value;
    if (currentView.value === 'elr') return elrRankedResearches.value;
    if (currentView.value === 'milestones') {
      const startAbsoluteTime = milestoneChainStartTimeRef.value;
      return milestoneChainResult.value.items.map(item => toResearchViewItem(item, startAbsoluteTime));
    }

    const all = getCommonResearches();
    const researchLevels = commonResearchStore.researchLevels;
    const isSale = isResearchSaleActive.value;
    const mods = costModifiers.value;

    const baseTimestamp = virtueStore.planStartTime.getTime() / 1000;
    const offset = actionsStore.planStartOffset;
    const absoluteSimTime = baseTimestamp + (actionsStore.effectiveSnapshot.lastStepTime - offset);

    interface UnpurchasedResearch {
      research: CommonResearch;
      targetLevel: number;
      price: number;
      showDivider?: boolean;
      unlockTier?: number;
    }

    if (currentView.value === 'cheapest') {
      const unpurchased: UnpurchasedResearch[] = [];
      all.forEach(r => {
        const currentLevel = researchLevels[r.id] || 0;
        for (let lvl = currentLevel; lvl < r.levels; lvl++) {
          unpurchased.push({
            research: r,
            targetLevel: lvl + 1,
            price: getDiscountedVirtuePrice(r, lvl, mods, isSale),
          });
        }
      });
      unpurchased.sort((a, b) => a.price - b.price);

      const result: ResearchViewItem[] = [];
      const pool: UnpurchasedResearch[] = [];
      const context = getSimulationContext();
      const baseSnapshot = actionsStore.effectiveSnapshot;
      let currentSimState = createBaseEngineState(baseSnapshot);
      let currentSimSnapshot = baseSnapshot;
      let totalSeconds = 0;

      const formatTimeToBuy = (
        price: number,
        snapshot: CalculationsSnapshot
      ): { timeToBuy: string; secondsToBuy: number } => {
        const seconds = getTimeToSave(price, snapshot);
        if (seconds === Infinity) return { timeToBuy: '∞', secondsToBuy: Infinity };
        return {
          timeToBuy: seconds < 0.1 ? '0s' : formatDuration(seconds),
          secondsToBuy: seconds,
        };
      };

      const processed = new Set<string>();
      // Track tiers that were unlocked but had no items in the pool to receive the divider
      const pendingDividerTiers = new Set<number>();

      const processItem = (item: UnpurchasedResearch) => {
        const r = item.research;
        const key = `${r.id}-${item.targetLevel}`;
        if (processed.has(key)) return;

        const actuallyUnlocked = isTierUnlocked(currentSimState.researchLevels, r.tier);

        if (actuallyUnlocked) {
          processed.add(key);
          const highestUnlockedBefore =
            Array.from({ length: 13 }, (_, i) => i + 1)
              .reverse()
              .find(t => isTierUnlocked(currentSimState.researchLevels, t)) || 1;

          // If this item's tier has a pending divider (unlocked earlier with no pool items),
          // apply the divider to this item
          if (pendingDividerTiers.has(r.tier)) {
            item.showDivider = true;
            item.unlockTier = r.tier;
            pendingDividerTiers.delete(r.tier);
          }

          const { secondsToBuy: sequentialSecondsToBuy } = formatTimeToBuy(item.price, currentSimSnapshot);
          totalSeconds += sequentialSecondsToBuy === Infinity ? 0 : sequentialSecondsToBuy;

          const rawSnapshot = { ...currentSimSnapshot, bankValue: 0 };
          const { timeToBuy: rawTimeToBuy, secondsToBuy: rawSecondsToBuy } = formatTimeToBuy(item.price, rawSnapshot);

          result.push({
            research: r,
            targetLevel: item.targetLevel,
            price: item.price,
            currentLevel: researchLevels[r.id] || 0,
            timeToBuy: sequentialSecondsToBuy < 0.1 ? '0s' : formatDuration(sequentialSecondsToBuy),
            timeToBuySeconds: sequentialSecondsToBuy,
            buyToHereTime: totalSeconds > 0 ? formatDuration(totalSeconds) : '0s',
            buyToHereSeconds: totalSeconds,
            canBuy: true,
            isMaxed: false,
            showDivider: item.showDivider || false,
            unlockTier: item.unlockTier || 0,
            // `isSale` alone can be a stale plan-snapshot flag rather than calendar truth (see
            // `isActuallyDuringSale`'s doc comment in researchROI.ts) — re-verify against the real
            // calendar before letting it gate this warning.
            showDeadlineWarning:
              isRealSaleActiveAt(absoluteSimTime) && absoluteSimTime + totalSeconds > researchSaleDeadline.value,
          });

          currentSimState = applyAction(currentSimState, {
            type: 'buy_research',
            payload: { researchId: r.id, fromLevel: item.targetLevel - 1, toLevel: item.targetLevel },
            cost: item.price,
          });
          currentSimState = applyTime(
            currentSimState,
            sequentialSecondsToBuy === Infinity ? 0 : sequentialSecondsToBuy,
            currentSimSnapshot
          );
          currentSimSnapshot = computeSnapshot(currentSimState, context);

          const getMaxUnlocked = () =>
            Array.from({ length: 13 }, (_, i) => i + 1)
              .reverse()
              .find(t => isTierUnlocked(currentSimState.researchLevels, t)) || 1;

          const highestAfter = getMaxUnlocked();

          if (highestAfter > highestUnlockedBefore) {
            // Record all newly-unlocked tiers as needing dividers
            for (let t = highestUnlockedBefore + 1; t <= highestAfter; t++) {
              if (isTierUnlocked(currentSimState.researchLevels, t)) {
                pendingDividerTiers.add(t);
              }
            }

            for (let i = 0; i < pool.length; i++) {
              const poolTier = pool[i].research.tier;
              if (isTierUnlocked(currentSimState.researchLevels, poolTier)) {
                const stashed = pool.splice(i, 1)[0];
                if (pendingDividerTiers.has(poolTier)) {
                  stashed.showDivider = true;
                  stashed.unlockTier = poolTier;
                  pendingDividerTiers.delete(poolTier);
                }
                processItem(stashed);
                i = -1;
              }
            }
          }
        } else {
          pool.push(item);
        }
      };

      unpurchased.forEach(item => processItem(item));

      pool.forEach(item => {
        const r = item.research;
        const key = `${r.id}-${item.targetLevel}`;
        if (!processed.has(key)) {
          processed.add(key);
          const { secondsToBuy: sequentialSecondsToBuy } = formatTimeToBuy(item.price, currentSimSnapshot);
          totalSeconds += sequentialSecondsToBuy === Infinity ? 0 : sequentialSecondsToBuy;

          const rawSnapshot = { ...currentSimSnapshot, bankValue: 0 };
          const { timeToBuy: rawTimeToBuy, secondsToBuy: rawSecondsToBuy } = formatTimeToBuy(item.price, rawSnapshot);

          result.push({
            research: r,
            targetLevel: item.targetLevel,
            price: item.price,
            currentLevel: researchLevels[r.id] || 0,
            timeToBuy: rawTimeToBuy,
            timeToBuySeconds: rawSecondsToBuy,
            buyToHereTime: totalSeconds > 0 ? formatDuration(totalSeconds) : '0s',
            buyToHereSeconds: totalSeconds,
            buyToHereTooltip:
              totalSeconds < rawSecondsToBuy
                ? 'Includes existing gems from your bank. Individual research wait times show the time to save from 0.'
                : undefined,
            canBuy: true,
            isMaxed: false,
            // `isSale` alone can be a stale plan-snapshot flag rather than calendar truth (see
            // `isActuallyDuringSale`'s doc comment in researchROI.ts) — re-verify against the real
            // calendar before letting it gate this warning.
            showDeadlineWarning:
              isRealSaleActiveAt(absoluteSimTime) && absoluteSimTime + totalSeconds > researchSaleDeadline.value,
          });
        }
      });

      let pathUnlocked = true;
      for (const item of result) {
        if (!isTierUnlocked(researchLevels, item.research.tier)) {
          pathUnlocked = false;
        }
        item.canBuyToHere = pathUnlocked;
      }

      return result;
    }

    return [];
  });

  return {
    currentView,
    elrViewMode,
    elrSortMode,
    elrRoiDisplayMode,
    deliveryImpactOnly,
    roiMode,
    milestoneTarget,
    milestoneNextLockedTier,
    milestoneResearchOptions,
    milestoneSummary,
    milestoneAlreadyReached,
    isComputingMilestoneChain,
    viewDescription,
    costModifiers,
    isResearchSaleActive,
    tiers,
    researchByTier,
    tierSummaries,
    gameViewTimes,
    sortedResearches,
    roiRankedResearches,
    elrRankedResearches,
    saleAwarePlan70,
    isComputingSaleAwarePlan,
    saleAwarePreview,
    saleAwareStats70,
    smartBuyFullRoiDeadline,
    smartBuyStructuralDeadline,
    smartBuyDeadlineIsFinalSaleCap,
    smartBuySaleCount,
    incrementSmartBuySaleCount,
    decrementSmartBuySaleCount,
    saleEndsPlan,
    isComputingSaleEndsPlan,
    saleEndsPreview,
    saleEndsEarningsPreview,
    saleEndsEarningsSummary,
    saleAwareEarningsSummary70,
    saleEndsDeliverySummary,
    saleEndsStats,
    realisticSummary,
    researchSaleDeadline,
    nextSaleStart,
    // Not used within this composable — returned so ResearchActions.vue's own `quickBuyPlan`
    // watchEffect can share this composable's one Web Worker instance (see
    // useResearchCalcWorker.ts's doc comment) instead of spawning a second one.
    computeThresholdBuy,
    TIER_THRESHOLDS: TIER_UNLOCK_THRESHOLDS,
  };
}
