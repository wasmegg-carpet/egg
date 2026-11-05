<template>
  <div class="bg-slate-50/30 border-t border-slate-100/50" :class="compact ? 'px-3 py-2' : 'px-5 py-4'">
    <div class="flex flex-wrap items-center justify-between" :class="compact ? 'gap-2' : 'gap-4'">
      <!-- Label and TE Badge -->
      <div v-if="!hideHeader" class="flex items-center gap-3">
        <div
          class="w-5 h-5 rounded-lg bg-indigo-50 border border-indigo-100 shadow-sm flex items-center justify-center p-1"
        >
          <svg class="w-full h-full text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
        </div>
        <span class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Integrity Summary</span>
        <div v-if="activeArtifactSet === 'earnings'" class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200/50">
          <span class="text-[9px] font-black font-mono-premium text-slate-700">{{ formatNumber(hourlyOfflineEarnings, 3) }}</span>
          <span class="text-[8px] font-black uppercase tracking-widest text-slate-400">/hr</span>
        </div>
        <div v-else-if="activeArtifactSet === 'elr'" class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200/50">
          <span class="text-[9px] font-black font-mono-premium text-slate-700">{{ formatNumber(hourlyELR, 3) }}</span>
          <span class="text-[8px] font-black uppercase tracking-widest text-slate-400">/hr</span>
        </div>
        <div
          v-if="teGained > 0"
          class="badge-premium bg-indigo-100 text-indigo-700 border-indigo-200/50 flex items-center gap-1 py-0.5 px-2 text-[10px]"
          v-tippy="'Truth Eggs gained in this period'"
        >
          <span class="font-black">+{{ teGained }}</span>
          <img :src="iconURL('egginc/egg_truth.png', 32)" class="w-3 h-3 object-contain" alt="TE" />
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="flex flex-wrap items-center" :class="compact ? 'gap-x-3 gap-y-1' : 'gap-x-6 gap-y-2'">
        <div class="flex flex-col items-end">
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Habs</span>
          <div class="flex items-center gap-1.5">
            <template v-if="isMaxHabs">
              <span
                class="badge-premium bg-indigo-50 text-indigo-600 border-indigo-100 py-0.5 px-2 text-[9px] font-black uppercase tracking-tight"
                >Max Universes</span
              >
            </template>
            <template v-else>
              <span class="text-[11px] font-bold text-slate-700 tracking-tight leading-none">{{ habSummaryText }}</span>
            </template>
          </div>
        </div>

        <div class="flex flex-col items-end">
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Hab Cap</span>
          <span class="text-sm font-mono-premium font-black text-slate-900">{{ formattedHabCap }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { iconURL } from 'lib';
import type { Action, WaitForTEPayload } from '@/types';
import { getHabById, type HabId } from '@/lib/habs';
import { formatNumber } from '@/lib/format';

const props = defineProps<{
  headerAction: Action;
  actions: Action[];
  compact?: boolean;
  hideHeader?: boolean;
}>();

/**
 * Get the final state.
 */
const finalState = computed(() => {
  if (props.actions.length > 0) {
    return props.actions[props.actions.length - 1].endState;
  }
  return props.headerAction.endState;
});

const activeArtifactSet = computed(() => finalState.value.activeArtifactSet);
const hourlyOfflineEarnings = computed(() => finalState.value.offlineEarnings * 3600);
const hourlyELR = computed(() => finalState.value.elr * 3600);

/**
 * Check if we have 4 Chicken Universes (ID 18).
 */
const isMaxHabs = computed(() => {
  if (!finalState.value) return false;
  const habIds = finalState.value.habIds;
  return habIds.filter(id => id === 18).length === 4;
});

/**
 * Grouped hab names summary or "No habs".
 */
const habSummaryText = computed(() => {
  if (!finalState.value) return 'No habs';
  const habIds = finalState.value.habIds;
  const activeHabs = habIds.filter((id): id is number => id !== null);

  if (activeHabs.length === 0) return 'No habs';

  const counts = new Map<string, number>();

  for (const id of activeHabs) {
    const hab = getHabById(id as HabId);
    if (hab) {
      const count = counts.get(hab.name) || 0;
      counts.set(hab.name, count + 1);
    }
  }

  // Sort by count descending
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  return sorted.map(([name, count]) => `${count}x ${name}`).join(', ');
});

/**
 * Formatted hab capacity.
 */
const formattedHabCap = computed(() => {
  return formatNumber(finalState.value?.habCapacity ?? 0, 3);
});

/**
 * Calculate total TE gained from wait_for_te actions in this period.
 */
const teGained = computed(() => {
  return props.actions
    .filter(a => a.type === 'wait_for_te')
    .reduce((sum, a) => sum + (a.payload as WaitForTEPayload).teGained, 0);
});
</script>
