<template>
  <div class="space-y-6">
    <!-- Header: Total Gain and Final TE -->
    <div class="bg-slate-50/50 rounded-xl p-4 border border-slate-100 flex flex-wrap items-center justify-between gap-4">
      <div class="space-y-1">
        <label class="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Total TE to Gain</label>
        <div class="flex items-center gap-3">
          <button 
            class="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 active:scale-95 transition-all shadow-sm"
            @click="adjustTotal(-1)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" /></svg>
          </button>
          <input
            ref="inputEl"
            type="number"
            v-model.number="totalTEToGain"
            class="w-16 bg-white border border-slate-200 rounded-lg px-2 py-1 text-center font-mono-premium font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-all shadow-sm"
            @change="handleTotalChange"
          />
          <button 
            class="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 active:scale-95 transition-all shadow-sm"
            @click="adjustTotal(1)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
          </button>
        </div>
      </div>

      <div class="space-y-1">
        <label class="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 text-right">Final Total TE</label>
        <div class="flex items-center justify-end gap-2">
          <span class="font-mono-premium font-black text-2xl text-slate-900">{{ finalTotalTE }}</span>
          <img :src="iconURL('egginc/egg_truth.png', 64)" class="w-6 h-6 object-contain" />
        </div>
      </div>

      <div class="w-full sm:w-auto">
        <button 
          class="w-full sm:w-auto px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-wider transition-all shadow-sm border"
          :class="canRebalance ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800' : 'bg-white text-slate-300 border-slate-100 cursor-not-allowed'"
          :disabled="!canRebalance"
          @click="rebalance"
        >
          Rebalance
        </button>
      </div>
    </div>

    <!-- Egg Visit Order -->
    <div class="space-y-3">
      <div 
        v-for="(eggPlan, index) in eggPlans" 
        :key="eggPlan.egg"
        class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
        :class="{ 'ring-1 ring-slate-900/5': eggPlan.isCurrentEgg }"
      >
        <div class="px-5 py-4 flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center p-1.5 shadow-inner">
              <img :src="iconURL(`egginc/egg_${eggPlan.egg}.png`, 64)" class="w-full h-full object-contain" />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-black text-[10px] uppercase text-slate-900">{{ VIRTUE_EGG_NAMES[eggPlan.egg] }}</span>
                <span class="text-slate-600 text-[10px] font-bold">{{ formatDuration(eggPlan.durationSeconds) }}</span>
                <span v-if="eggPlan.isCurrentEgg" class="px-1.5 py-0.5 bg-slate-900 text-white text-[8px] font-black uppercase tracking-tighter rounded">Current</span>
              </div>
              <div class="text-[10px] font-mono-premium text-slate-400 mt-0.5">
                <span v-if="index === eggPlans.length - 1">Prestige on</span>
                <span v-else>Shift on</span>
                <span class="text-slate-500">&nbsp;{{ eggPlan.absoluteTime }}</span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <!-- Individual Adjustments -->
            <div class="flex items-center bg-slate-50 rounded-lg border border-slate-100 p-0.5 shadow-inner">
              <button 
                class="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-white transition-all active:scale-90"
                @click="adjustEgg(eggPlan.egg, -1)"
              >
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" /></svg>
              </button>
              <span class="px-2 text-center text-xs font-mono-premium font-black text-slate-900">
                {{ eggPlan.targetTE }}
                <span class="text-indigo-600 font-bold ml-1">(+{{ eggPlan.teToGain }})</span>
              </span>
              <button 
                class="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-white transition-all active:scale-90"
                @click="adjustEgg(eggPlan.egg, 1)"
              >
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
              </button>
            </div>

            <!-- Reorder Controls -->
            <div v-if="!eggPlan.isCurrentEgg" class="flex flex-col gap-0.5">
              <button 
                class="w-6 h-5 flex items-center justify-center text-slate-300 hover:text-slate-900 transition-all"
                :class="{ 'opacity-0 pointer-events-none': index === 1 }"
                @click="moveEgg(index, -1)"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
              </button>
              <button 
                class="w-6 h-5 flex items-center justify-center text-slate-300 hover:text-slate-900 transition-all"
                :class="{ 'opacity-0 pointer-events-none': index === eggPlans.length - 1 }"
                @click="moveEgg(index, 1)"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Summary -->
    <div v-if="totalTEToGain > 0" class="bg-slate-900 rounded-2xl p-5 text-white shadow-xl shadow-slate-900/20">
      <div class="flex items-center justify-between">
        <div class="space-y-1">
          <label class="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Total Duration</label>
          <div class="text-xl font-mono-premium font-black">{{ formatDuration(totalDurationSeconds) }}</div>
        </div>
        <div class="text-right space-y-1">
          <label class="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Final Completion</label>
          <div class="text-sm font-bold text-slate-200 italic">{{ finalAbsoluteTime }}</div>
        </div>
      </div>
    </div>

    <!-- Apply Button -->
    <div class="pt-2">
      <button 
        class="btn-premium btn-primary w-full py-4 text-xs font-black uppercase tracking-[0.3em] shadow-xl"
        :disabled="totalTEToGain <= 0"
        @click="handleApply"
      >
        Apply Bulk TE Plan
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
const inputEl = ref<HTMLInputElement | null>(null);
defineExpose({ focus: () => inputEl.value?.focus() });
import { iconURL, shiftCost } from 'lib';
import { useTruthEggsStore } from '@/stores/truthEggs';
import { useVirtueStore } from '@/stores/virtue';
import { useActionsStore } from '@/stores/actions';
import { useActionExecutor } from '@/composables/useActionExecutor';
import { computeDependencies } from '@/lib/actions/executor';
import { formatNumber, formatDuration, formatAbsoluteTime } from '@/lib/format';
import { generateActionId, VIRTUE_EGG_NAMES, VIRTUE_EGGS, type VirtueEgg, type DraftAction } from '@/types';
import { TE_BREAKPOINTS, countTEThresholdsPassed, MAX_TE, eggsNeededForTE } from '@/lib/truthEggs';
import { integrateRate } from 'lib/planners/engine/apply/math';

