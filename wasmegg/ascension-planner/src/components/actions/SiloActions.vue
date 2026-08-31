<template>
  <div class="space-y-6">
    <!-- Current State -->
    <div class="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
      <div class="flex justify-between items-center mb-5">
        <h4 class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Silos Owned</h4>
        <div class="badge-premium bg-slate-50 text-slate-600 border-slate-100 px-3 py-1 flex items-center gap-1.5">
          <span class="text-[10px] font-black opacity-60 uppercase tracking-widest">Active:</span>
          <span class="text-sm font-mono-premium font-black text-slate-900"
            >{{ siloOutput.siloCount }}/{{ siloOutput.maxSilos }}</span
          >
        </div>
      </div>

      <!-- Silo Visual Grid -->
      <div class="grid grid-cols-5 gap-3 mb-6">
        <div
          v-for="index in siloOutput.maxSilos"
          :key="index"
          class="relative rounded-xl h-14 flex items-center justify-center transition-all duration-300 border shadow-sm group overflow-hidden"
          :class="
            index <= siloOutput.siloCount
              ? 'border-indigo-100 bg-gradient-to-br from-indigo-50 to-white'
              : 'border-dashed border-slate-200 bg-slate-50/50 grayscale'
          "
        >
          <!-- Active Glow -->
          <div
            v-if="index <= siloOutput.siloCount"
            class="absolute inset-0 bg-indigo-500/5 animate-pulse opacity-0 group-hover:opacity-100 transition-opacity"
          ></div>

          <img
            v-if="index <= siloOutput.siloCount"
            :src="iconURL('egginc-extras/silo.png', 64)"
            class="w-7 h-7 object-contain relative z-10 drop-shadow-sm group-hover:scale-110 transition-transform"
            alt="silo"
          />
          <div v-else class="w-1.5 h-1.5 rounded-full bg-slate-300"></div>

          <span class="absolute bottom-1 right-1.5 text-[8px] font-black text-slate-300 uppercase">#{{ index }}</span>
        </div>
      </div>

      <!-- Buy Silo Section (Moved here) -->
      <div class="mb-6">
        <div v-if="siloOutput.canBuyMore">
          <div :class="maxSilosIn1Hour.count > 0 ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''">
            <button
              class="group relative flex flex-col items-center justify-center gap-2 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm transition-all duration-300 hover:border-indigo-300 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] overflow-hidden"
              @click="handleBuySilo"
            >
              <div class="absolute inset-0 bg-indigo-500/0 group-hover:bg-indigo-500/[0.02] transition-colors"></div>
              <div
                class="rounded-xl bg-indigo-50 border border-indigo-100 p-2 transition-colors group-hover:bg-white group-hover:scale-110 shadow-sm relative z-10"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4 text-indigo-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </div>
              <div class="flex flex-col items-center relative z-10">
                <span class="text-[11px] font-black uppercase tracking-widest text-slate-900 group-hover:text-indigo-700"
                  >Buy Silo #{{ siloOutput.siloCount + 1 }}</span
                >
                <span class="text-[9px] font-mono-premium font-black text-indigo-500 mt-0.5">
                  {{ formatGemPrice(siloOutput.nextSiloCost) }} gems<template v-if="timeToBuy">
                    · Ready in {{ timeToBuy }}</template
                  >
                </span>
              </div>
            </button>

            <button
              v-if="maxSilosIn1Hour.count > 0"
              class="group relative flex flex-col items-center justify-center gap-2 rounded-2xl border border-violet-100 bg-white p-4 shadow-sm transition-all duration-300 hover:border-violet-300 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] overflow-hidden"
              @click="handleBuyMaxSilos1Hour"
            >
              <div class="absolute inset-0 bg-violet-500/0 group-hover:bg-violet-500/[0.02] transition-colors"></div>
              <div
                class="rounded-xl bg-violet-50 border border-violet-100 p-2 transition-colors group-hover:bg-white group-hover:scale-110 shadow-sm relative z-10"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4 text-violet-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </div>
              <div class="flex flex-col items-center relative z-10">
                <span class="text-[11px] font-black uppercase tracking-widest text-slate-900 group-hover:text-violet-700"
                  >1-Hr Max</span
                >
                <span class="text-[9px] font-mono-premium font-black text-violet-500 mt-0.5">
                  {{ maxSilosIn1Hour.count }} new silo{{ maxSilosIn1Hour.count !== 1 ? 's' : '' }} ·
                  {{ formatDuration(maxSilosIn1Hour.seconds) }}
                </span>
              </div>
            </button>
          </div>
        </div>
        <div
          v-else
          class="flex flex-col items-center py-4 bg-emerald-50/50 rounded-2xl border border-emerald-100 border-dashed text-emerald-700/80"
        >
          <p class="text-[10px] font-black uppercase tracking-widest">Maximum silos reached (10/10)</p>
        </div>
      </div>

      <!-- Total Away Time -->
      <div
        class="bg-slate-50/50 border border-slate-100/50 rounded-2xl p-6 text-center relative overflow-hidden shadow-inner"
      >
        <!-- Simplified Decoration -->
        <div class="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 opacity-50"></div>

        <p class="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] mb-3 leading-none relative z-10">
          Total Away Time
        </p>
        <p class="text-4xl font-mono-premium font-black text-slate-900 mb-3 tracking-tight relative z-10">
          {{ siloOutput.formatted }}
        </p>

        <div
          class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-100 shadow-sm relative z-10"
        >
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">
            {{ siloOutput.siloCount }} silo{{ siloOutput.siloCount !== 1 ? 's' : '' }}
          </span>
          <div class="w-1 h-1 rounded-full bg-slate-200"></div>
          <span class="text-[9px] font-black text-indigo-500 uppercase tracking-widest">
            {{ siloOutput.minutesPerSilo }}m each
          </span>
        </div>
      </div>
    </div>

    <!-- Silo Capacity Epic Research -->
    <div
      class="bg-indigo-50/30 border border-indigo-100/50 rounded-2xl p-4 transition-all hover:bg-indigo-50/50 hover:shadow-md hover:shadow-indigo-500/5"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl bg-white border border-indigo-100 flex items-center justify-center p-1.5 shadow-sm"
          >
            <img
              :src="iconURL(getResearchIconPath('silo_capacity'), 64)"
              class="w-full h-full object-contain"
              alt="Silo Capacity"
            />
          </div>
          <div>
            <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Silo Capacity</p>
            <p class="text-[11px] font-black text-indigo-900 uppercase">Epic Research: +6 min/silo/level</p>
          </div>
        </div>
        <div class="text-right">
          <span class="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-0.5"
            >Current Rank</span
          >
          <span class="text-xs font-mono-premium font-black text-indigo-700">
            Lvl {{ siloOutput.siloCapacityLevel }}/20
          </span>
        </div>
      </div>
      <div
        class="mt-3 flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight bg-white/50 p-2 rounded-lg border border-indigo-50/50 shadow-inner"
      >
        <span class="opacity-60">Base: 60m</span>
        <div class="w-1 h-px bg-slate-300"></div>
        <span class="text-indigo-600">+ {{ siloOutput.siloCapacityLevel * 6 }}m research</span>
        <div class="w-1 h-px bg-slate-300"></div>
        <span class="text-slate-900">Total: {{ siloOutput.minutesPerSilo }}m</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSiloTime } from '@/composables/useSiloTime';
