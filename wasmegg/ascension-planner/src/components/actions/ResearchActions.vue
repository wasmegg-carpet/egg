<template>
  <div class="space-y-4">
    <ResearchSaleToggle :is-active="isResearchSaleActive" @toggle="handleToggleSale" />

    <ResearchViewSelector v-model="currentView" :views="VIEWS" />

    <p class="text-sm text-gray-500 mb-4 px-1">
      {{ viewDescription }}
    </p>

    <RoiViewControls
      v-if="currentView === 'roi'"
      :delivery-impact-only="deliveryImpactOnly"
      :roi-mode="roiMode"
      @update:delivery-impact-only="deliveryImpactOnly = $event"
      @update:roi-mode="roiMode = $event"
    />

    <ElrViewControls
      v-if="currentView === 'elr'"
      :view-mode="elrViewMode"
      :sort-mode="elrSortMode"
      :roi-display-mode="elrRoiDisplayMode"
      @update:view-mode="elrViewMode = $event"
      @update:sort-mode="elrSortMode = $event"
      @update:roi-display-mode="elrRoiDisplayMode = $event"
    />

    <SmartBuyView
      v-if="currentView === 'smart_buy'"
      :auto-buy-always-on="autoBuyState.alwaysOn"
      :can-buy-until-sale-warning="canBuyUntilSaleWarning"
      :can-buy-until-sale-deadline="canBuyUntilSaleDeadline"
      :quick-buy-preview="quickBuyPreview"
      :quick-buy-earnings-summary="quickBuyEarningsSummary"
      :quick-buy-stats="quickBuyStats"
      :sale-aware-preview="saleAwarePreview"
      :sale-aware-stats70="saleAwareStats70"
      :smart-buy-deadline-label="smartBuyDeadlineLabel"
      :smart-buy-sale-count="smartBuySaleCount"
      :smart-buy-sale-count-cap="SMART_BUY_SALE_COUNT_CAP"
      :sale-ends-preview="saleEndsPreview"
      :sale-ends-earnings-preview="saleEndsEarningsPreview"
      :sale-ends-earnings-summary="saleEndsEarningsSummary"
      :sale-aware-earnings-summary70="saleAwareEarningsSummary70"
      :sale-ends-delivery-summary="saleEndsDeliverySummary"
      :sale-ends-stats="saleEndsStats"
      :quick-buy-loading="isComputingQuickBuyPlan"
      :quick-buy-applying="isThresholdBuying"
      :sale-aware-loading="isComputingSaleAwarePlan"
      :sale-aware-applying="isApplyingSaleAwareBuy"
      :sale-ends-loading="isComputingSaleEndsPlan"
      :sale-ends-applying="isApplyingSaleEndsBuy"
      @update:auto-buy-always-on="autoBuyState.alwaysOn = $event"
      @quick-buy="handleThresholdBuy"
      @update:quick-buy-threshold-seconds="quickBuyThreshold = $event"
      @auto-buy-update="state => (autoBuyState = state)"
      @increment-smart-buy-sale-count="incrementSmartBuySaleCount"
      @decrement-smart-buy-sale-count="decrementSmartBuySaleCount"
      @buy-until-sale-warning="handleBuyUntilSaleWarning"
      @buy-until-sale-deadline="handleBuyUntilSaleDeadline"
    />

    <MilestoneTargetPicker
      v-if="currentView === 'milestones'"
      v-model="milestoneTarget"
      :next-locked-tier="milestoneNextLockedTier"
      :research-options="milestoneResearchOptions"
    />

    <!-- Milestone summary/buy-chain/toggle area — wrapped so the "computing" spinner below can dim
         just this region instead of the whole page. -->
    <div v-if="currentView === 'milestones'" class="relative">
      <!-- Milestone Summary -->
      <div v-if="milestoneSummary" class="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg shadow-sm">
        <template v-if="milestoneSummary.truncated">
          <p v-if="milestoneSummary.partialPurchaseCount > 0" class="text-xs text-gray-500 text-center italic">
            This milestone takes at least {{ milestoneSummary.partialPurchaseCount }}
            {{ milestoneSummary.partialPurchaseCount === 1 ? 'purchase' : 'purchases' }} (at least
            {{ formatDuration(milestoneSummary.partialSeconds) }}) — too many to fully calculate right now.
          </p>
          <p v-else class="text-xs text-gray-500 text-center italic">
            Unable to find a path to this milestone from the current state.
          </p>
        </template>
        <template v-else>
          <div class="flex flex-wrap justify-center gap-x-6 gap-y-2 text-center">
            <div class="flex flex-col">
              <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none mb-1"
                >Without This Research</span
              >
              <span
                v-tippy="'Time to reach this milestone buying cheapest-first, with no ROI prioritization.'"
                class="text-sm font-mono font-bold text-gray-900 leading-none py-1"
              >
                {{ formatDuration(milestoneSummary.baselineSeconds) }}
              </span>
            </div>
            <div class="flex flex-col">
              <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none mb-1"
                >With This Research</span
              >
              <span
                v-tippy="'Time to reach this milestone by always buying whatever currently pays for itself fastest.'"
                class="text-sm font-mono font-bold text-gray-900 leading-none py-1"
              >
                {{ formatDuration(milestoneSummary.optimizedSeconds) }}
              </span>
            </div>
            <div class="flex flex-col border-l border-gray-200 pl-6">
              <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider leading-none mb-1"
                >Time Saved</span
              >
              <span class="text-sm font-mono font-bold text-emerald-600 leading-none py-1">
                {{ formatDuration(Math.max(0, milestoneSummary.timeSavedSeconds)) }}
              </span>
            </div>
            <div class="flex flex-col border-l border-gray-200 pl-6">
              <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider leading-none mb-1"
                >Researches Bought</span
              >
              <span class="text-sm font-mono font-bold text-gray-900 leading-none py-1">
                {{ milestoneSummary.purchaseCount }}
              </span>
            </div>
            <div class="flex flex-col border-l border-gray-200 pl-6">
              <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider leading-none mb-1"
                >Gems Spent</span
              >
              <span class="text-sm font-mono font-bold text-gray-900 leading-none py-1">
                {{ formatGemPrice(milestoneSummary.gemsSpent) }}
              </span>
            </div>
          </div>
          <p class="mt-2 text-[10px] text-gray-400 text-center">Finishes {{ milestoneSummary.finishAbsoluteTime }}</p>
        </template>
      </div>

      <!-- Buy Entire Chain -->
      <button
        v-if="sortedResearches.length > 0"
        class="btn-premium btn-primary w-full mt-2 disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
        :disabled="isApplyingMilestoneChain"
        @click="handleBuyMilestoneChain"
      >
        <InlineSpinner v-if="isApplyingMilestoneChain" class="w-3.5 h-3.5" />
        {{ isApplyingMilestoneChain ? 'Buying…' : 'Buy Entire Chain' }}
        <span v-if="!isApplyingMilestoneChain" class="ml-1 text-[10px] opacity-70 font-mono lowercase tracking-normal">
          ({{ sortedResearches.length }} {{ sortedResearches.length === 1 ? 'purchase' : 'purchases' }})
        </span>
      </button>

      <!-- Event Crossing Details Toggle -->
      <div v-if="sortedResearches.length > 0" class="flex items-center justify-between mt-2 px-1">
        <span class="text-xs text-gray-500">See details of sale and earnings events</span>
        <button
          class="relative inline-flex h-5 w-10 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner"
          :class="showEventCrossingDetails ? 'bg-indigo-500' : 'bg-slate-200'"
          @click="showEventCrossingDetails = !showEventCrossingDetails"
        >
          <span
            class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-all duration-300 shadow-sm"
            :class="showEventCrossingDetails ? 'translate-x-[22px]' : 'translate-x-1'"
          />
        </button>
      </div>

      <!-- Localized busy state: dims just this area while the milestone chain (re)computes,
           instead of a full-page overlay locking up the whole tab. -->
      <div
        v-if="isComputingMilestoneChain"
        class="absolute inset-0 flex items-center justify-center bg-white/60 rounded-lg"
      >
        <InlineSpinner class="w-6 h-6 text-blue-500" />
      </div>
    </div>

    <!-- Realistic Mode Summary -->
    <div
      v-if="currentView === 'elr' && elrViewMode === 'realistic' && realisticSummary"
      class="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg shadow-sm"
    >
      <div class="flex flex-wrap justify-center gap-x-6 gap-y-2 text-center">
        <div class="flex flex-col">
          <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none mb-1">Lay Rate</span>
          <span
            v-tippy="'Optimal artifacts applied, max population assumed'"
            class="text-sm font-mono font-bold text-gray-900 leading-none py-1"
          >
            {{ formatNumber(realisticSummary.layRate) }}/hr
          </span>
        </div>
        <div class="flex flex-col">
          <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none mb-1"
            >Shipping Cap</span
          >
          <span
            v-tippy="'Optimal artifacts applied, max vehicles assumed'"
            class="text-sm font-mono font-bold text-gray-900 leading-none py-1"
          >
            {{ formatNumber(realisticSummary.shippingRate) }}/hr
          </span>
        </div>
        <div class="flex flex-col border-l border-gray-200 pl-6">
          <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider leading-none mb-1"
            >Delivery Rate</span
          >
          <span
            v-tippy="'The lower of the two rates'"
            class="text-sm font-mono font-bold text-gray-900 leading-none py-1"
          >
            {{ formatNumber(realisticSummary.elr) }}/hr
          </span>
        </div>
      </div>
      <p class="mt-2 text-[10px] text-gray-400 text-center italic leading-tight px-2">
        Note: These stats reflect performance after maxing habs, vehicles, and equipping optimal stone layout.
      </p>
    </div>

    <!-- Wrapped (same as the summary area above) so the milestones-view "computing" spinner dims
         just the list instead of the whole page. Harmless no-op wrapper for every other view. -->
    <div class="relative">
      <!-- Game View (Grouped by Tier) -->
      <ResearchGameView
        v-if="currentView === 'game'"
        :tiers="tiers"
        :research-by-tier="researchByTier"
        :tier-summaries="tierSummaries"
        :view-times="gameViewTimes"
        :levels="commonResearchStore.researchLevels"
        :get-research-price="getNextLevelPrice"
        :get-research-time-to-buy="getTimeToBuy"
        :get-research-time-to-buy-seconds="getTimeToBuySeconds"
        :is-research-sale-active="isResearchSaleActive"
        :research-sale-deadline="researchSaleDeadline"
        @buy="handleBuyResearch"
        @max="handleMaxResearch"
        @max-tier="handleMaxTier"
      />

      <!-- Flat/Sorted Views -->
      <ResearchFlatView
        v-else-if="currentView !== 'smart_buy'"
        :sorted-researches="sortedResearches"
        :view="currentView"
        :thresholds="TIER_THRESHOLDS"
        :milestone-target-selected="!!milestoneTarget"
        :milestone-already-reached="milestoneAlreadyReached"
        :show-event-crossing-details="showEventCrossingDetails"
        :get-research-time-to-buy="getTimeToBuy"
        :get-research-time-to-buy-seconds="getTimeToBuySeconds"
        :roi-display-mode="elrRoiDisplayMode"
        @buy="handleBuyResearch"
        @max="handleMaxResearch"
        @buy-to-here="handleBuyToHere"
        @refresh-backup="$emit('refresh-backup')"
      />

      <div
        v-if="currentView === 'milestones' && isComputingMilestoneChain"
        class="absolute inset-0 flex items-center justify-center bg-white/60 rounded-lg"
      >
        <InlineSpinner class="w-6 h-6 text-blue-500" />
      </div>
    </div>

    <EventExpiryDialog
      v-if="showExpiryDialog"
      :event-name="expiryData.eventName"
      :end-time="expiryData.endTime"
      :completion-time="expiryData.completionTime"
      @cancel="handleExpiryCancel"
      @deactivate-and-cancel="handleExpiryDeactivateAndCancel"
      @deactivate-and-continue="handleExpiryDeactivateAndContinue"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue';
