<template>
  <div class="space-y-6">
    <p class="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-6 leading-relaxed">
      Wait until you have accumulated a target amount of {{ currency.name }}.
    </p>

    <!-- Current State -->
    <div class="bg-slate-50/50 rounded-2xl p-5 border border-slate-100 shadow-inner">
      <div class="flex items-center gap-4 mb-4">
        <div
          class="w-12 h-12 rounded-2xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-2"
        >
          <img :src="iconURL(currency.iconPath, 64)" class="w-full h-full object-contain" :alt="currency.name" />
        </div>
        <div>
          <div class="text-sm font-bold text-slate-800">
            {{ formatNumber(planStore.bankValue, 3) }}
          </div>
          <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Current {{ currency.name }} in Bank</div>
        </div>
      </div>
    </div>

    <!-- Target Selection -->
    <div class="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
      <div class="flex items-center gap-3 mb-5 pb-4 border-b border-slate-50">
        <div
          class="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center p-1.5 shadow-lg border border-slate-800"
        >
          <img :src="iconURL(currency.iconPath, 64)" class="w-full h-full object-contain" :alt="currency.name" />
        </div>
        <span class="text-xs font-bold text-slate-700 uppercase tracking-tight"> Set Target {{ currency.singular }} Count </span>
      </div>

      <!-- Target input -->
      <div class="flex flex-col gap-3 mb-6">
        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Wait until I have:</span>
        <input
          ref="inputEl"
          v-model="targetInput"
          type="text"
          placeholder="e.g. 1M or 1,234,567"
          class="w-full h-10 px-4 text-sm font-mono-premium font-bold bg-slate-50/50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300 outline-none transition-all"
        />
        <div v-if="parsedTarget !== null" class="text-[10px] font-bold text-slate-500 text-right">
          Parsed: {{ formatNumber(parsedTarget, 3) }}
        </div>
      </div>

      <!-- Calculated values -->
      <div
        v-if="parsedTarget !== null && parsedTarget > planStore.bankValue"
        class="space-y-3 bg-slate-50/30 rounded-xl p-4 border border-slate-50"
      >
        <div class="flex justify-between items-center text-[10px]">
          <span class="font-black text-slate-400 uppercase tracking-widest">Required to Earn:</span>
          <span class="font-mono-premium font-black text-slate-900">{{ formatNumber(requiredToEarn, 3) }}</span>
        </div>

        <div class="pt-2 mt-1 border-t border-slate-100/50 space-y-2">
          <div class="flex justify-between items-center text-[10px]">
            <span class="font-black text-slate-400 uppercase tracking-widest">Earnings Rate:</span>
            <span class="font-mono-premium text-slate-500">{{ formatNumber(earningsPerSecond, 3) }}/s</span>
          </div>
          <div class="flex justify-between items-center pt-2 mt-1 border-t border-slate-100/50 text-[10px]">
            <span class="font-black text-slate-400 uppercase tracking-widest">Time Required:</span>
            <span class="font-mono-premium font-black text-slate-900">{{ formatDuration(timeToSaveSeconds) }}</span>
          </div>
          <div class="flex justify-between items-center text-[10px]">
            <span class="font-black text-slate-400 uppercase tracking-widest">Completion Time:</span>
            <span class="font-mono-premium text-slate-600">{{ formattedAbsoluteTime }}</span>
          </div>
        </div>
      </div>

      <div
        v-else-if="parsedTarget !== null && parsedTarget <= planStore.bankValue"
        class="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-emerald-700 text-[10px] font-bold uppercase tracking-tight"
      >
        Target already reached!
      </div>

      <!-- Wait button -->
      <button
        class="btn-premium btn-primary w-full mt-6 py-4 flex items-center justify-center gap-2 group disabled:opacity-20 shadow-lg shadow-slate-900/10"
        :disabled="!canWait"
        @click="handleWaitForCurrency"
      >
        <img
          :src="iconURL(currency.iconPath, 64)"
          class="w-5 h-5 object-contain group-hover:scale-110 transition-transform"
          :alt="currency.name"
        />
        <span>Wait for {{ currency.title }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePlannerProfile } from 'ui/composables/planners/plannerProfile';