import { useSilosStore } from '@/stores/silos';
import { useActionsStore } from '@/stores/actions';
import { computeDependencies } from '@/lib/actions/executor';
import { formatNumber, formatGemPrice, formatDuration } from '@/lib/format';
import { getResearchIconPath } from '@/lib/assets';
import { iconURL } from 'lib';
import { generateActionId } from '@/types';
import { useActionExecutor } from '@/composables/useActionExecutor';
import { computed } from 'vue';
import { getTimeToSave } from '@/engine/apply';
import { planSilosWithinBudget } from '@/calculations/siloPurchasePlan';

const ONE_HOUR_SECONDS = 3600;

const silosStore = useSilosStore();
const actionsStore = useActionsStore();
const { output: siloOutput } = useSiloTime();
const { prepareExecution, completeExecution, batch } = useActionExecutor();

const baseUrl = import.meta.env.BASE_URL;

const timeToBuy = computed(() => {
  const price = siloOutput.value.nextSiloCost;
  const seconds = getTimeToSave(price, actionsStore.effectiveSnapshot);
  if (seconds <= 0) return '0s';
  if (seconds === Infinity) return '∞';
  return formatDuration(seconds);
});

// Simulate buying silos back-to-back (waiting to save up gems between purchases)
// to see how many fit within a 1-hour window.
const maxSilosIn1Hour = computed<{ count: number; seconds: number }>(() => {
  const plan = planSilosWithinBudget(actionsStore.effectiveSnapshot, siloOutput.value.siloCount, ONE_HOUR_SECONDS);
  return { count: plan.steps.length, seconds: plan.totalSeconds };
});

async function handleBuySilo() {
  if (!siloOutput.value.canBuyMore) return;

  // Prepare execution (restores stores if editing past group)
  const beforeSnapshot = prepareExecution();

  const fromCount = beforeSnapshot.siloCount;
  const toCount = fromCount + 1;

  // Build payload
  const payload = {
    fromCount,
    toCount,
  };

  // Compute dependencies
  const dependencies = computeDependencies(
    'buy_silo',
    payload,
    actionsStore.actionsBeforeInsertion,
    actionsStore.initialSnapshot.researchLevels
  );

  // Cost is calculated based on fromCount (silos owned before purchase)
  const cost = siloOutput.value.nextSiloCost;

  // Apply to store
  silosStore.buySilo();

  // Complete execution — awaited so that back-to-back purchases (e.g. from the
  // 1-hr max button) each see the previous purchase's updated state before
  // computing their own fromCount/toCount and cost.
  await completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'buy_silo',
      payload,
      cost,
      dependsOn: dependencies,
    },
    beforeSnapshot
  );
}

function handleBuyMaxSilos1Hour() {
  const toBuy = maxSilosIn1Hour.value.count;
  if (toBuy <= 0) return;

  batch(async () => {
    for (let i = 0; i < toBuy; i++) {
      await handleBuySilo();
    }
  });
}
</script>