import { getDiscountedVirtuePrice, getResearchById, type CommonResearch } from '@/calculations/commonResearch';
import { formatDuration, formatNumber, formatGemPrice, formatAbsoluteTime } from '@/lib/format';
import { useCommonResearchStore } from '@/stores/commonResearch';
import { useActionsStore } from '@/stores/actions';
import { useSalesStore } from '@/stores/sales';
import { useVirtueStore } from '@/stores/virtue';
import { computeDependencies } from '@/lib/actions/executor';
import { generateActionId, type Action } from '@/types';
import { useActionExecutor } from '@/composables/useActionExecutor';
import {
  createNoteAction,
  buildQuickBuyNotePayload,
  buildSaleAwareBuyNotePayload,
  buildSaleEndsBuyNotePayload,
  buildMilestoneNotePayload,
} from '@/lib/actions/notes';
import { useResearchViews, VIEWS, SMART_BUY_SALE_COUNT_CAP } from '@/composables/useResearchViews';
import { getTimeToSave, boostTransitionsFrom } from '@/engine/apply';
import { getSimulationContext } from '@/engine/adapter';
import { buyWhilePassingCheck, buyUntilRealSaleStarts } from '@/calculations/researchRanking';
import {
  getSaleAwareTimeToSave,
  shouldDeferToNextSale,
  findEventCrossings,
  type EventCrossing,
} from '@/calculations/researchROI';
import { getNextSaleStart } from '@/lib/events';
import {
  simulateThresholdBuy,
  summarizeResearchLevelChanges,
  type SaleAwarePlanEntry,
  type SimpleBuyPlan,
} from '@/calculations/smartBuyPreview';
import { yieldForOverlayPaint } from '@/lib/yieldForOverlayPaint';
import { DEBUG_MILESTONE_EXECUTION } from '@/lib/debugFlags';
import InlineSpinner from '@/components/InlineSpinner.vue';

// Sub-components
import ResearchSaleToggle from './ResearchSaleToggle.vue';
import ResearchViewSelector from './ResearchViewSelector.vue';
import ResearchGameView from './ResearchGameView.vue';
import ResearchFlatView from './ResearchFlatView.vue';
import ElrViewControls from './ElrViewControls.vue';
import RoiViewControls from './RoiViewControls.vue';
import SmartBuyView from './SmartBuyView.vue';
import MilestoneTargetPicker from './MilestoneTargetPicker.vue';
import EventExpiryDialog from '../EventExpiryDialog.vue';
import { useEventExpiry } from '@/composables/useEventExpiry';

