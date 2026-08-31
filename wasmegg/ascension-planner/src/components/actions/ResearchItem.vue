<template>
  <div
    class="px-4 py-3 flex flex-col gap-2 transition-opacity duration-200 border-b border-gray-50/50 last:border-b-0"
    :class="{ 'opacity-50': !canBuy && !isMaxed }"
  >
    <!-- Row 1: Icon, Name (with level) -->
    <div class="flex items-center gap-2.5 w-full">
      <!-- Icon -->
      <img
        :src="iconURL(getResearchIconPath(research.id), 64)"
        class="w-7 h-7 object-contain shrink-0"
        :alt="research.name"
      />

      <!-- Name & Level -->
      <div class="flex-1 min-w-0 flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center justify-start gap-2">
          <span class="text-[13px] font-bold text-gray-900 truncate">
            <span v-if="showTier" class="text-gray-400 font-mono text-[10px] mr-1">T{{ research.tier }}</span>
            {{ research.name }}
          </span>
          <span class="text-[11px] font-medium text-gray-500 whitespace-nowrap hidden sm:inline-block">
            <span v-if="targetLevel" class="text-gray-900">Lvl {{ targetLevel }}</span>
            <span v-else>Lvl {{ currentLevel }}</span>
            / {{ research.levels }}
          </span>
        </div>
        <span class="text-[11px] font-medium text-gray-500 whitespace-nowrap sm:hidden">
          <span v-if="targetLevel" class="text-gray-900">Lvl {{ targetLevel }}</span>
          <span v-else>Lvl {{ currentLevel }}</span>
          / {{ research.levels }}
        </span>
      </div>
    </div>

    <!-- Row 2: Description, Gem Cost -->
    <div class="flex items-start justify-between w-full pl-[38px] gap-4">
      <!-- Description -->
      <div class="text-[10px] text-gray-500 leading-snug">
        {{ research.description }}
        
        <div
          v-if="lookahead"
          class="mt-1.5 p-1.5 inline-block bg-amber-50 border border-amber-100 rounded text-[9px] text-amber-800 leading-tight shadow-sm"
        >
          <div class="flex items-start gap-1">
            <svg class="w-3 h-3 text-amber-500 shrink-0 mt-px" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <span>
              <span class="font-bold uppercase tracking-tight mr-1">Lookahead:</span>
              Needs {{ lookahead.minLevels }} levels for +{{ (lookahead.impact * 100).toFixed(3) }}% Delivery Rate ({{ lookahead.hpp.toFixed(1) }} hr/%)
            </span>
          </div>
        </div>
      </div>

      <!-- Gem Cost -->
      <div class="text-right shrink-0">
        <template v-if="!isMaxed">
          <div class="flex items-center justify-end gap-1 text-[11px] font-mono text-amber-600 font-bold">
            {{ formatGemPrice(price) }}
            <img :src="iconURL('egginc/icon_virtue_gem.png', 64)" class="w-2.5 h-2.5 object-contain opacity-80" alt="Gem" />
          </div>
          <div v-if="duringSale || duringEarningsBoost" class="flex items-center justify-end gap-1 mt-0.5">
            <span
              v-if="duringSale"
              class="text-[8px] font-black uppercase tracking-tight text-rose-600 bg-rose-50 rounded px-1 py-0.5 cursor-help"
              v-tippy="'This price reflects the 70% research sale discount.'"
            >
              Sale
            </span>
            <span
              v-if="duringEarningsBoost"
              class="text-[8px] font-black uppercase tracking-tight text-orange-600 bg-orange-50 rounded px-1 py-0.5 cursor-help"
              v-tippy="'This purchase completes during the 2x earnings boost.'"
            >
              2x
            </span>
          </div>
          <div
            v-if="showEventCrossingDetails && (eventCrossings?.sale.length || eventCrossings?.boost.length)"
            class="flex flex-col items-end gap-0.5 mt-0.5"
          >
            <span
              v-for="(crossing, i) in eventCrossings?.sale ?? []"
              :key="`sale-${i}`"
              v-tippy="crossingTooltip('research sale', crossing)"
              class="text-[8px] font-bold text-gray-400 whitespace-nowrap cursor-help"
            >
              ⏳ Sale {{ crossing.togglesTo ? 'starts' : 'ends' }} in {{ formatDuration(crossing.waitSeconds) }}
            </span>
            <span
              v-for="(crossing, i) in eventCrossings?.boost ?? []"
              :key="`boost-${i}`"
              v-tippy="crossingTooltip('2x earnings boost', crossing)"
              class="text-[8px] font-bold text-gray-400 whitespace-nowrap cursor-help"
            >
              ⏳ 2x {{ crossing.togglesTo ? 'starts' : 'ends' }} in {{ formatDuration(crossing.waitSeconds) }}
            </span>
          </div>
        </template>
        <div v-else class="text-[10px] text-emerald-600 font-black uppercase tracking-widest mt-0.5">Maxed</div>
      </div>
    </div>

    <!-- Row 3: Metrics, Time Cost, Actions -->
    <div class="flex items-center justify-between w-full pl-[38px] gap-2">
      <!-- Extra Stats (Left aligned) -->
      <div class="flex-1">
        <div v-if="extraStats" class="whitespace-nowrap">
          <div class="flex items-end gap-2">
            <div
              class="text-[9px] font-bold text-gray-400 uppercase tracking-tighter"
              :class="{ 'cursor-help': hpp !== undefined }"
              v-tippy="
                hpp === undefined
                  ? undefined
                  : roiDisplayMode === 'time'
                    ? 'Time, laying at the boosted rate, for the extra production to pay back what it cost to buy this research.'
                    : 'Estimated waiting time (hours) per 1% Egg Laying Rate impact based on current earnings. Lower is better.'
              "
            >
              {{ extraLabel }}
            </div>
            <div
              class="text-[11px] font-mono text-gray-900 leading-none"
              v-tippy="
                extraLabel === 'Achieve ROI' && extraSeconds !== undefined
                  ? formatAbsoluteTime(extraSeconds, baseTimestamp, virtueStore.ascensionTimezone)
                  : undefined
              "
            >
              {{ extraStats }}
              <span
                v-if="showSaleWarning"
                class="ml-0.5 cursor-help text-amber-500"
                v-tippy="'This research won\'t earn back 70% of its cost before the next Friday sale. It is likely better to wait.'"
              >
                ⚠️
              </span>
            </div>
            <div v-if="hpp !== undefined" class="text-[9px] font-mono text-gray-400 leading-none pb-[1px]">
              <template v-if="roiDisplayMode === 'time'">
                {{ formatDuration(timeRoiSeconds ?? Infinity) }}
              </template>
              <template v-else>
                {{ hpp === Infinity || isNaN(hpp) ? '∞' : hpp.toFixed(1) }} hr/%
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Time Cost and Actions (Right aligned) -->
      <div class="flex items-center gap-2 shrink-0">
        <!-- Time Cost -->
        <div v-if="timeToBuy && !isMaxed" class="text-[11px] font-mono text-gray-400 whitespace-nowrap">
          {{ timeToBuy }}
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-1.5 pl-1">
          <!-- Buy to Here (Cheapest view only) -->
          <button
            v-if="showBuyToHere && !isMaxed"
            class="bg-blue-600 text-white hover:bg-blue-700 font-bold uppercase tracking-widest text-[10px] py-1.5 px-3 rounded shadow-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            :class="showDeadlineWarning ? 'bg-amber-500 hover:bg-amber-600' : ''"
            :disabled="!canBuyToHere"
            v-tippy="deadlineWarningTooltip(buyToHereSeconds, buyToHereTooltip)"
            @click.stop="$emit('buyToHere')"
          >
            Buy to here
            <span v-if="buyToHereTime" class="ml-1 text-[9px] opacity-70 font-mono lowercase tracking-normal">({{ buyToHereTime }})</span>
          </button>

          <!-- Buy one level button -->
          <button
            v-if="!hideBuyButton"
            class="w-7 h-7 flex items-center justify-center rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            :class="[
              showDeadlineWarning
                ? 'bg-amber-100 hover:bg-amber-200 text-amber-700 ring-1 ring-amber-400/50 shadow-sm'
                : 'bg-gray-100 hover:bg-blue-100 text-gray-600 hover:text-blue-600 shadow-sm ring-1 ring-gray-200/50'
            ]"
            :disabled="!canBuy || isMaxed || (targetLevel !== undefined && targetLevel !== currentLevel + 1)"
            v-tippy="deadlineWarningTooltip(timeToBuySeconds)"
            @click.stop="$emit('buy')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
            </svg>
          </button>

          <!-- Max button for individual research -->
          <button
            v-if="showMax"
            class="text-[10px] font-black uppercase tracking-tight py-1 px-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-sm border border-gray-200/60"
            :class="showDeadlineWarning ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-300' : ''"
            :disabled="!canBuy || isMaxed"
            v-tippy="deadlineWarningTooltip(maxTimeSeconds)"
            @click.stop="$emit('max')"
          >
            Max
            <span v-if="maxTime" class="ml-0.5 text-[8px] opacity-70 font-mono font-medium lowercase tracking-normal">({{ maxTime }})</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Row 3b: Pair Suggestion (Conditional, full width, own line) -->
    <div
      v-if="recommendationNote"
      class="w-full pl-[38px]"
    >
      <div class="p-1.5 inline-block bg-blue-50 border border-blue-100 rounded text-[9px] text-blue-800 leading-tight shadow-sm">
        <div class="flex items-start gap-1">
          <svg class="w-3 h-3 text-blue-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clip-rule="evenodd"
            />
          </svg>
          <span>
            <span class="font-bold uppercase tracking-tight mr-1">Pair Suggestion:</span>
            {{ recommendationNote }}
            <span v-if="showSaleWarning" class="block mt-0.5 text-amber-600 font-bold">
              ⚠️ Even paired, this won't earn back 70% before the next sale.
            </span>
          </span>
        </div>
      </div>
    </div>

    <!-- Row 4: Realistic Stats Comparison (Conditional) -->
    <div v-if="realisticStats" class="mt-1 flex items-center justify-between w-full pl-[38px] py-1 border-t border-gray-50">
       <div class="flex items-center gap-6">
         <div class="flex flex-col">
           <span class="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none mb-1 text-center font-mono">Lay Rate</span>
           <span class="text-[10px] font-mono font-bold text-gray-600 leading-none text-center">
             {{ formatNumber(realisticStats.layRate) }}/hr
           </span>
         </div>
         <div class="flex flex-col">
           <span class="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none mb-1 text-center font-mono">Shipping Cap</span>
           <span class="text-[10px] font-mono font-bold text-gray-600 leading-none text-center">
             {{ formatNumber(realisticStats.shippingRate) }}/hr
           </span>
         </div>
       </div>
       <div class="text-right">
         <span class="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none mb-1 block text-right font-mono">Delivery Rate</span>
         <div class="flex items-center justify-end gap-1 leading-none">
           <span class="text-[11px] font-mono font-bold text-gray-900">
             {{ formatNumber(realisticStats.elr) }}/hr
           </span>
           <span v-if="realisticStats.elrDelta > 0.001" class="text-[9px] font-mono font-bold text-gray-400 ml-1">
             (+{{ formatWithReference(realisticStats.elrDelta, realisticStats.elr) }})
           </span>
         </div>
       </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CommonResearch } from '@/calculations/commonResearch';