import { ref, computed } from 'vue';
const inputEl = ref<HTMLInputElement | null>(null);
defineExpose({ focus: () => inputEl.value?.focus() });
import { iconURL } from 'lib';
import { usePlanStore } from '@planner/stores/plan';
import { useActionsStore } from '@planner/stores/actions';
import { formatNumber, formatDuration, parseNumber, formatAbsoluteTime } from '@planner/lib/format';
import { generateActionId, type ActionType } from '@planner/types';
import { createCurrencyWaitPayload } from 'lib/planners/actions/currencyWait';
import { useEventCrossingWaits } from 'lib/planners/composables/usePlannerEventCrossingWaits';
import { getBoostAwareTimeToSave } from '@planner/engine/apply';
import { getSimulationContext } from 'lib/planners/engine/adapter';
import { computeDependencies } from 'lib/planners/actions/executor';

const { currency } = usePlannerProfile();
// Each planner's action types include only the name its own saved plans use.
const waitType = currency.waitActionType as ActionType;

const planStore = usePlanStore();
const actionsStore = useActionsStore();
const { prepareExecution, completeExecution, batch, isEditingPastGroup, settled, insertBoostCrossingWaits } =
  useEventCrossingWaits();

const targetInput = ref('');

const parsedTarget = computed(() => {
  const val = parseNumber(targetInput.value);
  return isNaN(val) ? null : val;
});

const requiredToEarn = computed(() => {
  if (parsedTarget.value === null) return 0;
  return Math.max(0, parsedTarget.value - planStore.bankValue);
});

const earningsPerSecond = computed(() => {
  // Use offline earnings for "wait" actions as they usually simulate time passing while away
  return actionsStore.effectiveSnapshot.offlineEarnings;
});

const timeToSaveSeconds = computed(() => {
  if (parsedTarget.value === null || parsedTarget.value <= planStore.bankValue) return 0;
  
  // Accounts for population growth and 2x earnings, as the wait itself does
  const time = getBoostAwareTimeToSave(parsedTarget.value, actionsStore.effectiveSnapshot, getSimulationContext());
  return isFinite(time) ? time : Infinity;
});

const baseTimestamp = computed(() => {
  const startTime = planStore.planStartTime.getTime();
  const offset = actionsStore.planStartOffset;
  // Wall clock time = (Plan Start) + (Current Sim Time - Initial Sim Time)
  return startTime + (actionsStore.effectiveSnapshot.lastStepTime - offset) * 1000;
});

const formattedAbsoluteTime = computed(() => {
  if (timeToSaveSeconds.value === 0 || !isFinite(timeToSaveSeconds.value)) return 'N/A';
  return formatAbsoluteTime(timeToSaveSeconds.value, baseTimestamp.value, planStore.ascensionTimezone);
});

const canWait = computed(
  () => parsedTarget.value !== null && parsedTarget.value > planStore.bankValue && isFinite(timeToSaveSeconds.value)
);

function handleWaitForCurrency() {
  if (!canWait.value || parsedTarget.value === null) return;
  const target = parsedTarget.value;

  batch(async () => {
    prepareExecution();
    insertBoostCrossingWaits(target);
    if (isEditingPastGroup.value) await settled();
    addCurrencyWait(target);
  });

  targetInput.value = '';
}

// After any 2x waits, so everything is measured from where those leave the plan.
function addCurrencyWait(target: number) {
  const beforeSnapshot = prepareExecution();

  const payload = createCurrencyWaitPayload(currency.waitActionType, {
    target,
    bankValue: beforeSnapshot.bankValue,
    earningsPerSecond: beforeSnapshot.offlineEarnings,
    timeSeconds: getBoostAwareTimeToSave(target, beforeSnapshot, getSimulationContext()),
  }) as never;

  const dependencies = computeDependencies(
    waitType,
    payload,
    actionsStore.actionsBeforeInsertion,
    actionsStore.initialSnapshot.researchLevels
  );

  // Apply to store: एडवांस time and bank value
  // Actually, we should advance the simulation by the calculated time
  // The completeExecution will handle snapshots, but we need to update the stores properly.
  // We'll use applyTime logic here to update the store state.
  
  // Update bank value manually in the plan store
  planStore.setBankValue(target);
  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: waitType,
      payload,
      cost: 0,
      dependsOn: dependencies,
    },
    beforeSnapshot
  );
}
</script>