const commonResearchStore = useCommonResearchStore();
const actionsStore = useActionsStore();
const salesStore = useSalesStore();
const virtueStore = useVirtueStore();
const { prepareExecution, completeExecution, batch } = useActionExecutor();
const {
  showExpiryDialog,
  expiryData,
  withExpiryCheck,
  cancel: handleExpiryCancel,
  deactivateAndCancel: handleExpiryDeactivateAndCancel,
  deactivateAndContinue: handleExpiryDeactivateAndContinue,
} = useEventExpiry();

const autoBuyState = ref({ threshold: 0, alwaysOn: false });
// Reactive (not a plain `let`) so the Quick Buy button can bind its disabled/spinner state to the
// same flag that already guards against re-entrant threshold-buy calls (see `handleThresholdBuy`).
const isThresholdBuying = ref(false);
const showEventCrossingDetails = ref(false);

// Busy flags for the other three bulk-purchase buttons ("Buy Entire Chain" on the milestones view,
// "70% Return" and "Buy Until Sale Ends" on the Smart Buy view) — drive their disabled/spinner
// state while the (synchronous, potentially slow) purchase loop and subsequent recalculation run,
// same purpose `isThresholdBuying` already serves for Quick Buy.
const isApplyingMilestoneChain = ref(false);
const isApplyingSaleAwareBuy = ref(false);
const isApplyingSaleEndsBuy = ref(false);

const {
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
  computeThresholdBuy,
  TIER_THRESHOLDS,
} = useResearchViews();

// "70% Return"'s Gate B deadline, formatted for the sale-ride stepper — `smartBuyFullRoiDeadline` is
// an absolute Unix timestamp (seconds), so `formatAbsoluteTime` is called with `seconds: 0` and that
// timestamp (in ms) as its own base, same trick `milestoneSummary.finishAbsoluteTime` doesn't need
// (it already works from an elapsed-seconds/base-timestamp pair) but is the natural way to format an
// already-absolute value with this helper.
const smartBuyDeadlineLabel = computed(() =>
  formatAbsoluteTime(0, smartBuyFullRoiDeadline.value * 1000, virtueStore.ascensionTimezone)
);

// Quick Buy's own live threshold (separate from Auto Buy's) — fed up from QuickBuy.vue's input so
// its preview can update as the user types, without QuickBuy owning any store access itself.
const quickBuyThreshold = ref(0);

// Same worker treatment `saleAwarePlan70`/`saleEndsPlan` get in useResearchViews.ts (see their doc
// comments) — a plain `computed` here would recompute synchronously on every keystroke in the
// threshold input with no way to show a spinner for it, and a large enough threshold can hit the
// same 2000-simulated-purchase cap the other three do. `computeThresholdBuy` (destructured above
// from `useResearchViews()`) shares that composable's one worker instance rather than spawning a
// second one just for this.
const isComputingQuickBuyPlan = ref(false);
const quickBuyPlanRef = ref<SimpleBuyPlan>({
  researchIds: [],
  endLevels: {},
  endSnapshot: actionsStore.effectiveSnapshot,
});
let quickBuyPlanGeneration = 0;

watchEffect(async () => {
  // `batchMode`/`isRecalculating` guard: same reasoning as `saleAwarePlan70`'s watchEffect in
  // useResearchViews.ts — without it, a bulk purchase elsewhere (70% Return, Buy Until Sale Ends,
  // Buy Entire Chain) makes this effect simulate the doomed mid-batch intermediate state once, then
  // the final settled state again a moment later.
  if (actionsStore.isPlanInitializing || actionsStore.batchMode || actionsStore.isRecalculating) {
    return;
  }

  const researchLevels = commonResearchStore.researchLevels;
  const startSnapshot = actionsStore.effectiveSnapshot;
  const context = getSimulationContext();
  const mods = costModifiers.value;
  const isSale = isResearchSaleActive.value;
  const threshold = quickBuyThreshold.value;

  const generation = ++quickBuyPlanGeneration;
  // No explicit yield needed: `await computeThresholdBuy(...)` below is a genuine postMessage
  // round-trip to the worker, so control already returns to the browser before the computation
  // itself starts.
  isComputingQuickBuyPlan.value = true;

  try {
    const result = await computeThresholdBuy({
      researchLevels,
      startSnapshot,
      context,
      mods,
      isSale,
      thresholdSeconds: threshold,
    });

    // Discard if a newer invocation has started since — only the latest result should ever land.
    if (generation === quickBuyPlanGeneration) {
      quickBuyPlanRef.value = result;
    }
  } finally {
    // In a `finally` so a thrown error still stops the card spinning instead of leaving it dimmed
    // forever with nothing left to reset it.
    if (generation === quickBuyPlanGeneration) {
      isComputingQuickBuyPlan.value = false;
    }
  }
});

const quickBuyPlan = computed(() => quickBuyPlanRef.value);
const quickBuyPreview = computed(() =>
  summarizeResearchLevelChanges(commonResearchStore.researchLevels, quickBuyPlan.value.endLevels)
);
const quickBuyEarningsSummary = computed(() => ({
  before: actionsStore.effectiveSnapshot.offlineEarnings * 3600,
  after: quickBuyPlan.value.endSnapshot.offlineEarnings * 3600,
}));

// Purchase count / time-saved / gems spent for the Quick Buy card — the same three figures its note
// reports (`buildQuickBuyNotePayload` in `src/lib/actions/notes.ts`), shown live in the card itself
// before the button is clicked.
const quickBuyStats = computed(() => ({
  purchaseCount: quickBuyPlan.value.researchIds.length,
  seconds: quickBuyPlan.value.totalSecondsToSave ?? 0,
  gems: quickBuyPlan.value.totalGemsSpent ?? 0,
}));

function getNextLevelPrice(research: CommonResearch): number {
  const currentLevel = commonResearchStore.researchLevels[research.id] || 0;
  if (currentLevel >= research.levels) return 0;
  return getDiscountedVirtuePrice(research, currentLevel, costModifiers.value, isResearchSaleActive.value);
}

function getTimeToBuy(research: CommonResearch): string {
  const price = getNextLevelPrice(research);
  const seconds = getTimeToSave(price, actionsStore.effectiveSnapshot);
  if (seconds <= 0) return '0s';
  if (seconds === Infinity) return '∞';
  return formatDuration(seconds);
}

function getTimeToBuySeconds(research: CommonResearch): number {
  const price = getNextLevelPrice(research);
  return getTimeToSave(price, actionsStore.effectiveSnapshot);
}

// Some sortedResearches branches (e.g. ROI view) don't populate buyToHereSeconds,
// since it's simulated step-by-step and only meaningful for a defined "chain" (cheapest/milestones).
function getSimulatedBuyToHereSeconds(item: unknown): number | undefined {
  const seconds = (item as { buyToHereSeconds?: unknown }).buyToHereSeconds;
  return typeof seconds === 'number' ? seconds : undefined;
}

/**
 * Buy a single level of research and create the action.
 * Returns true if successful, false if already maxed.
 */