const truthEggsStore = useTruthEggsStore();
const virtueStore = useVirtueStore();
const actionsStore = useActionsStore();

const totalTEToGain = ref(15);
const visitOrder = ref<VirtueEgg[]>([]);

// Per-egg gain overrides (to support manual adjustments)
const manualGains = ref<Record<VirtueEgg, number | null>>({
  curiosity: null,
  integrity: null,
  humility: null,
  resilience: null,
  kindness: null,
});

// Current starting stats per egg (accounts for pending TE in the plan)
const eggStartStates = computed(() => {
  const stats: Record<VirtueEgg, { te: number; delivered: number }> = {} as Record<VirtueEgg, { te: number; delivered: number }>;
  const snapshot = actionsStore.effectiveSnapshot;
  
  for (const egg of VIRTUE_EGGS) {
    const delivered = snapshot.eggsDelivered[egg] || 0;
    const earned = snapshot.teEarned?.[egg] || 0;
    const thresholds = countTEThresholdsPassed(delivered);
    stats[egg] = {
      te: Math.max(earned, thresholds),
      delivered: delivered,
    };
  }
  return stats;
});

const currentTotalTE = computed(() => {
  return Object.values(eggStartStates.value).reduce((sum, s) => sum + s.te, 0);
});

const finalTotalTE = computed(() => currentTotalTE.value + totalTEToGain.value);

/**
 * The Greedy Allocation Algorithm
 */
function calculateGreedyGains(total: number) {
  const gains: Record<VirtueEgg, number> = {} as Record<VirtueEgg, number>;
  VIRTUE_EGGS.forEach(e => gains[e] = 0);

  const working = VIRTUE_EGGS.map(egg => ({
    egg,
    currentTE: eggStartStates.value[egg].te,
    currentDelivered: eggStartStates.value[egg].delivered,
  }));

  for (let i = 0; i < total; i++) {
    let bestEgg: VirtueEgg | null = null;
    let bestCost = Infinity;

    for (const w of working) {
      if (w.currentTE >= MAX_TE) continue;

      const nextThreshold = TE_BREAKPOINTS[w.currentTE];
      const cost = Math.max(0, nextThreshold - w.currentDelivered);

      if (cost < bestCost) {
        bestCost = cost;
        bestEgg = w.egg;
      }
    }

    if (!bestEgg) break;

    gains[bestEgg]++;
    const wEgg = working.find(w => w.egg === bestEgg)!;
    wEgg.currentTE++;
    wEgg.currentDelivered = TE_BREAKPOINTS[wEgg.currentTE - 1];
  }

  return gains;
}

// Current distribution based on greedy logic or manual overrides
const distributedGains = computed(() => {
  // If we have manual overrides that sum to the total, use them.
  // Otherwise, fallback to greedy for the remaining.
  // Actually, for simplicity in Phase 1: if ANY are manual, use manual. 
  // But the plan says Rebalance button resets everything to greedy.
  const anyManual = Object.values(manualGains.value).some(v => v !== null);
  if (anyManual) {
    const gains: Record<VirtueEgg, number> = {} as Record<VirtueEgg, number>;
    VIRTUE_EGGS.forEach(e => gains[e] = manualGains.value[e] ?? 0);
    return gains;
  }
  
  return calculateGreedyGains(totalTEToGain.value);
});

