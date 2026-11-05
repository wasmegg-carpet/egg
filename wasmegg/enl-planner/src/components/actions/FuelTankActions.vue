<template>
  <div class="space-y-4">
    <p class="text-xs font-medium text-slate-500 mb-4 px-1 italic">Store eggs in your fuel tank for space missions.</p>

    <!-- Current Tank State -->
    <div class="section-premium p-5">
      <div class="flex justify-between items-end mb-4">
        <div>
          <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tank Capacity</div>
          <div class="text-xl font-bold text-slate-800 tracking-tight">
            {{ formatNumber(fuelTankStore.totalFuel, 1) }} <span class="text-slate-300 font-normal">/</span>
            {{ formatNumber(fuelTankStore.tankCapacity, 1) }}
          </div>
        </div>
        <div class="badge-premium badge-brand py-0.5">{{ fuelTankStore.fillPercent.toFixed(1) }}%</div>
      </div>

      <!-- Capacity Bar -->
      <div
        class="h-3.5 bg-slate-100 shadow-inner rounded-full overflow-hidden mb-6 border border-slate-200/50 relative"
      >
        <div
          class="h-full transition-all duration-1000 ease-out relative"
          :class="
            fuelTankStore.fillPercent > 90 ? 'bg-danger' : fuelTankStore.fillPercent > 70 ? 'bg-warning' : 'bg-success'
          "
          :style="{ width: `${fuelTankStore.fillPercent}%` }"
        >
          <div class="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent"></div>
          <div class="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent"></div>
        </div>
      </div>

      <!-- Per-Egg Breakdown -->
      <div class="space-y-2">
        <div
          v-for="egg in VIRTUE_FUEL_ORDER"
          :key="egg"
          class="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors group"
        >
          <div
            class="w-8 h-8 flex-shrink-0 bg-white rounded-lg shadow-sm border border-slate-100 p-1 group-hover:scale-110 transition-transform"
          >
            <img :src="iconURL(`egginc/egg_${egg}.png`, 64)" class="w-full h-full object-contain" :alt="egg" />
          </div>
          <span class="text-xs font-bold text-slate-600 uppercase tracking-tight">{{ VIRTUE_EGG_NAMES[egg] }}</span>
          <div class="flex-1 flex flex-col items-end">
            <div class="flex items-center gap-1.5">
              <svg
                v-if="getRoundingShortfall(fuelTankStore.fuelAmounts[egg]) > 0"
                v-tippy="'Rounding is likely to cause a problem for you, since you are below the displayed number of eggs.'"
                class="w-4 h-4 text-warning"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span class="text-sm font-mono-premium font-bold text-slate-700 tracking-tight">
                {{ formatNumber(fuelTankStore.fuelAmounts[egg], 1) }}
              </span>
            </div>
            <div v-if="getRoundingShortfall(fuelTankStore.fuelAmounts[egg]) > 0" class="text-[9px] text-danger font-bold uppercase tracking-widest mt-0.5">
              You're short by {{ formatFullNumber(getRoundingShortfall(fuelTankStore.fuelAmounts[egg])) }} eggs
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Store Fuel Section -->
    <div class="section-premium p-5">
      <div class="flex items-center gap-3 mb-5">
        <div class="w-10 h-10 flex-shrink-0 bg-slate-50 rounded-xl p-1.5 border border-slate-100 shadow-inner">
          <img
            :src="iconURL(`egginc/egg_${virtueStore.currentEgg}.png`, 64)"
            class="w-full h-full object-contain drop-shadow-sm"
            :alt="virtueStore.currentEgg"
          />
        </div>
        <div>
          <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Store Eggs in Tank</div>
          <div class="text-sm font-bold text-slate-700">Store {{ VIRTUE_EGG_NAMES[virtueStore.currentEgg] }} Eggs</div>
        </div>
      </div>

      <!-- Store Mode Toggle -->
      <div class="flex gap-1 mb-3 bg-slate-100 rounded-lg p-0.5">
        <button
          class="flex-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md transition-all"
          :class="storeMode === 'fillTo' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
          @click="storeMode = 'fillTo'"
        >
          Fill To Target
        </button>
        <button
          class="flex-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md transition-all"
          :class="storeMode === 'add' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
          @click="storeMode = 'add'"
        >
          Add Amount
        </button>
      </div>

      <!-- Fuel Speed Selector -->
      <div class="mb-3">
        <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Fuel Speed</div>
        <div class="flex gap-1 bg-slate-100 rounded-lg p-0.5">
          <button
            v-for="speed in FUEL_SPEED_OPTIONS"
            :key="speed.value"
            class="flex-1 px-2 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md transition-all"
            :class="fuelSpeed === speed.value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
            @click="fuelSpeed = speed.value"
          >
            {{ speed.label }}
          </button>
        </div>
      </div>

      <div class="flex items-center gap-2 mb-4">
        <input
          v-model="amountInput"
          type="text"
          :placeholder="storeMode === 'fillTo' ? 'Target total, e.g., 10T' : 'e.g., 50B, 100T'"
          class="input-premium flex-1 font-mono-premium font-bold py-2.5"
          @keyup.enter="handleStoreFuel"
        />
        <button class="btn-premium btn-primary px-6 py-2.5" :disabled="!canStore" @click="handleStoreFuel">
          Store
        </button>
      </div>

      <!-- Time Estimate -->
      <div v-if="parsedAmount > 0" class="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
        <!-- Fill To mode: show current → target → delta -->
        <div v-if="storeMode === 'fillTo'" class="space-y-2">
          <div class="flex justify-between items-center">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Currently</span>
            <span class="text-sm font-mono-premium font-bold text-slate-500">{{ formatNumber(currentEggFuel, 1) }}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Target</span>
            <span class="text-sm font-mono-premium font-bold text-slate-700">{{ formatNumber(parsedAmount, 1) }}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Storing</span>
            <span class="text-sm font-mono-premium font-bold" :class="fillDelta > 0 ? 'text-brand-primary' : 'text-slate-400'">{{ fillDelta > 0 ? formatNumber(fillDelta, 1) : 'Already at target' }}</span>
          </div>
        </div>
        <!-- Add mode: show target -->
        <div v-else class="flex justify-between items-center">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Target</span>
          <span class="text-sm font-mono-premium font-bold text-slate-700">{{ formatNumber(parsedAmount, 1) }}</span>
        </div>
        <div v-if="effectiveStoreAmount > 0" class="flex justify-between items-center">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Transit Time</span>
          <span class="text-sm font-mono-premium font-bold text-slate-900">{{
            formatDuration(timeToStoreSeconds)
          }}</span>
        </div>
        <!-- Variable-speed estimates -->
        <template v-if="fuelSpeed < 1.0 && effectiveStoreAmount > 0">
          <div class="flex justify-between items-center">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Eggs Shipped</span>
            <span class="text-sm font-mono-premium font-bold text-emerald-600">{{ formatNumber(estimatedEggsShipped, 1) }}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Gems Earned</span>
            <span class="text-sm font-mono-premium font-bold text-emerald-600">+{{ formatNumber(estimatedGemsEarned, 1) }}</span>
          </div>
        </template>
        <div
          v-if="exceedsCapacity"
          class="flex items-center gap-2 text-red-500 text-[10px] font-bold mt-1 bg-red-50 p-2 rounded-lg border border-red-100"
        >
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clip-rule="evenodd"
            ></path>
          </svg>
          <span>Exceeds capacity by {{ formatNumber(effectiveStoreAmount - fuelTankStore.availableCapacity, 1) }}</span>
        </div>
      </div>
    </div>

    <!-- Remove Fuel Section -->
    <div class="section-premium p-5">
      <div class="mb-5">
        <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tank Maintenance</div>
        <div class="text-sm font-bold text-slate-700">Remove Fuel Storage</div>
      </div>

      <!-- Remove Mode Toggle -->
      <div class="flex gap-1 mb-4 bg-slate-100 rounded-lg p-0.5">
        <button
          class="flex-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md transition-all"
          :class="removeMode === 'drainTo' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
          @click="removeMode = 'drainTo'"
        >
          Drain To Target
        </button>
        <button
          class="flex-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md transition-all"
          :class="removeMode === 'remove' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
          @click="removeMode = 'remove'"
        >
          Remove Amount
        </button>
      </div>

      <div class="space-y-4">
        <div v-for="egg in VIRTUE_FUEL_ORDER" :key="egg" class="space-y-2">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 flex-shrink-0 bg-slate-50 rounded-lg p-1 border border-slate-100 shadow-inner">
              <img
                :src="iconURL(`egginc/egg_${egg}.png`, 64)"
                class="w-full h-full object-contain drop-shadow-sm"
                :alt="egg"
              />
            </div>
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest w-16">{{
              VIRTUE_EGG_NAMES[egg]
            }}</span>

            <input
              v-model="removeInputs[egg]"
              type="text"
              :placeholder="removeMode === 'drainTo' ? 'Target remaining' : 'Amount'"
              class="input-premium flex-1 font-mono-premium py-2 text-xs font-bold"
              @keyup.enter="handleRemoveFuel(egg)"
            />

            <button
              class="btn-premium btn-primary px-4 py-2 text-[10px] uppercase font-black tracking-widest"
              :disabled="!canRemove(egg)"
              @click="handleRemoveFuel(egg)"
            >
              Remove
            </button>
          </div>
          <!-- Drain To info line -->
          <div
            v-if="removeMode === 'drainTo' && parsedRemoveAmount(egg) > 0 && fuelTankStore.fuelAmounts[egg] > 0"
            class="ml-10 p-2 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between text-[10px]"
          >
            <div class="flex items-center gap-3">
              <span class="font-black text-slate-400 uppercase tracking-widest">{{ formatNumber(fuelTankStore.fuelAmounts[egg], 1) }}</span>
              <span class="text-slate-300">→</span>
              <span class="font-black text-slate-400 uppercase tracking-widest">{{ formatNumber(parsedRemoveAmount(egg), 1) }}</span>
            </div>
            <span
              class="font-mono-premium font-bold"
              :class="drainDelta(egg) > 0 ? 'text-brand-primary' : 'text-slate-400'"
            >
              {{ drainDelta(egg) > 0 ? `Removing ${formatNumber(drainDelta(egg), 1)}` : 'Already at target' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tank Level Info -->
    <div class="bg-slate-50/80 rounded-2xl p-4 border border-slate-100 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm border border-slate-100">
          <svg class="w-4 h-4 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            ></path>
          </svg>
        </div>
        <div>
          <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Tier</div>
          <div class="text-sm font-bold text-slate-700">Level {{ fuelTankStore.tankLevel }}/7</div>
        </div>
      </div>
      <div class="text-right">
        <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Capacity</div>
        <div class="text-sm font-mono-premium font-bold text-slate-900">
          {{ formatNumber(fuelTankStore.tankCapacity, 1) }}
        </div>
      </div>
    </div>

    <p class="text-[10px] text-slate-400 text-center uppercase font-black tracking-widest opacity-60">
      Production rate calibrated to maximum habitat scale
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { iconURL } from 'lib';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useVirtueStore } from '@/stores/virtue';
import { useActionsStore } from '@/stores/actions';
import { useTruthEggsStore } from '@/stores/truthEggs';
import { computeDependencies } from '@/lib/actions/executor';
import { formatNumber, formatDuration, parseNumber, formatFullNumber } from '@/lib/format';
import { generateActionId, VIRTUE_EGG_NAMES, type VirtueEgg } from '@/types';
import { VIRTUE_FUEL_ORDER } from '@/stores/fuelTank';
import { useActionExecutor } from '@/composables/useActionExecutor';

import { useLayRate } from '@/composables/useLayRate';
import { useInternalHatcheryRate } from '@/composables/useInternalHatcheryRate';
import { useHabCapacity } from '@/composables/useHabCapacity';
import { useShippingCapacity } from '@/composables/useShippingCapacity';
import { solveForTime, integrateRate } from '@/engine/apply/math';

const fuelTankStore = useFuelTankStore();
const truthEggsStore = useTruthEggsStore();
const virtueStore = useVirtueStore();
const actionsStore = useActionsStore();
const { output: layRateOutput } = useLayRate();
const { output: ihrOutput } = useInternalHatcheryRate();
const { output: habCapacityOutput } = useHabCapacity();
const { output: shippingOutput } = useShippingCapacity();
const { prepareExecution, completeExecution } = useActionExecutor();

const FUEL_SPEED_OPTIONS = [
  { label: '10%', value: 0.1 },
  { label: '50%', value: 0.5 },
  { label: '90%', value: 0.9 },
  { label: '100%', value: 1.0 },
] as const;

const storeMode = ref<'add' | 'fillTo'>('fillTo');
const removeMode = ref<'remove' | 'drainTo'>('drainTo');
const fuelSpeed = ref(1.0);
const amountInput = ref('');
const removeInputs = ref<Record<string, string>>({
  curiosity: '',
  integrity: '',
  humility: '',
  resilience: '',
  kindness: '',
});

// Parse input amount
const parsedAmount = computed(() => {
  if (!amountInput.value.trim()) return 0;
  const parsed = parseNumber(amountInput.value);
  return isNaN(parsed) ? 0 : parsed;
});

// Calculate rounding shortfall
function getRoundingShortfall(actual: number): number {
  if (!actual || actual <= 0) return 0;
  const formatted = formatNumber(actual, 1);
  const parsed = parseNumber(formatted);
  if (parsed > actual) {
    const diff = parsed - actual;
    if (diff < 100) {
      return Math.round(diff);
    }
  }
  return 0;
}

// Fill To mode: current fuel for the active egg and the delta needed
const currentEggFuel = computed(() => fuelTankStore.fuelAmounts[virtueStore.currentEgg] || 0);
const fillDelta = computed(() => Math.max(0, parsedAmount.value - currentEggFuel.value));

// The actual amount to store: in Fill To mode it's the delta, in Add mode it's the raw input
const effectiveStoreAmount = computed(() => {
  if (storeMode.value === 'fillTo') return fillDelta.value;
  return parsedAmount.value;
});

// Time calculation (scaled by fuel speed)
const timeToStoreSeconds = computed(() => {
  if (effectiveStoreAmount.value <= 0) return 0;
  const P0 = virtueStore.population;
  const I = ihrOutput.value.offlineRate / 60; // chickens/sec
  const R = layRateOutput.value.ratePerChickenPerSecond * fuelSpeed.value; // scaled by speed
  const H = habCapacityOutput.value.totalFinalCapacity; // max chickens

  const maxPossibleRate = R * H;

  const time = solveForTime(effectiveStoreAmount.value, P0, I, R, maxPossibleRate);
  return isFinite(time) ? time : Infinity;
});

// Variable-speed estimates for the UI preview
const estimatedEggsShipped = computed(() => {
  if (fuelSpeed.value >= 1.0 || timeToStoreSeconds.value <= 0) return 0;
  const P0 = virtueStore.population;
  const I = ihrOutput.value.offlineRate / 60;
  const remainingR = layRateOutput.value.ratePerChickenPerSecond * (1 - fuelSpeed.value);
  const S = shippingOutput.value.totalFinalCapacity; // eggs/sec shipping cap
  const H = habCapacityOutput.value.totalFinalCapacity;
  return integrateRate(timeToStoreSeconds.value, P0, I, remainingR, S, H);
});

const estimatedGemsEarned = computed(() => {
  if (estimatedEggsShipped.value <= 0) return 0;
  const snapshot = actionsStore.effectiveSnapshot;
  const valuePerEgg = snapshot.elr > 0 ? snapshot.offlineEarnings / snapshot.elr : 0;
  return estimatedEggsShipped.value * valuePerEgg;
});

// Validation
const exceedsCapacity = computed(() => effectiveStoreAmount.value > fuelTankStore.availableCapacity);
const canStore = computed(() => effectiveStoreAmount.value > 0 && !exceedsCapacity.value && isFinite(timeToStoreSeconds.value));

// Parse a per-egg remove input
function parsedRemoveAmount(egg: VirtueEgg): number {
  const input = removeInputs.value[egg];
  if (!input || !input.trim()) return 0;
  const parsed = parseNumber(input);
  return isNaN(parsed) ? 0 : parsed;
}

// Drain To mode: compute how much to remove to reach target remaining
function drainDelta(egg: VirtueEgg): number {
  return Math.max(0, fuelTankStore.fuelAmounts[egg] - parsedRemoveAmount(egg));
}

// The effective amount to remove for a given egg
function effectiveRemoveAmount(egg: VirtueEgg): number {
  if (removeMode.value === 'drainTo') return drainDelta(egg);
  return parsedRemoveAmount(egg);
}

function canRemove(egg: VirtueEgg) {
  const amount = effectiveRemoveAmount(egg);
  return amount > 0 && fuelTankStore.fuelAmounts[egg] > 0;
}

function handleStoreFuel() {
  if (!canStore.value) return;

  // Prepare execution (restores stores if editing past group)
  const beforeSnapshot = prepareExecution();

  const payload = {
    egg: beforeSnapshot.currentEgg,
    amount: effectiveStoreAmount.value,
    timeSeconds: timeToStoreSeconds.value,
    fuelSpeed: fuelSpeed.value,
    eggsShippedDuringFuel: estimatedEggsShipped.value,
    gemsEarnedDuringFuel: estimatedGemsEarned.value,
  };

  const dependencies = computeDependencies(
    'store_fuel',
    payload,
    actionsStore.actionsBeforeInsertion,
    actionsStore.initialSnapshot.researchLevels
  );

  // Apply to store
  fuelTankStore.addFuel(payload.egg, payload.amount);

  // Complete execution
  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'store_fuel',
      payload,
      cost: 0, // Free action
      dependsOn: dependencies,
    },
    beforeSnapshot
  );

  // Clear input
  amountInput.value = '';
}

async function handleRemoveFuel(egg: VirtueEgg) {
  if (!canRemove(egg)) return;

  // Compute actual amount to remove
  let actualToRemove = effectiveRemoveAmount(egg);

  // Cap at current amount
  const currentAmount = fuelTankStore.fuelAmounts[egg];
  if (actualToRemove > currentAmount) {
    actualToRemove = currentAmount;
  }

  if (actualToRemove <= 0) return;

  const beforeSnapshot = prepareExecution();

  const payload = {
    egg,
    amount: actualToRemove,
  };

  const dependencies = computeDependencies(
    'remove_fuel',
    payload,
    actionsStore.actionsBeforeInsertion,
    actionsStore.initialSnapshot.researchLevels
  );

  // Apply to store
  fuelTankStore.removeFuel(egg, actualToRemove);

  // Complete execution
  await completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'remove_fuel',
      payload,
      cost: 0,
      dependsOn: dependencies,
    },
    beforeSnapshot
  );

  removeInputs.value[egg] = '';
}
</script>