function buyOneLevel(research: CommonResearch): boolean {
  const currentLevel = commonResearchStore.researchLevels[research.id] || 0;
  if (currentLevel >= research.levels) return false;

  // Prepare execution (restores stores if editing past group)
  const beforeSnapshot = prepareExecution();

  // Calculate cost based on current state (after restore if editing)
  const effectiveLevel = beforeSnapshot.researchLevels[research.id] || 0;
  const isSaleActive = beforeSnapshot.activeSales.research;
  const cost = getDiscountedVirtuePrice(research, effectiveLevel, costModifiers.value, isSaleActive);

  // Build payload
  const payload = {
    researchId: research.id,
    fromLevel: effectiveLevel,
    toLevel: effectiveLevel + 1,
  };

  // Compute dependencies (level N depends on the action that bought level N-1)
  const dependencies = computeDependencies(
    'buy_research',
    payload,
    actionsStore.actionsBeforeInsertion,
    actionsStore.initialSnapshot.researchLevels
  );

  if (DEBUG_MILESTONE_EXECUTION) {
    console.log(
      `[ResearchActions] buyOneLevel: ${research.id} Lv${effectiveLevel}, now=${new Date(absoluteSimTimeAt(beforeSnapshot.lastStepTime) * 1000).toISOString()}, bank=${beforeSnapshot.bankValue}, isSaleActive=${isSaleActive} -> cost=${cost}`
    );
  }

  // Apply to store
  commonResearchStore.setResearchLevel(research.id, effectiveLevel + 1);

  // Complete execution (computes snapshot, inserts/pushes action, replays if needed)
  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'buy_research',
      payload,
      cost,
      dependsOn: dependencies,
    },
    beforeSnapshot
  );

  // Trigger automated sweep if Always On is enabled
  if (!isThresholdBuying.value && autoBuyState.value.alwaysOn) {
    handleThresholdBuy(autoBuyState.value.threshold);
  }

  return true;
}

/**
 * Absolute Unix timestamp (seconds) that `lastStepTime` (a snapshot's plan-relative clock reading)
 * corresponds to — same formula `WaitForEventActions.vue`/`useResearchViews.ts` use everywhere else.
 */
function absoluteSimTimeAt(lastStepTime: number): number {
  const baseTimestamp = virtueStore.planStartTime.getTime() / 1000;
  return baseTimestamp + (lastStepTime - actionsStore.planStartOffset);
}

/** Inserts a wait action of the given type/duration, returning its id (or undefined if seconds <= 0). */
function insertWait(
  type: 'wait_for_research_sale' | 'wait_for_earnings_boost' | 'wait_for_time',
  seconds: number,
  beforeSnapshot: ReturnType<typeof prepareExecution>
): string | undefined {
  if (seconds <= 0) return undefined;
  const id = generateActionId();
  const payload = { totalTimeSeconds: seconds };
  completeExecution(
    {
      id,
      timestamp: Date.now(),
      type,
      payload,
      cost: 0,
      dependsOn: computeDependencies(
        type,
        payload,
        actionsStore.actionsBeforeInsertion,
        actionsStore.initialSnapshot.researchLevels
      ),
    },
    beforeSnapshot
  );
  return id;
}

function insertToggleSale(
  active: boolean,
  waitId: string | undefined,
  beforeSnapshot: ReturnType<typeof prepareExecution>
) {
  const payload = { saleType: 'research' as const, active, multiplier: 0.3 };
  salesStore.setSaleActive('research', active);
  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'toggle_sale',
      payload,
      cost: 0,
      dependsOn: [
        ...computeDependencies(
          'toggle_sale',
          payload,
          actionsStore.actionsBeforeInsertion,
          actionsStore.initialSnapshot.researchLevels
        ),
        ...(waitId ? [waitId] : []),
      ],
    },
    beforeSnapshot
  );
}

function insertToggleEarningsBoost(
  active: boolean,
  waitId: string | undefined,
  beforeSnapshot: ReturnType<typeof prepareExecution>
) {
  const payload = { active, multiplier: active ? 2 : 1 };
  salesStore.setEarningsBoost(active, payload.multiplier);
  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'toggle_earnings_boost',
      payload,
      cost: 0,
      dependsOn: [
        ...computeDependencies(
          'toggle_earnings_boost',
          payload,
          actionsStore.actionsBeforeInsertion,
          actionsStore.initialSnapshot.researchLevels
        ),
        ...(waitId ? [waitId] : []),
      ],
    },
    beforeSnapshot
  );
}

/**
 * Before buying `item.research`, bring `activeSales.research`/`earningsBoost.active` in line with
 * whether THIS SPECIFIC purchase — computed fresh from the live/current state — actually resolves
 * during each event or not. Deliberately does NOT trust a plan's precomputed `duringSale`/
 * `duringEarningsBoost` (as an earlier version of this function did): those are snapshotted at
 * planning time, and can drift from what's actually true by the time execution reaches this item
 * (e.g. because an earlier item in the same batch banked more, or less, than the plan assumed —
 * `syncEventStateForItem` itself, by inserting real actions, is one such source of drift). Recomputing
 * live here makes the sync self-correcting regardless of that drift's size or source, instead of
 * blindly forcing a wait for an event boundary the live state may already be past or short of.
 *
 * Sale and boost crossings are computed ONCE, over the SAME true wait window (`purchase.waitSeconds`
 * from `getSaleAwareTimeToSave`, which already accounts for whether waiting for the sale beats
 * buying now, and already prices in boost-accelerated earning during the wait via `transitions`),
 * then merged and walked in a single chronological pass — not two separate sequential blocks. An
 * earlier version handled sale and boost independently: a "sale" block computed both crossing types
 * from the true starting point but only ever inserted the sale ones, then a separate "boost" block
 * re-derived its OWN wait from whatever state the sale block had already advanced to. Any boost
 * window that fell entirely inside the *sale-waiting* period was computed correctly the first time
 * (it's right there in that first call's own `crossings.boost`) but silently discarded, and the
 * second block's from-scratch window started only AFTER that boundary had already passed, so it
 * never got a another chance to find it. Merging both lists chronologically here fixes that: every
 * crossing — sale or boost, in whatever order they actually occur — gets its own wait+toggle action.
 *
 * When a boundary genuinely is crossed, a `wait_for_research_sale`/`wait_for_earnings_boost`
 * (starting) or plain `wait_for_time` (ending — there's no dedicated `wait_for_*_end` action type,
 * and the start-only types are hardcoded to the wrong day in `refreshActionPayload` if reused here)
 * action is inserted for exactly the calendar distance to that boundary, then the toggle. This
 * doesn't double-count time: the wait's duration is independent of price, and the purchase that
 * follows computes its own (correspondingly shorter) remaining wait from the bank/population the
 * wait action already advanced to. When no boundary is actually crossed, nothing is inserted at all.
 *
 * `checkRoiGate` (only passed `true` by `handleBuyMilestoneChain`) additionally enforces the same
 * "clears 70% ROI by the next research sale" bar `computeResearchMilestoneChain`'s own detour/target
 * steps now require before including a purchase — see that function's doc comment
 * (`milestoneChain.ts`) for why: without it, a purchase that only becomes affordable a few minutes
 * before a sale gets bought immediately at full price, when waiting those few minutes would have
 * meant 70% off. Recomputed fresh here (not trusted from the plan) for the same self-correcting
 * reason every other number in this function is. Not applied to `runSaleAwareBuyFlow`'s or
 * "Buy Until Sale Ends"'s own calls — their candidates are already selected by rules (the 70% button
 * literally, "Buy Until Sale Ends" by delivery impact rather than earnings ROI) this gate would be
 * redundant or actively wrong for.
 */
