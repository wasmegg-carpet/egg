<template>
  <div class="space-y-6">
    <!-- Capacity Bar -->
    <div class="space-y-2 p-4 bg-slate-50/50 rounded-2xl border border-slate-100">
      <div class="flex justify-between items-end mb-1">
        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Utilization</span>
        <span class="text-xs font-bold text-slate-700 font-mono-premium">
          {{ formatNumber(totalFuel, 1) }} <span class="opacity-40">/</span> {{ formatNumber(capacity, 1) }}
          <span class="opacity-40">·</span> {{ fillPercent.toFixed(1) }}%
        </span>
      </div>
      <div class="h-3 bg-white shadow-inner rounded-full overflow-hidden border border-slate-100">
        <div
          class="h-full transition-all duration-700 ease-out relative"
          :class="fillPercent > 90 ? 'bg-danger' : fillPercent > 70 ? 'bg-warning' : 'bg-success'"
          :style="{ width: `${fillPercent}%` }"
        >
          <div class="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent"></div>
        </div>
      </div>
    </div>

    <!-- Per-Egg Fuel Amounts -->
    <div class="space-y-3">
      <h4 class="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Stored Inventory</h4>
      <div class="grid grid-cols-1 gap-2">
        <div
          v-for="egg in eggs"
          :key="egg"
          class="flex items-center gap-4 p-3 bg-white hover:bg-slate-50 border border-slate-50 rounded-2xl transition-all group"
        >
          <div
            class="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center p-1.5 group-hover:bg-white group-hover:shadow-sm transition-all"
          >
            <img
              :src="iconURL(PROFILE.fuelEggIconPath(egg), 64)"
              class="w-full h-full object-contain drop-shadow-sm"
              :alt="egg"
            />
          </div>
          <div class="flex-1">
            <div class="text-xs font-bold text-slate-700 uppercase tracking-tight">{{ FUEL_EGG_NAMES[egg] }}</div>
          </div>
          <div class="flex flex-col items-end">
            <div class="flex items-center gap-2">
              <svg
                v-if="getRoundingShortfall(fuelAmounts[egg]) > 0"
                v-tippy="'Rounding is likely to cause a problem for you, since you are below the displayed number of eggs.'"
                class="w-4 h-4 text-warning"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <input
                v-if="editable"
                type="text"
                :value="formatNumber(fuelAmounts[egg], 1)"
                class="input-premium w-40 text-right text-sm font-mono-premium font-bold text-slate-900"
                placeholder="0"
                @blur="handleFuelAmountChange(egg, ($event.target as HTMLInputElement).value)"
                @keydown.enter="($event.target as HTMLInputElement).blur()"
              />
              <span v-else class="text-sm font-mono-premium font-bold text-slate-700 tracking-tight">
                {{ formatNumber(fuelAmounts[egg], 1) }}
              </span>
            </div>
            <div
              v-if="getRoundingShortfall(fuelAmounts[egg]) > 0"
              class="text-[9px] text-danger font-bold uppercase tracking-widest mt-1"
            >
              You're short by {{ formatFullNumber(getRoundingShortfall(fuelAmounts[egg])) }} eggs
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { iconURL } from 'lib';
import { PROFILE } from '@planner/lib/profile';
import { FUEL_EGG_NAMES, type FuelEgg } from '@planner/types';
import { formatNumber, parseNumber, formatFullNumber } from '@planner/lib/format';

const props = defineProps<{
  eggs: FuelEgg[];
  fuelAmounts: Record<FuelEgg, number>;
  capacity: number;
  /** Whether each egg's amount can be typed in, rather than only shown. */
  editable?: boolean;
}>();

const emit = defineEmits<{
  'set-fuel-amount': [egg: FuelEgg, amount: number];
}>();

const totalFuel = computed(() => Object.values(props.fuelAmounts).reduce((sum, amt) => sum + amt, 0));

const fillPercent = computed(() => {
  if (props.capacity === 0) return 0;
  return Math.min(100, (totalFuel.value / props.capacity) * 100);
});

function handleFuelAmountChange(egg: FuelEgg, inputValue: string) {
  const parsed = parseNumber(inputValue);
  if (parsed !== null && !isNaN(parsed)) {
    emit('set-fuel-amount', egg, parsed);
  }
}

// How far below the displayed (rounded up) number the real amount is, when that's only a few eggs.
function getRoundingShortfall(actual: number): number {
  if (!actual || actual <= 0) return 0;
  const parsed = parseNumber(formatNumber(actual, 1));
  if (parsed > actual) {
    const diff = parsed - actual;
    if (diff < 100) {
      return Math.round(diff);
    }
  }
  return 0;
}
</script>