import { formatNumber, formatGemPrice, formatAbsoluteTime, formatDuration, formatWithReference } from '@/lib/format';
import { getResearchIconPath } from '@/lib/assets';
import { iconURL } from 'lib';
import { useActionsStore } from '@/stores/actions';
import { useVirtueStore } from '@/stores/virtue';
import { type PurchaseEventCrossings } from '@/calculations/researchROI';

const props = defineProps<{
  research: CommonResearch;
  currentLevel: number;
  price: number;
  timeToBuy: string;
  canBuy: boolean;
  isMaxed: boolean;
  extraStats?: string;
  extraLabel?: string;
  hpp?: number;
  showMax: boolean;
  hideBuyButton?: boolean;
  showTier?: boolean;
  targetLevel?: number;
  showBuyToHere?: boolean;
  canBuyToHere?: boolean;
  buyToHereTime?: string;
  recommendationNote?: string;
  maxTime?: string;
  timeToBuySeconds?: number;
  maxTimeSeconds?: number;
  buyToHereSeconds?: number;
  buyToHereTooltip?: string;
  extraSeconds?: number;
  timeRoiSeconds?: number;
  roiDisplayMode?: 'hpp' | 'time';
  realisticStats?: { layRate: number; shippingRate: number; elr: number; elrDelta: number };
  lookahead?: { minLevels: number; impact: number; hpp: number };
  showSaleWarning?: boolean;
  showDeadlineWarning?: boolean;
  duringSale?: boolean;
  duringEarningsBoost?: boolean;
  eventCrossings?: PurchaseEventCrossings;
  showEventCrossingDetails?: boolean;
}>();