function syncEventStateForItem(item: { research: CommonResearch }, checkRoiGate = false) {
  const beforeSnapshot = prepareExecution();
  const level = beforeSnapshot.researchLevels[item.research.id] || 0;
  if (level >= item.research.levels) return;

  const absoluteSimTime = absoluteSimTimeAt(beforeSnapshot.lastStepTime);
  const transitions = boostTransitionsFrom(beforeSnapshot, absoluteSimTime);
  const isSaleActive = beforeSnapshot.activeSales.research;
  const isBoostActive = beforeSnapshot.earningsBoost.active;
  const purchase = getSaleAwareTimeToSave(
    item.research,
    level,
    costModifiers.value,
    isSaleActive,
    absoluteSimTime,
    beforeSnapshot,
    transitions
  );

  // Already timed to buy during a real sale (or waiting for a later one) — `shouldDeferToNextSale`'s
  // own during-sale bypass would pass trivially, so skip the extra check entirely.
  if (checkRoiGate && !purchase.duringSale) {
    const nextSale = getNextSaleStart(absoluteSimTime);
    const defer = shouldDeferToNextSale(
      item.research,
      level,
      costModifiers.value,
      beforeSnapshot,
      getSimulationContext(),
      absoluteSimTime,
      nextSale,
      researchSaleDeadline.value,
      isSaleActive,
      transitions,
      purchase.duringSale
    );

    if (defer) {
      if (DEBUG_MILESTONE_EXECUTION) {
        console.log(
          `[ResearchActions] syncEventStateForItem: ${item.research.id} Lv${level} would not clear 70% ROI before nextSaleStart=${new Date(nextSale * 1000).toISOString()} at full price — waiting for the sale instead of buying now`
        );
      }
      advanceToDeadline(nextSale);
      return;
    }
  }

  const crossings = findEventCrossings(absoluteSimTime, purchase.waitSeconds, isSaleActive, isBoostActive);

  if (DEBUG_MILESTONE_EXECUTION) {
    const completesAt = absoluteSimTime + purchase.waitSeconds;
    console.log(
      `[ResearchActions] syncEventStateForItem: ${item.research.id} Lv${level}, now=${new Date(absoluteSimTime * 1000).toISOString()}, bank=${beforeSnapshot.bankValue}, offlineEarnings=${beforeSnapshot.offlineEarnings}, isSaleActive=${isSaleActive} -> price=${purchase.price}, waitSeconds=${purchase.waitSeconds}, duringSale=${purchase.duringSale}, completesAt=${new Date(completesAt * 1000).toISOString()}, saleCrossings=${crossings.sale.length}, boostCrossings=${crossings.boost.length}`
    );
  }

  insertEventCrossingWaits(absoluteSimTime, crossings, beforeSnapshot);
}

/**
 * Shared by `syncEventStateForItem` (crossings up to a purchase's own wait) and `advanceToDeadline`
 * (crossings up to a fixed target time with no purchase attached): merges the sale and boost
 * crossing lists into true chronological order and inserts a wait+toggle action pair for each one.
 * See `syncEventStateForItem`'s git history for why merging matters — treating sale and boost as two
 * independent sequential passes silently drops a boost window that falls entirely inside a
 * sale-wait period.
 *
 * Each list's `waitSeconds` is relative to its own previous crossing (or to `absoluteSimTime` for
 * the first) — convert both to absolute timestamps first so they can be merged regardless of which
 * type occurs first. Returns the snapshot and absolute time reached after the last crossing (equal
 * to `absoluteSimTime` itself, with the input snapshot, if there were no crossings at all).
 */
function insertEventCrossingWaits(
  absoluteSimTime: number,
  crossings: { sale: EventCrossing[]; boost: EventCrossing[] },
  beforeSnapshot: ReturnType<typeof prepareExecution>
): { snapshot: ReturnType<typeof prepareExecution>; cursor: number } {
  type TaggedCrossing = { absoluteTime: number; togglesTo: boolean; kind: 'sale' | 'boost' };
  const toTagged = (list: EventCrossing[], kind: TaggedCrossing['kind']): TaggedCrossing[] => {
    let cursor = absoluteSimTime;
    return list.map(c => {
      cursor += c.waitSeconds;
      return { absoluteTime: cursor, togglesTo: c.togglesTo, kind };
    });
  };
  const allCrossings = [...toTagged(crossings.sale, 'sale'), ...toTagged(crossings.boost, 'boost')].sort(
    (a, b) => a.absoluteTime - b.absoluteTime
  );

  let cursor = absoluteSimTime;
  let snapshot = beforeSnapshot;
  for (const crossing of allCrossings) {
    const waitSeconds = crossing.absoluteTime - cursor;
    if (crossing.kind === 'sale') {
      const waitId = insertWait(crossing.togglesTo ? 'wait_for_research_sale' : 'wait_for_time', waitSeconds, snapshot);
      snapshot = waitId ? prepareExecution() : snapshot;
      insertToggleSale(crossing.togglesTo, waitId, snapshot);
    } else {
      const waitId = insertWait(
        crossing.togglesTo ? 'wait_for_earnings_boost' : 'wait_for_time',
        waitSeconds,
        snapshot
      );
      snapshot = waitId ? prepareExecution() : snapshot;
      insertToggleEarningsBoost(crossing.togglesTo, waitId, snapshot);
    }
    cursor = crossing.absoluteTime;
  }
  return { snapshot, cursor };
}

/**
 * Carries the plan's clock the rest of the way to `targetDeadline` on its own, inserting whatever
 * wait+toggle actions the remaining sale/boost crossings between "wherever the buy loop stopped"
 * and the deadline need. `runSaleAwareBuyFlow`'s buy loop only advances time as a side effect of
 * `syncEventStateForItem` calls made right before each purchase — so if it stops because
 * `getNextCandidate()` ran out of qualifying research (rather than because the deadline was
 * actually reached), nothing else ever carries the plan forward, and the promised "wait for the
 * sale to end, then the boost, then wait for the next sale" progression silently doesn't happen. A
 * no-op if `targetDeadline` has already been reached (e.g. the transitional bypass purchase already
 * carried the clock there).
 */
function advanceToDeadline(targetDeadline: number) {
  if (!isFinite(targetDeadline)) return;
  const beforeSnapshot = prepareExecution();
  const absoluteSimTime = absoluteSimTimeAt(beforeSnapshot.lastStepTime);
  const waitSeconds = targetDeadline - absoluteSimTime;
  if (waitSeconds <= 0) return;

  const isSaleActive = beforeSnapshot.activeSales.research;
  const isBoostActive = beforeSnapshot.earningsBoost.active;
  const crossings = findEventCrossings(absoluteSimTime, waitSeconds, isSaleActive, isBoostActive);

  const { snapshot: afterSnapshot, cursor } = insertEventCrossingWaits(absoluteSimTime, crossings, beforeSnapshot);

  // Any stretch after the last crossing (or the whole window, if there were none at all — e.g. no
  // boost is due before the next sale) still needs a plain wait so the clock actually reaches
  // targetDeadline, not just its last crossing.
  const remaining = targetDeadline - cursor;
  if (remaining > 0) {
    insertWait('wait_for_time', remaining, afterSnapshot);
  }
}