const canRebalance = computed(() => {
  const greedy = calculateGreedyGains(totalTEToGain.value);
  return VIRTUE_EGGS.some(e => distributedGains.value[e] !== greedy[e]);
});

const eggPlans = computed(() => {
  const currentEgg = actionsStore.effectiveSnapshot.currentEgg as VirtueEgg;
  const snapshot = actionsStore.effectiveSnapshot;
  
  const IHR = snapshot.offlineIHR / 60;
  const R = snapshot.ratePerChickenPerSecond;
  const S = snapshot.shippingCapacity;
  const H = snapshot.habCapacity;
  const fullHabRate = Math.min(S, R * H);
  
  let runningTimeSeconds = 0;
  const planStartOffset = actionsStore.planStartOffset || 0;
  const baseTime = snapshot.lastStepTime;

  return visitOrder.value.map((egg, index) => {
    const start = eggStartStates.value[egg];
    const gain = distributedGains.value[egg];
    
    let durationSeconds = 0;
    
    if (gain > 0) {
      const eggsToLay = eggsNeededForTE(start.delivered, start.te + gain);
      let currentPop = egg === currentEgg ? snapshot.population : 1;
      
      // 1. Hab fill phase
      if (currentPop < H) {
        const fillTime = IHR > 0 ? (H - currentPop) / IHR : 0;
        durationSeconds += fillTime;
        
        const eggsDuringFill = integrateRate(fillTime, currentPop, IHR, R, S, H);
        const remainingToLay = Math.max(0, eggsToLay - eggsDuringFill);
        
        // 2. Shipping phase at full capacity
        durationSeconds += fullHabRate > 0 ? remainingToLay / fullHabRate : 0;
      } else {
        durationSeconds += fullHabRate > 0 ? eggsToLay / fullHabRate : 0;
      }
    }

    const completionTime = baseTime + runningTimeSeconds + durationSeconds;
    
    const plan = {
      egg,
      isCurrentEgg: egg === currentEgg,
      currentTE: start.te,
      targetTE: start.te + gain,
      teToGain: gain,
      durationSeconds,
      displayTime: formatSimTime(baseTime + runningTimeSeconds),
      absoluteTime: formatAbsoluteTime(completionTime - planStartOffset, actionsStore.ascensionStartTime * 1000),
    };

    runningTimeSeconds += durationSeconds;
    return plan;
  });
});

const totalDurationSeconds = computed(() => {
  return eggPlans.value.reduce((sum, p) => sum + p.durationSeconds, 0);
});

const finalAbsoluteTime = computed(() => {
  const lastPlan = eggPlans.value[eggPlans.value.length - 1];
  return lastPlan?.absoluteTime || '---';
});

/**
 * Format relative simulation time: "Day X, H:MM AM/PM"
 */
function formatSimTime(seconds: number) {
  // Use current time as fallback for Continue Ascension if store start time is missing
  const startTime = actionsStore.ascensionStartTime || (Date.now() / 1000);
  
  if (isNaN(seconds) || seconds === 0) return 'Day 1, 12:00 AM';

  const relativeSeconds = Math.max(0, seconds - startTime);
  const day = Math.floor(relativeSeconds / 86400) + 1;
  const hour = Math.floor((relativeSeconds % 86400) / 3600);
  const minute = Math.floor((relativeSeconds % 3600) / 60);
  
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  const displayMinute = minute.toString().padStart(2, '0');
  
  return `Day ${day}, ${displayHour}:${displayMinute} ${period}`;
}

// Initialization
onMounted(() => {
  const currentEgg = actionsStore.effectiveSnapshot.currentEgg as VirtueEgg;
  // Current egg first, then others in standard order
  visitOrder.value = [
    currentEgg,
    ...VIRTUE_EGGS.filter(e => e !== currentEgg)
  ];
});

// Methods
function adjustTotal(delta: number) {
  const newTotal = Math.max(0, totalTEToGain.value + delta);
  const maxPossibleGain = Object.values(eggStartStates.value).reduce((sum, s) => sum + (MAX_TE - s.te), 0);
  totalTEToGain.value = Math.min(newTotal, maxPossibleGain);
  rebalance();
}

function handleTotalChange() {
  const maxPossibleGain = Object.values(eggStartStates.value).reduce((sum, s) => sum + (MAX_TE - s.te), 0);
  totalTEToGain.value = Math.min(Math.max(0, totalTEToGain.value), maxPossibleGain);
  rebalance();
}

