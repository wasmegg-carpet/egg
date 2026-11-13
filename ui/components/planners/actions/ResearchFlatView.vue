<template>
  <div class="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100 bg-white">
    <!-- Unlock Next Tier Shortcut -->
    <div v-if="unlockNextTier" class="px-4 py-3 bg-gradient-to-r from-blue-50 to-white">
      <button
        class="btn-premium btn-primary w-full"
        :disabled="!unlockNextTier.canBuy"
        @click="$emit('buy-to-here', unlockNextTier.index)"
      >
        Unlock Tier {{ unlockNextTier.tier }}
      </button>
      <div class="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[10px] text-gray-500">
        <span>{{ unlockNextTier.purchaseCount }} {{ unlockNextTier.purchaseCount === 1 ? 'purchase' : 'purchases' }}</span>
        <span class="text-gray-400">|</span>
        <span>{{ unlockNextTier.time }}</span>
        <template v-if="unlockNextTier.absoluteTime">
          <span class="text-gray-400">|</span>
          <span>{{ unlockNextTier.absoluteTime }}</span>
        </template>
      </div>
    </div>

    <template v-for="(item, idx) in sortedResearches" :key="isFarmViewItem(item) ? item.key : `${item.research.id}-${item.targetLevel}`">
      <FarmPurchaseRow
        v-if="isFarmViewItem(item)"
        :item="item"
        :hide-buy-button="isChainView"
        :time-cost-tooltip-seconds="isChainView ? item.buyToHereSeconds : undefined"
        @buy="$emit('buy-farm', item)"
      />
      <template v-else>
      <!-- Tier Break Divider (Cheapest First) -->
      <div
        v-if="item.showDivider"
        class="px-4 py-1.5 bg-blue-50 border-y border-blue-100 flex items-center justify-between sticky top-0 z-10 shadow-sm"
      >
        <div class="flex items-center gap-2">
          <div class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
          <span class="text-[10px] font-black text-blue-800 uppercase tracking-widest">
            Tier {{ item.unlockTier }} Unlocked
          </span>
        </div>
        <span class="text-[10px] text-blue-600 font-bold tracking-tighter uppercase">
          {{ thresholds[(item.unlockTier ?? 1) - 1] }} Purchases Reached
        </span>
      </div>

      <ResearchItem
        :research="item.research"
        :current-level="item.currentLevel"
        :target-level="item.targetLevel"
        :price="item.price"
        :time-to-buy="item.timeToBuy || getResearchTimeToBuy(item.research)"
        :time-to-buy-seconds="item.timeToBuySeconds ?? getResearchTimeToBuySeconds(item.research)"
        :time-cost-tooltip-seconds="isChainView ? item.buyToHereSeconds : undefined"
        :can-buy="item.canBuy"
        :is-maxed="item.isMaxed"
        :show-max="false"
        :hide-buy-button="isChainView"
        :show-tier="true"
        :show-buy-to-here="view === 'cheapest'"
        :can-buy-to-here="view === 'cheapest' ? true : item.canBuyToHere"
        :buy-to-here-time="item.buyToHereTime"
        :buy-to-here-seconds="item.buyToHereSeconds"
        :buy-to-here-tooltip="item.buyToHereTooltip"
        :extra-stats="item.extraStats"
        :extra-label="item.extraLabel"
        :extra-seconds="item.extraSeconds"
        :hpp="item.hpp"
        :time-roi-seconds="item.timeRoiSeconds"
        :roi-display-mode="roiDisplayMode"
        :realistic-stats="item.realisticStats"
        :lookahead="item.lookahead"
        :recommendation-note="item.recommendationNote"
        :show-sale-warning="item.showSaleWarning"
        :show-deadline-warning="item.showDeadlineWarning"
        :during-sale="item.duringSale"
        :during-earnings-boost="item.duringEarningsBoost"
        :event-crossings="item.eventCrossings"
        :show-event-crossing-details="showEventCrossingDetails"
        @buy="$emit('buy', item.research)"
        @max="$emit('max', item.research)"
        @buy-to-here="$emit('buy-to-here', idx)"
      />
      </template>
    </template>

    <div v-if="sortedResearches.length === 0" class="px-4 py-8 text-center text-gray-500 italic bg-gray-50">
      <div v-if="isMissingRealisticData" class="max-w-xs mx-auto">
        <p class="text-gray-900 font-bold not-italic mb-1 text-sm">Artifact Data Required</p>
        <p class="text-[11px] leading-relaxed mb-4 not-italic">
          Realistic predictions require your artifact inventory, which this plan doesn't have yet (older plan, or we
          couldn't resolve a player ID to fetch it automatically). Click below to refresh your local data and enable
          the realistic view for this session.
        </p>
        <button
          class="btn-premium btn-primary w-full mt-2"
          @click="$emit('refresh-backup')"
        >
          Refresh & Fix Plan
        </button>
      </div>
      <template v-else-if="view === 'milestones' && !milestoneTargetSelected">
        Pick a milestone above to see the fastest path.
      </template>
      <template v-else-if="view === 'milestones' && milestoneAlreadyReached">
        This milestone has already been reached.
      </template>
      <template v-else-if="view === 'milestones'">
        Unable to find a path to this milestone from the current state.
      </template>
      <template v-else-if="view === 'hab_space' && hasHabSpaceTarget">
        <p>No earnings purchase fits in first. Buy the hab space directly.</p>
        <div
          v-if="habSpaceTierRecommendation"
          class="mt-3 max-w-sm mx-auto not-italic text-left text-xs text-gray-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2"
        >
          <p>
            <span class="font-semibold text-indigo-800">Or unlock tier {{ habSpaceTierRecommendation.tier }} first.</span>
            It takes {{ habSpaceTierRecommendation.purchasesNeeded }} more
            {{ habSpaceTierRecommendation.purchasesNeeded === 1 ? 'purchase' : 'purchases' }}, about
            <span class="font-mono font-semibold">{{ formatDuration(habSpaceTierRecommendation.pathSeconds) }}</span>
            on the Milestones path, and your habs fill in
            <span class="font-mono font-semibold">{{ formatDuration(habSpaceTierRecommendation.fullAtSeconds) }}</span>.
            The new tier's earnings research would then be available here.
          </p>
          <button
            type="button"
            class="mt-1.5 text-indigo-600 hover:text-indigo-800 font-semibold"
            @click="$emit('show-tier-path')"
          >
            Show path to tier {{ habSpaceTierRecommendation.tier }}
          </button>
        </div>
      </template>
      <template v-else-if="view === 'hab_space'">
        No hab space purchase is available from the current state.
      </template>
      <template v-else>
        No researches match this criteria or all are maxed.
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePlannerProfile } from 'ui/composables/planners/plannerProfile';
import { computed } from 'vue';
import { type CommonResearch } from '@planner/calculations/commonResearch';
import {
  type ViewType,
  type ElrRoiDisplayMode,
  type FarmViewItem,
  isFarmViewItem,
} from 'lib/planners/composables/useResearchViews';
import { useInitialStateStore } from '@planner/stores/initialState';
import { useActionsStore } from '@planner/stores/actions';
import { usePlanStore } from '@planner/stores/plan';
import { formatAbsoluteTime, formatDuration } from '@planner/lib/format';
import { type PurchaseEventCrossings } from 'lib/planners/calculations/researchROI';
import ResearchItem from 'ui/components/planners/actions/ResearchItem.vue';
import FarmPurchaseRow from 'ui/components/planners/actions/FarmPurchaseRow.vue';

