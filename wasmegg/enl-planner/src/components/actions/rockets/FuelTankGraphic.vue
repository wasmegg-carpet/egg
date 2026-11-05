<template>
  <div class="bg-gray-50 rounded-lg p-4">
    <div class="flex justify-between items-center mb-3">
      <span class="text-sm font-medium text-gray-700">Fuel Tank Lv.{{ tankLevel }}</span>
      <span class="text-sm font-mono text-gray-600">
        {{ formatNumber(totalRemaining, 1) }} / {{ formatNumber(capacity, 1) }}
      </span>
    </div>

    <!-- Egg bars -->
    <div class="space-y-2">
      <div v-for="egg in visibleEggs" :key="egg" class="flex items-center gap-2">
        <div class="w-5 h-5 flex-shrink-0">
          <img :src="iconURL(`egginc/egg_${egg}.png`, 64)" class="w-full h-full object-contain" :alt="egg" />
        </div>
        <div class="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
          <div
            class="h-full bg-blue-500 rounded-full transition-all duration-300 ease-in-out"
            :style="{ width: `${barPercent(egg)}%` }"
          />
        </div>
        <span class="text-xs font-mono text-gray-600 w-16 text-right">
          {{ formatNumber(remaining[egg], 1) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { iconURL } from 'lib';
import type { VirtueEgg } from '@/types';
import { VIRTUE_EGGS } from '@/types';
import { formatNumber } from '@/lib/format';

const props = defineProps<{
  fuelAmounts: Record<VirtueEgg, number>;
  committed: Record<VirtueEgg, number>;
  capacity: number;
  tankLevel: number;
}>();

const remaining = computed<Record<VirtueEgg, number>>(() => {
  const r: Record<string, number> = {};
  for (const egg of VIRTUE_EGGS) {
    r[egg] = Math.max(0, props.fuelAmounts[egg] - props.committed[egg]);
  }
  return r as Record<VirtueEgg, number>;
});

const totalRemaining = computed(() => VIRTUE_EGGS.reduce((sum, egg) => sum + remaining.value[egg], 0));

/** Only show eggs that have a non-zero amount in the tank. */
const visibleEggs = computed(() => VIRTUE_EGGS.filter(egg => props.fuelAmounts[egg] > 0));

function barPercent(egg: VirtueEgg): number {
  if (props.capacity <= 0) return 0;
  return Math.min(100, (remaining.value[egg] / props.capacity) * 100);
}
</script>