function adjustEgg(egg: VirtueEgg, delta: number) {
  // Capture current state before we start modifying dependencies
  const currentDist = { ...distributedGains.value };
  const start = eggStartStates.value[egg];
  const currentGain = currentDist[egg];
  const newGain = Math.max(0, Math.min(MAX_TE - start.te, currentGain + delta));
  
  if (newGain === currentGain) return;

  // Set the manual value for the adjusted egg
  manualGains.value[egg] = newGain;
  
  // Freeze all other eggs to their current values to enter "manual mode" cleanly
  VIRTUE_EGGS.forEach(e => {
    if (e !== egg && manualGains.value[e] === null) {
      manualGains.value[e] = currentDist[e];
    }
  });

  // Update total based on new sum
  totalTEToGain.value = Object.values(manualGains.value).reduce<number>((sum, v) => (sum || 0) + (v || 0), 0);
}

function rebalance() {
  VIRTUE_EGGS.forEach(e => manualGains.value[e] = null);
}

function moveEgg(index: number, delta: number) {
  const newIndex = index + delta;
  if (newIndex < 1 || newIndex >= visitOrder.value.length || index < 1) return;
  
  const arr = [...visitOrder.value];
  const temp = arr[index];
  arr[index] = arr[newIndex];
  arr[newIndex] = temp;
  visitOrder.value = arr;
}

/**
 * PHASE 4: Apply Workflow
 * Generates all actions in a single batch.
 */
async function handleApply() {
  const execute = async (action: DraftAction) => {
    if (actionsStore.editingGroupId) {
      await actionsStore.insertAction(action);
    } else {
      actionsStore.pushAction(action);
    }
  };

  actionsStore.startBatch();
  
  try {
    for (const plan of eggPlans.value) {
      if (plan.teToGain <= 0) continue;

      // 1. If not current egg, we need to SHIFT first
      if (!plan.isCurrentEgg) {
        const snapshot = actionsStore.effectiveSnapshot;
        const fromEgg = snapshot.currentEgg;
        const toEgg = plan.egg;
        const newShiftCount = snapshot.shiftCount + 1;
        const cost = shiftCost(snapshot.soulEggs, snapshot.shiftCount);

        const payload = { fromEgg, toEgg, newShiftCount };
        await execute({
          id: generateActionId(),
          timestamp: Date.now(),
          type: 'shift' as const,
          payload,
          cost,
          dependsOn: computeDependencies(
            'shift',
            payload,
            actionsStore.actionsBeforeInsertion,
            actionsStore.initialSnapshot.researchLevels
          ),
        });
        
        // Use the newly shifted egg for events
        actionsStore.pushRelevantEvents(toEgg);
      }

      // 2. Wait for Full Habs
      {
        const snapshot = actionsStore.effectiveSnapshot;
        if (snapshot.population < snapshot.habCapacity) {
          const IHR = snapshot.offlineIHR / 60;
          const chickensNeeded = Math.max(0, snapshot.habCapacity - snapshot.population);
          const totalTimeSeconds = IHR > 0 ? chickensNeeded / IHR : 0;

          const payload = {
            habCapacity: snapshot.habCapacity,
            ihr: snapshot.offlineIHR,
            currentPopulation: snapshot.population,
            totalTimeSeconds,
          };

          await execute({
            id: generateActionId(),
            timestamp: Date.now(),
            type: 'wait_for_full_habs' as const,
            payload,
            cost: 0,
            dependsOn: computeDependencies(
              'wait_for_full_habs',
              payload,
              actionsStore.actionsBeforeInsertion,
              actionsStore.initialSnapshot.researchLevels
            ),
          });
        }
      }

      // 3. Wait for TE
      {
        const snapshot = actionsStore.effectiveSnapshot;
        const egg = snapshot.currentEgg as VirtueEgg;
        const eggsToLay = eggsNeededForTE(snapshot.eggsDelivered[egg], plan.targetTE);
        
        const payload = {
          egg,
          targetTE: plan.targetTE,
          teGained: plan.teToGain,
          eggsToLay,
          timeSeconds: plan.durationSeconds,
          startEggsDelivered: snapshot.eggsDelivered[egg] || 0,
          startTE: plan.currentTE,
        };

        await execute({
          id: generateActionId(),
          timestamp: Date.now(),
          type: 'wait_for_te' as const,
          payload,
          cost: 0,
          dependsOn: computeDependencies(
            'wait_for_te',
            payload,
            actionsStore.actionsBeforeInsertion,
            actionsStore.initialSnapshot.researchLevels
          ),
        });
      }
    }
  } finally {
    await actionsStore.commitBatch();
  }
}
</script>

<style scoped>
.font-mono-premium {
  font-variant-numeric: tabular-nums;
}
</style>