// Automatically sweep when Always On is toggled on
watch(
  () => autoBuyState.value.alwaysOn,
  newVal => {
    if (newVal && !isThresholdBuying.value) {
      handleThresholdBuy(autoBuyState.value.threshold);
    }
  }
);

function handleBuyResearch(research: CommonResearch) {
  const duration = getTimeToBuySeconds(research);
  withExpiryCheck(duration, true, () => buyOneLevel(research));
}

// Whether the "70% Return" button has anything to buy — derived directly from the precomputed plan
// (`saleAwarePlan70`, the same plan the button executes) rather than an independent live re-check.
// An earlier version re-derived this from `roiRankedResearches` (the ROI tab's own ranking) via
// `meetsSaleAwareDeadline`, which only ever tested the old single 70%-by-next-sale bar — now that
// buying also requires clearing the "100% by ride end" gate (see `rankResearchByROI`'s
// `showBuyNowRoiWarning`/`showFullRoiWarning` in researchRanking.ts), an independent re-check would
// need to duplicate both gates (bottleneck-pairing included) to stay accurate, which is exactly what
// `saleAwarePlan70` already computed. Reading it here instead guarantees this can never disagree with
// what the button actually does, at the cost of one worker round-trip of latency — already covered by
// `isComputingSaleAwarePlan`'s own spinner state.
const canBuyUntilSaleWarning = computed(() => saleAwarePlan70.value.entries.length > 0);

// Action types `syncEventStateForItem`/`insertEventCrossingWaits` insert immediately ahead of a
// purchase (wait+toggle pairs, one pair per sale/boost crossing the purchase's own wait passes
// through) — see that function's doc comment. Used by `findBypassEventCrossingIds` below to walk
// backward from a bypassed purchase and find just its own prelude, not anything belonging to the
// purchase before it.
const EVENT_CROSSING_ACTION_TYPES = new Set<Action['type']>([
  'wait_for_time',
  'wait_for_research_sale',
  'wait_for_earnings_boost',
  'toggle_sale',
  'toggle_earnings_boost',
]);

// A single sale-to-sale gap (~6 days) or sale duration (~1 day) alone never reaches this — see the
// threshold check below for why the SUM across a purchase's whole crossing prelude is what matters,
// not any individual wait.
const BYPASS_WAIT_THRESHOLD_SECONDS = 7 * 24 * 60 * 60;

/**
 * Finds the wait/toggle actions belonging to one specific bypassed purchase (`actionId`, already
 * confirmed to have landed at-or-after the target deadline by this file's cleanup loop), so they can
 * be swept along with it — walks backward from the purchase through `EVENT_CROSSING_ACTION_TYPES`
 * actions until hitting something else (the previous purchase, a note, or the shift header), which
 * is exactly the prelude `syncEventStateForItem` inserted for THIS purchase and no other.
 *
 * `computeDependencies` never links a purchase to the waits ahead of it (they're prerequisites its
 * own timing already accounts for, not something else depends on removing) — see
 * `buyUntilRealSaleStarts`'s doc comment in researchRanking.ts on why leaving them in place is
 * normally correct. It stops being correct specifically when `getSaleAwareTimeToSave` decided a
 * LATER sale (not the immediate one) was worth waiting for: ordinary crossings a purchase legitimately
 * waits through (a sale ending, a boost starting) sum to at most a few days, but a purchase that
 * jumped to a sale several cycles out leaves a prelude summing to a week or more — distinguishing the
 * two by the SUM across the whole prelude, not any single wait in it, since a multi-cycle jump is
 * itself built from several sub-week segments (each sale-to-sale gap is ~6 days, just under the
 * threshold) chained together.
 *
 * Returns `[]` (nothing to additionally remove) whenever the prelude sums to under the threshold —
 * that's the ordinary case, and `runSaleAwareBuyFlow`'s caller falls back to removing just the
 * purchase itself, unchanged from before this function existed.
 */
function findBypassEventCrossingIds(actionId: string): string[] {
  const index = actionsStore.actions.findIndex(a => a.id === actionId);
  if (index === -1) return [];

  const ids: string[] = [];
  let totalWaitSeconds = 0;
  for (let i = index - 1; i >= 0; i--) {
    const action = actionsStore.actions[i];
    if (!EVENT_CROSSING_ACTION_TYPES.has(action.type)) break;
    ids.push(action.id);
    if (
      action.type === 'wait_for_time' ||
      action.type === 'wait_for_research_sale' ||
      action.type === 'wait_for_earnings_boost'
    ) {
      totalWaitSeconds += (action.payload as { totalTimeSeconds: number }).totalTimeSeconds;
    }
  }
  return totalWaitSeconds >= BYPASS_WAIT_THRESHOLD_SECONDS ? ids : [];
}