const actionsStore = useActionsStore();
const virtueStore = useVirtueStore();

const baseTimestamp = computed(() => {
  const startTime = virtueStore.planStartTime.getTime();
  const offset = actionsStore.planStartOffset;
  // Wall clock time = (Plan Start) + (Current Sim Time - Initial Sim Time)
  return startTime + (actionsStore.effectiveSnapshot.lastStepTime - offset) * 1000;
});

// `crossing.waitSeconds` is the length of the wait segment leading up to that crossing (from the
// previous crossing, or from now for the first one) — so "after a Xh wait" is accurate regardless
// of whether this is the first event boundary saving up for this purchase hits, or a later one
// (e.g. a multi-day purchase that saves through an entire boost cycle, start and end both).
function crossingTooltip(eventLabel: string, crossing: { waitSeconds: number; togglesTo: boolean }): string {
  const direction = crossing.togglesTo ? 'starts' : 'ends';
  return `Saving up for this crosses the ${eventLabel} ${direction}, after a ${formatDuration(crossing.waitSeconds)} wait.`;
}

function deadlineWarningTooltip(seconds?: number, extraText?: string) {
  if (seconds === undefined) return extraText || '';
  const timeStr = formatAbsoluteTime(seconds, baseTimestamp.value, virtueStore.ascensionTimezone);
  const warning = props.showDeadlineWarning
    ? `${timeStr} is after next Saturday at +0. Turn off the research sale to see realistic prices.`
    : timeStr;
  
  if (extraText) {
    return `${extraText}\n\nEstimated completion: ${warning}`;
  }
  return warning;
}

defineEmits<{
  (e: 'buy'): void;
  (e: 'max'): void;
  (e: 'buyToHere'): void;
}>();
</script>