interface SortedResearchItem {
  research: CommonResearch;
  targetLevel: number;
  price: number;
  currentLevel: number;
  canBuy: boolean;
  isMaxed: boolean;
  timeToBuy?: string;
  timeToBuySeconds?: number;
  buyToHereTime?: string;
  buyToHereSeconds?: number;
  buyToHereTooltip?: string;
  canBuyToHere?: boolean;
  showDivider?: boolean;
  unlockTier?: number;
  extraStats?: string;
  extraLabel?: string;
  extraSeconds?: number;
  hpp?: number;
  timeRoiSeconds?: number;
  realisticStats?: { layRate: number; shippingRate: number; elr: number; elrDelta: number };
  lookahead?: { levels: number; partner?: { name: string; level: number }; helpsAlone: boolean; impact: number; hpp: number };
  recommendationNote?: string;
  showSaleWarning?: boolean;
  showDeadlineWarning?: boolean;
  duringSale?: boolean;
  duringEarningsBoost?: boolean;
  eventCrossings?: PurchaseEventCrossings;
}

const props = defineProps<{
  sortedResearches: (SortedResearchItem | FarmViewItem)[];
  view: ViewType;
  thresholds: readonly number[];
  milestoneTargetSelected?: boolean;
  milestoneAlreadyReached?: boolean;
  hasHabSpaceTarget?: boolean;
  habSpaceTierRecommendation?: { tier: number; purchasesNeeded: number; pathSeconds: number; fullAtSeconds: number } | null;
  showEventCrossingDetails?: boolean;
  getResearchTimeToBuy: (r: CommonResearch) => string;
  getResearchTimeToBuySeconds: (r: CommonResearch) => number;
  roiDisplayMode?: ElrRoiDisplayMode;
}>();

const initialStateStore = useInitialStateStore();
const { hasDeliveryViews } = usePlannerProfile();
const isMissingRealisticData = computed(() => hasDeliveryViews && props.view === 'elr' && !initialStateStore.rawBackup);

// Views whose list is a planned chain, bought all at once rather than row by row.
const isChainView = computed(() => props.view === 'milestones' || props.view === 'hab_space');

const actionsStore = useActionsStore();
const planStore = usePlanStore();

const baseTimestamp = computed(() => {
  const startTime = planStore.planStartTime.getTime();
  const offset = actionsStore.planStartOffset;
  // Wall clock time = (Plan Start) + (Current Sim Time - Initial Sim Time)
  return startTime + (actionsStore.effectiveSnapshot.lastStepTime - offset) * 1000;
});

const unlockNextTier = computed(() => {
  if (props.view !== 'cheapest') return null;

  // The cheapest view lists research only.
  const items = props.sortedResearches.filter((item): item is SortedResearchItem => !isFarmViewItem(item));
  const dividerIndex = items.findIndex(item => item.showDivider);
  if (dividerIndex <= 0) return null;

  const index = dividerIndex - 1;
  const target = items[index];
  return {
    index,
    tier: items[dividerIndex].unlockTier,
    purchaseCount: dividerIndex,
    time: target.buyToHereTime,
    canBuy: target.canBuyToHere,
    absoluteTime:
      target.buyToHereSeconds !== undefined
        ? formatAbsoluteTime(target.buyToHereSeconds, baseTimestamp.value, planStore.ascensionTimezone)
        : undefined,
  };
});

defineEmits(['buy', 'max', 'buy-to-here', 'buy-farm', 'show-tier-path', 'refresh-backup']);
</script>
