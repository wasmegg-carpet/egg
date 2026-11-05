<template>
  <div class="bg-slate-50/30 border-t border-slate-100/50" :class="compact ? 'px-3 py-2' : 'px-5 py-4'">
    <div class="flex flex-wrap items-center justify-between" :class="compact ? 'gap-2' : 'gap-4'">
      <!-- Label -->
      <div v-if="!hideHeader" class="flex items-center gap-3">
        <div
          class="w-5 h-5 rounded-lg bg-pink-50 border border-pink-100 shadow-sm flex items-center justify-center p-1"
        >
          <svg class="w-full h-full text-pink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </div>
        <span class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Kindness Summary</span>
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
      <div class="flex flex-wrap items-center" :class="compact ? 'gap-x-3 gap-y-1' : 'gap-x-6 gap-y-2'">
        <div class="flex flex-col items-end">
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Fleet</span>
          <div class="flex items-center gap-1.5">
            <template v-if="isMaxed">
              <span
                class="badge-premium bg-pink-50 text-pink-600 border-pink-100 py-0.5 px-2 text-[9px] font-black uppercase tracking-tight"
                >Full Hyperloop</span
              >
            </template>
            <template v-else>
              <span class="text-[11px] font-bold text-slate-700 tracking-tight leading-none">{{
                vehicleSummaryText
              }}</span>
            </template>
          </div>
        </div>

        <div class="flex flex-col items-end">
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1"
            >Shipping Cap</span
          >
          <span class="text-sm font-mono-premium font-black text-slate-900">{{ formattedShippingCap }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Action, CalculationsSnapshot } from '@/types';
import { calculateMaxVehicleSlots, calculateMaxTrainLength } from '@/calculations/shippingCapacity';
import { getVehicleType } from '@/lib/vehicles';
import { formatNumber } from '@/lib/format';

const props = defineProps<{
  headerAction: Action;
  actions: Action[];
  compact?: boolean;
  hideHeader?: boolean;
}>();

const finalState = computed<CalculationsSnapshot>(() => {
  if (props.actions.length > 0) {
    return props.actions[props.actions.length - 1].endState;
  }
  return props.headerAction.endState;
});

const activeArtifactSet = computed(() => finalState.value.activeArtifactSet);
const hourlyOfflineEarnings = computed(() => finalState.value.offlineEarnings * 3600);
const hourlyELR = computed(() => finalState.value.elr * 3600);

const isMaxed = computed(() => {
  const { vehicles, researchLevels } = finalState.value;
  const maxSlots = calculateMaxVehicleSlots(researchLevels);
  const maxTrainLength = calculateMaxTrainLength(researchLevels);

  // Check if we have max slots filled
  const activeVehicles = (vehicles || []).slice(0, maxSlots);
  const filledCount = activeVehicles.filter(v => v.vehicleId !== null).length;

  if (filledCount < maxSlots) return false;

  // Check if all are hyperloops with max cars
  return activeVehicles.every(v => v.vehicleId === 11 && v.trainLength >= maxTrainLength);
});

const vehicleSummaryText = computed(() => {
  const { vehicles, researchLevels } = finalState.value;
  const maxSlots = calculateMaxVehicleSlots(researchLevels);
  // Only consider slots that are available with current research
  const activeVehicles = (vehicles || []).slice(0, maxSlots).filter(v => v.vehicleId !== null);

  if (activeVehicles.length === 0) return 'No vehicles';

  const counts = new Map<string, number>();

  for (const v of activeVehicles) {
    const type = getVehicleType(v.vehicleId!);
    if (type) {
      const count = counts.get(type.name) || 0;
      counts.set(type.name, count + 1);
    }
  }

  // Sort by count descending
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  return sorted.map(([name, count]) => `${count}x ${name}`).join(', ');
});

const formattedShippingCap = computed(() => {
  return formatNumber(finalState.value.shippingCapacity);
});
</script>
