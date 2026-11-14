<template>
  <div class="px-4 py-3 flex flex-col gap-2 border-b border-gray-50/50 last:border-b-0 bg-sky-50/30">
    <!-- Row 1: Icon, name, kind -->
    <div class="flex items-center gap-2.5 w-full">
      <img v-if="item.iconPath" :src="iconURL(item.iconPath, 64)" class="w-7 h-7 object-contain shrink-0" :alt="item.name" />
      <div class="flex-1 min-w-0 flex items-center justify-between gap-2">
        <span class="text-[13px] font-bold text-gray-900 truncate">{{ item.name }}</span>
        <span class="text-[9px] font-black uppercase tracking-wider text-sky-700 bg-sky-100 rounded px-1.5 py-0.5">
          {{ kindLabel }}
        </span>
      </div>
    </div>

    <!-- Row 2: Detail, price -->
    <div class="flex items-start justify-between w-full pl-[38px] gap-4">
      <div class="text-[10px] text-gray-500 leading-snug">{{ item.detail }}</div>
      <div class="text-right shrink-0">
        <div class="flex items-center justify-end gap-1 text-[11px] font-mono text-amber-600 font-bold">
          {{ formatPrice(item.price) }}
          <img :src="iconURL(currency.iconPath, 64)" class="w-2.5 h-2.5 object-contain opacity-80" :alt="currency.name" />
        </div>
        <div v-if="item.duringSale || item.duringEarningsBoost" class="flex items-center justify-end gap-1 mt-0.5">
          <span
            v-if="item.duringSale"
            v-tippy="saleTooltip"
            class="text-[8px] font-black uppercase tracking-tight text-rose-600 bg-rose-50 rounded px-1 py-0.5 cursor-help"
          >
            Sale
          </span>
          <span
            v-if="item.duringEarningsBoost"
            v-tippy="'This purchase completes during the 2x earnings boost.'"
            class="text-[8px] font-black uppercase tracking-tight text-orange-600 bg-orange-50 rounded px-1 py-0.5 cursor-help"
          >
            2x
          </span>
        </div>
      </div>
    </div>

    <!-- Row 3: Achieve ROI, time, buy -->
    <div class="flex items-center justify-between w-full pl-[38px] gap-2">
      <div class="flex-1">
        <div class="flex items-end gap-2 whitespace-nowrap">
          <div class="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Achieve ROI</div>
          <div
            v-tippy="formatAbsoluteTime(item.totalRoiSeconds, baseTimestamp, planStore.ascensionTimezone)"
            class="text-[11px] font-mono text-gray-900 leading-none cursor-help"
          >
            {{ item.totalRoiLabel }}
            <span
              v-if="item.showSaleWarning"
              v-tippy="'This purchase won\'t earn back 70% of its cost before the next Friday sale, and its research part is cheaper then. It is likely better to wait.'"
              class="ml-0.5 cursor-help text-amber-500"
              >⚠️</span
            >
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <div
          class="text-[11px] font-mono text-gray-400 whitespace-nowrap"
          :class="{ 'cursor-help': timeCostTooltipSeconds !== undefined }"
          v-tippy="
            timeCostTooltipSeconds !== undefined
              ? formatAbsoluteTime(timeCostTooltipSeconds, baseTimestamp, planStore.ascensionTimezone)
              : undefined
          "
        >
          {{ item.timeToBuy }}
        </div>
        <button
          v-if="!hideBuyButton"
          v-tippy="'Buy'"
          class="w-7 h-7 flex items-center justify-center rounded transition-colors bg-gray-100 hover:bg-blue-100 text-gray-600 hover:text-blue-600 shadow-sm ring-1 ring-gray-200/50"
          @click.stop="$emit('buy')"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { iconURL } from 'lib';
import { formatAbsoluteTime, formatPrice } from '@planner/lib/format';
import { useActionsStore } from '@planner/stores/actions';
import { usePlanStore } from '@planner/stores/plan';
import { usePlannerProfile } from 'ui/composables/planners/plannerProfile';
import type { FarmViewItem } from 'lib/planners/composables/useResearchViews';

const props = defineProps<{
  item: FarmViewItem;
  hideBuyButton?: boolean;
  /** Chain views: seconds from now until this purchase, for the time's tooltip. */
  timeCostTooltipSeconds?: number;
}>();
defineEmits<{ buy: [] }>();

const { currency } = usePlannerProfile();
const actionsStore = useActionsStore();
const planStore = usePlanStore();

const kindLabel = computed(() =>
  props.item.purchase.kind === 'hab' ? 'Hab' : props.item.purchase.kind === 'train_car' ? 'Train Car' : 'Vehicle'
);

const saleTooltip = computed(() =>
  props.item.purchase.kind === 'hab' ? "This price reflects the plan's hab sale." : "This price reflects the plan's vehicle sale."
);

const baseTimestamp = computed(
  () => planStore.planStartTime.getTime() + (actionsStore.effectiveSnapshot.lastStepTime - actionsStore.planStartOffset) * 1000
);
</script>
