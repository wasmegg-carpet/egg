<template>
  <div class="bg-slate-50/30 border-t border-slate-100/50" :class="compact ? 'px-3 py-2' : 'px-5 py-4'">
    <div class="flex flex-wrap items-center justify-between" :class="compact ? 'gap-2' : 'gap-4'">
      <!-- Label -->
      <div v-if="!hideHeader" class="flex items-center gap-3">
        <div
          class="w-5 h-5 rounded-lg bg-rose-50 border border-rose-100 shadow-sm flex items-center justify-center p-1"
        >
          <svg class="w-full h-full text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
        </div>
        <span class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Resilience Summary</span>
        <div v-if="activeArtifactSet === 'earnings'" class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200/50">
          <span class="text-[9px] font-black font-mono-premium text-slate-700">{{ formatNumber(hourlyOfflineEarnings, 3) }}</span>
          <span class="text-[8px] font-black uppercase tracking-widest text-slate-400">/hr</span>
        </div>
        <div v-else-if="activeArtifactSet === 'elr'" class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200/50">
          <span class="text-[9px] font-black font-mono-premium text-slate-700">{{ formatNumber(hourlyELR, 3) }}</span>
          <span class="text-[8px] font-black uppercase tracking-widest text-slate-400">/hr</span>
        </div>
      </div>

      <!-- Stats Grid -->
      <div
        v-if="silosPurchased > 0"
        class="flex flex-wrap items-center"
        :class="compact ? 'gap-x-3 gap-y-1' : 'gap-x-6 gap-y-2'"
      >
        <div class="flex flex-col items-end">
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Silos</span>
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-mono-premium font-black text-slate-900">{{ silosPurchased }}</span>
            <span class="text-[10px] font-bold text-slate-500 uppercase tracking-tight">{{
              silosPurchased === 1 ? 'Silo' : 'Silos'
            }}</span>
          </div>
        </div>

        <div class="flex flex-col items-end">
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1"
            >Offline Time</span
          >
          <span class="text-sm font-mono-premium font-black text-slate-900">{{ formattedAwayTime }}</span>
        </div>
      </div>

      <div v-else class="text-[11px] text-slate-400 italic font-medium">
        No silos purchased in this {{ hideHeader ? 'date range' : 'shift' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Action } from '@/types';
import { formatNumber } from '@/lib/format';

const props = defineProps<{
  headerAction: Action;
  actions: Action[];
  compact?: boolean;
  hideHeader?: boolean;
}>();

const finalState = computed(() => {
  if (props.actions.length > 0) {
    return props.actions[props.actions.length - 1].endState;
  }
  return props.headerAction.endState;
});

const activeArtifactSet = computed(() => finalState.value.activeArtifactSet);
const hourlyOfflineEarnings = computed(() => finalState.value.offlineEarnings * 3600);
const hourlyELR = computed(() => finalState.value.elr * 3600);

const silosPurchased = computed(() => {
  return props.actions.filter(a => a.type === 'buy_silo').length;
});

const finalAwayTimeMinutes = computed(() => {
  if (props.actions.length > 0) {
    return props.actions[props.actions.length - 1].endState.siloTimeMinutes;
  }
  return props.headerAction.endState.siloTimeMinutes;
});

const formattedAwayTime = computed(() => {
  const minutes = finalAwayTimeMinutes.value;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
});
</script>