// Driver behind "Buy Until Sale Warning": walks a precomputed plan (`saleAwarePlan70` — see
// `simulateSaleAwareBuy`'s doc comment in smartBuyPreview.ts) rather than independently
// re-deriving candidates live, so the preview shown under the button and what actually gets
// bought are guaranteed to match — one source of truth, not two. Only candidate *selection*
// comes from the plan; buying still goes through the real `syncEventStateForItem`/`buyOneLevel`
// (inserting real wait/toggle/purchase history) and the same post-hoc bypass-cleanup sweep as
// before (see `buyUntilRealSaleStarts`'s doc comment in researchRanking.ts for the full
// rationale).
//
// The deadline is captured ONCE, up front, rather than re-derived from "is a sale active right
// now" each iteration: if the button is clicked while a DIFFERENT sale is already active,
// `nextSaleStart` already points past it (getNextPacificTime never returns something at-or-before
// its input), to the sale that's actually 6-7 days out — so buying should proceed through the
// currently-active sale (at whatever its real price is) toward THAT target, not bail out
// immediately just because some sale happens to be live already.
//
// `smartBuyStructuralDeadline`, not the raw `nextSaleStart`: this caps at the ride's own
// `smartBuyFullRoiDeadline` so a click that's already buying WITHIN the final sale of a multi-sale
// ride doesn't get padded an entire extra week further, into a sale beyond what this ride was ever
// aiming for — see that computed's own doc comment in useResearchViews.ts for the full reasoning
// (confirmed as a real, reported bug: clicking mid-final-sale used to advance the plan's clock all
// the way to the sale after next, even though nothing more was left to buy in this ride).
async function runSaleAwareBuyFlow(plan: SaleAwarePlanEntry[]) {
  const startAbsoluteTime = absoluteSimTimeAt(actionsStore.effectiveSnapshot.lastStepTime);
  const targetDeadline = smartBuyStructuralDeadline.value;

  let result: { purchased: number; duringSalePurchases: { actionId: string; purchaseTimestamp: number }[] } = {
    purchased: 0,
    duringSalePurchases: [],
  };
  let index = 0;
  await batch(() => {
    // Note goes in ahead of the purchases it's summarizing, same as Quick Buy's. `plan` is already
    // the exact sequence about to be bought (see this function's doc comment above), so every figure
    // the note needs is available before anything is actually purchased. The duration reported is
    // the plan's own span (last entry's `purchaseTimestamp` minus now), not `targetDeadline -
    // startAbsoluteTime` — that structural boundary doesn't reflect what's actually being bought
    // (see `saleAwareStats70`'s identical fix in useResearchViews.ts for the full reasoning); an
    // empty plan reports `0` since there's nothing to span.
    const lastPlanTimestamp = plan.length > 0 ? plan[plan.length - 1].purchaseTimestamp : startAbsoluteTime;
    const notePayload = buildSaleAwareBuyNotePayload(
      plan.length,
      smartBuySaleCount.value,
      lastPlanTimestamp - startAbsoluteTime,
      plan.reduce((sum, entry) => sum + entry.price, 0)
    );
    if (notePayload) {
      const noteBeforeSnapshot = prepareExecution();
      completeExecution(
        createNoteAction(
          notePayload,
          computeDependencies(
            'notification',
            notePayload,
            actionsStore.actionsBeforeInsertion,
            actionsStore.initialSnapshot.researchLevels
          )
        ),
        noteBeforeSnapshot
      );
    }

    result = buyUntilRealSaleStarts(
      () => plan[index],
      researchId => {
        const next = plan[index];
        index++;
        const research = getResearchById(researchId);
        if (!research) return false;
        if (next) syncEventStateForItem({ research });
        return buyOneLevel(research);
      },
      () => absoluteSimTimeAt(actionsStore.effectiveSnapshot.lastStepTime) >= targetDeadline,
      () => actionsStore.actions[actionsStore.actions.length - 1]?.id
    );
  });

  // Only sweep purchases that actually landed at-or-after the target deadline — one that used a
  // DIFFERENT, already-active sale's real price before ever reaching the target isn't the bypass
  // this cleanup exists for (see runSaleAwareBuyFlow's own comment above).
  const toRemove = result.duringSalePurchases.filter(p => p.purchaseTimestamp >= targetDeadline);
  for (const { actionId } of toRemove.reverse()) {
    const bypassWaitIds = findBypassEventCrossingIds(actionId);
    if (bypassWaitIds.length > 0) {
      await actionsStore.removeActions([actionId, ...bypassWaitIds]);
    } else {
      await actionsStore.executeUndo(actionId, 'dependents');
    }
  }

  // The buy loop only advances time as a side effect of buying something. If it stopped because
  // candidates ran out rather than because targetDeadline was actually reached, carry the clock
  // (and any sale/boost toggles due along the way) the rest of the way there on its own — but only
  // when `targetDeadline` is a genuine "wait for the next sale" boundary (something is actually
  // waiting there: the sale toggling on, more purchases becoming affordable). When
  // `smartBuyDeadlineIsFinalSaleCap` is true, `targetDeadline` is the ride's OWN final sale ending
  // while purchasing is already happening inside it — nothing is waiting at that boundary once
  // candidates have genuinely run out, so padding the clock there would just burn the rest of the
  // sale for no reason. Stop right where the last real purchase (or the start, if none) left off
  // instead.
  if (!smartBuyDeadlineIsFinalSaleCap.value) {
    advanceToDeadline(targetDeadline);
  }
}

// Executes the precomputed 70%-return plan (`saleAwarePlan70` — same plan the preview under the
// button displays).
async function handleBuyUntilSaleWarning() {
  isApplyingSaleAwareBuy.value = true;
  // Let the button's disabled/spinner state actually paint before the purchase loop below blocks
  // the tab.
  await yieldForOverlayPaint();
  try {
    await runSaleAwareBuyFlow(saleAwarePlan70.value.entries);
  } finally {
    isApplyingSaleAwareBuy.value = false;
  }
}

// Best-ranked buyable Delivery Impact item that would still finish before the sale ends,
// i.e. the one "Buy Until Sale Ends" would buy next. A higher-ranked item may be skipped
// over here because it fails the check while a cheaper, lower-ranked one still passes.
const nextElrCandidate = computed(() =>
  elrRankedResearches.value.find(item => item.canBuy && !item.isMaxed && !item.showDeadlineWarning)
);

const canBuyUntilSaleDeadline = computed(() => isResearchSaleActive.value && !!nextElrCandidate.value);

// Executes the precomputed sale-ends plan (`saleEndsPlan` — same plan the preview under the
// button displays). Candidate selection comes from the plan; buying still goes through the real
// `syncEventStateForItem`/`buyOneLevel`.
async function handleBuyUntilSaleDeadline() {
  if (!isResearchSaleActive.value) return;

  isApplyingSaleEndsBuy.value = true;
  // Let the button's disabled/spinner state actually paint before the purchase loop below blocks
  // the tab.
  await yieldForOverlayPaint();

  const plan = saleEndsPlan.value.researchIds;
  let index = 0;
  try {
    await batch(() => {
      // Note goes in ahead of the purchases it's summarizing, same as the other Smart Buy notes.
      // `plan` is already the exact sequence about to be bought, so every figure the note needs is
      // available before anything is purchased. Duration reported is the plan's own span
      // (`lastPurchaseTimestamp - now`), not `researchSaleDeadline - now` — see `saleEndsStats`'s
      // identical fix in useResearchViews.ts for why that structural figure doesn't reflect what's
      // actually being bought.
      const startAbsoluteTime = absoluteSimTimeAt(actionsStore.effectiveSnapshot.lastStepTime);
      const notePayload = buildSaleEndsBuyNotePayload(
        plan.length,
        saleEndsPlan.value.lastPurchaseTimestamp - startAbsoluteTime,
        saleEndsPlan.value.totalGemsSpent ?? 0
      );
      if (notePayload) {
        const noteBeforeSnapshot = prepareExecution();
        completeExecution(
          createNoteAction(
            notePayload,
            computeDependencies(
              'notification',
              notePayload,
              actionsStore.actionsBeforeInsertion,
              actionsStore.initialSnapshot.researchLevels
            )
          ),
          noteBeforeSnapshot
        );
      }

      buyWhilePassingCheck(
        () => (index < plan.length ? { researchId: plan[index] } : undefined),
        researchId => {
          index++;
          const research = getResearchById(researchId);
          if (!research) return false;
          syncEventStateForItem({ research });
          return buyOneLevel(research);
        }
      );
    });
  } finally {
    isApplyingSaleEndsBuy.value = false;
  }
}

// Shared by Quick Buy's one-time click and Auto Buy's background sweep. Executes the precomputed
// plan from `simulateThresholdBuy` (same function backing Quick Buy's own live preview) rather
// than independently re-deriving candidates — unifies both callers' execution onto one code path,
// even though only Quick Buy gets a preview *displayed*.
//
// `isThresholdBuying` now stays true through the `await batch(...)` below (not just the purchase
// loop, as before) so it can double as the Quick Buy button's busy/spinner state — it's already
// disabled while true, so this only makes the existing re-entrancy guard a little more
// conservative, not less correct.
async function handleThresholdBuy(threshold: number) {
  if (isThresholdBuying.value) return;
  isThresholdBuying.value = true;
  // Let the button's disabled/spinner state actually paint before the purchase loop below — fully
  // synchronous once it starts — blocks the tab.
  await yieldForOverlayPaint();

  try {
    await batch(() => {
      const plan = simulateThresholdBuy(
        commonResearchStore.researchLevels,
        actionsStore.effectiveSnapshot,
        getSimulationContext(),
        costModifiers.value,
        isResearchSaleActive.value,
        threshold
      );

      // Note goes in ahead of the purchases it's summarizing, so history reads "why did these show
      // up" before it reads the purchases themselves.
      const notePayload = buildQuickBuyNotePayload(
        threshold,
        plan.researchIds.length,
        plan.totalSecondsToSave ?? 0,
        plan.totalGemsSpent ?? 0
      );
      if (notePayload) {
        const noteBeforeSnapshot = prepareExecution();
        completeExecution(
          createNoteAction(
            notePayload,
            computeDependencies(
              'notification',
              notePayload,
              actionsStore.actionsBeforeInsertion,
              actionsStore.initialSnapshot.researchLevels
            )
          ),
          noteBeforeSnapshot
        );
      }

      for (const researchId of plan.researchIds) {
        const research = getResearchById(researchId);
        if (!research) continue;
        if (!buyOneLevel(research)) break;
      }
    });
  } finally {
    isThresholdBuying.value = false;
  }
}

