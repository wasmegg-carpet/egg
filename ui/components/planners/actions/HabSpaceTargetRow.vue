<template>
  <div class="border border-emerald-200 rounded-lg bg-emerald-50/60 px-4 py-3 flex items-center gap-3">
    <img v-if="summary.targetIconPath" :src="iconURL(summary.targetIconPath, 64)" class="w-8 h-8 shrink-0" alt="" />
    <div class="flex-1 min-w-0">
      <div class="text-[10px] font-bold text-emerald-700 uppercase tracking-wider leading-none mb-1">
        Hab Space Target
      </div>
      <div class="text-sm font-semibold text-gray-900 truncate">{{ summary.targetLabel }}</div>
      <div class="text-xs text-gray-500">+{{ formatNumber(summary.addedCapacity, 0) }} hab space</div>
    </div>
    <div class="text-right shrink-0">
      <div class="text-sm font-mono font-bold text-gray-900">
        {{ formatPrice(summary.targetPrice) }}
        <span
          v-if="summary.targetDuringSale"
          class="ml-1 text-[10px] font-bold text-indigo-600 uppercase tracking-wider"
          >Sale</span
        >
      </div>
      <div
        v-tippy="`Bought ${summary.finishAbsoluteTime}.`"
        class="text-xs text-gray-500 font-mono cursor-help"
      >
        {{ summary.targetWaitSeconds < 1 ? '0s' : formatDuration(summary.targetWaitSeconds) }}
        <span v-if="summary.targetDuringEarningsBoost" class="ml-1 text-[10px] font-bold text-amber-600 uppercase"
          >2x</span
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { iconURL } from 'lib';
import { formatDuration, formatNumber, formatPrice } from '@planner/lib/format';
import type { useResearchViews } from 'lib/planners/composables/useResearchViews';

type HabSpaceSummary = NonNullable<ReturnType<typeof useResearchViews>['habSpaceSummary']['value']>;

defineProps<{ summary: HabSpaceSummary }>();
</script>