function handleMaxResearch(research: CommonResearch) {
  // Estimate total duration for maxing
  const currentLevels = commonResearchStore.researchLevels[research.id] || 0;
  let totalDuration = 0;
  for (let l = currentLevels; l < research.levels; l++) {
    // This is an approximation as earnings might change, but good enough for warning
    totalDuration += getTimeToBuySeconds(research);
  }

  withExpiryCheck(totalDuration, true, () => {
    batch(() => {
      const maxLevel = research.levels;
      while ((commonResearchStore.researchLevels[research.id] || 0) < maxLevel) {
        if (!buyOneLevel(research)) break;
      }
    });
  });
}

function handleMaxTier(tier: number) {
  batch(() => {
    const researches = researchByTier.value.get(tier) || [];
    for (const research of researches) {
      const maxLevel = research.levels;
      while ((commonResearchStore.researchLevels[research.id] || 0) < maxLevel) {
        if (!buyOneLevel(research)) break;
      }
    }
  });
}

function handleBuyToHere(index: number) {
  const list = sortedResearches.value;
  if (index < 0 || index >= list.length) return;

  // buyToHereSeconds is simulated step-by-step (earnings rate updates as each
  // item is bought), unlike summing getTimeToBuySeconds against today's static rate.
  let totalDuration = getSimulatedBuyToHereSeconds(list[index]);
  if (totalDuration === undefined) {
    totalDuration = 0;
    for (let i = 0; i <= index; i++) {
      totalDuration += getTimeToBuySeconds(list[i].research);
    }
  }

  withExpiryCheck(totalDuration, true, () => {
    batch(() => {
      for (let i = 0; i <= index; i++) {
        const item = list[i];
        buyOneLevel(item.research);
      }
    });
  });
}

// Human-readable description of the current milestone target, for the note `handleBuyMilestoneChain`
// inserts ahead of its purchases — same wording `MilestoneTargetPicker.vue` uses for the target
// itself ("Unlock Tier N" / "Research Name (Lv X/Y)"), so the note reads consistently with the
// picker the player just used to choose it.
function getMilestoneTargetLabel(): string {
  const target = milestoneTarget.value;
  if (!target) return 'Milestone';
  if (target.kind === 'tier') return `Unlock Tier ${target.tier}`;
  const research = getResearchById(target.researchId);
  return research ? `${research.name} (Lv ${target.targetLevel}/${research.levels})` : 'Milestone';
}

async function handleBuyMilestoneChain() {
  const list = sortedResearches.value;
  if (list.length === 0) return;

  // Same reasoning as handleBuyToHere: use the chain's simulated final duration
  // rather than summing individual durations against today's static earnings rate.
  let totalDuration = getSimulatedBuyToHereSeconds(list[list.length - 1]);
  if (totalDuration === undefined) {
    totalDuration = 0;
    for (const item of list) {
      totalDuration += getTimeToBuySeconds(item.research);
    }
  }

  if (DEBUG_MILESTONE_EXECUTION) {
    const startSnapshot = actionsStore.effectiveSnapshot;
    console.log(
      `[ResearchActions] handleBuyMilestoneChain: START, ${list.length} items, predicted totalDuration=${totalDuration}s, now=${new Date(absoluteSimTimeAt(startSnapshot.lastStepTime) * 1000).toISOString()}, bank=${startSnapshot.bankValue}, offlineEarnings=${startSnapshot.offlineEarnings}, predicted finish=${new Date((absoluteSimTimeAt(startSnapshot.lastStepTime) + (totalDuration ?? 0)) * 1000).toISOString()}`
    );
  }

  isApplyingMilestoneChain.value = true;
  // Let the button's disabled/spinner state actually paint before the purchase loop below — fully
  // synchronous once it starts — blocks the tab.
  await yieldForOverlayPaint();

  // No withExpiryCheck here, unlike handleMaxResearch/handleBuyToHere: each item's
  // syncEventStateForItem call below already inserts its own wait+toggle actions for any
  // sale/boost boundary the chain crosses, so the chain resolves those boundaries on its own
  // instead of needing the player to confirm losing/keeping the event up front (same reasoning
  // as handleThresholdBuy, which skips the check for the same reason).
  try {
    await batch(() => {
      // Note goes in ahead of the purchases it's summarizing, same as the Smart Buy notes. Time
      // saved only comes along when the Milestone Summary panel itself has a baseline comparison to
      // show (see `buildMilestoneNotePayload`'s doc comment) — `milestoneSummary` reflects the
      // target as currently selected, same source the summary panel above the button reads from.
      const summary = milestoneSummary.value;
      const timeSavedSeconds = summary && !summary.truncated ? summary.timeSavedSeconds : undefined;
      const notePayload = buildMilestoneNotePayload(
        getMilestoneTargetLabel(),
        list.length,
        totalDuration,
        list.reduce((sum, item) => sum + item.price, 0),
        timeSavedSeconds
      );
      if (notePayload) {
        const noteBeforeSnapshot = prepareExecution();
        completeExecution(
          createNoteAction(
            notePayload,
            computeDependencies(
              'notification',
              notePayload,
              actionsStore.actionsBeforeInsertion,
              actionsStore.initialSnapshot.researchLevels
            )
          ),
          noteBeforeSnapshot
        );
      }

      for (const item of list) {
        syncEventStateForItem(item, true);
        buyOneLevel(item.research);
      }

      if (DEBUG_MILESTONE_EXECUTION) {
        const endSnapshot = actionsStore.effectiveSnapshot;
        console.log(
          `[ResearchActions] handleBuyMilestoneChain: DONE, now=${new Date(absoluteSimTimeAt(endSnapshot.lastStepTime) * 1000).toISOString()}, bank=${endSnapshot.bankValue}`
        );
      }
    });
  } finally {
    isApplyingMilestoneChain.value = false;
  }
}

function handleToggleSale() {
  const beforeSnapshot = prepareExecution();
  const currentlyActive = beforeSnapshot.activeSales.research;

  const payload = {
    saleType: 'research' as const,
    active: !currentlyActive,
    multiplier: 0.3, // 70% off
  };

  // Update store state
  salesStore.setSaleActive('research', !currentlyActive);

  // Deactivate Auto Buy whenever a sale is toggled
  autoBuyState.value.alwaysOn = false;

  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'toggle_sale',
      payload,
      cost: 0,
      dependsOn: computeDependencies(
        'toggle_sale',
        payload,
        actionsStore.actionsBeforeInsertion,
        actionsStore.initialSnapshot.researchLevels
      ),
    },
    beforeSnapshot
  );
}
</script>
