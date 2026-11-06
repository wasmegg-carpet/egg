<template>
  <div class="space-y-4">
    <p class="text-[11px] font-medium text-slate-400 uppercase tracking-wider leading-relaxed">
      Wait until the farm holds a target population.
    </p>

    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
      <button
        v-for="target in targets"
        :key="target.id"
        class="rounded-xl border px-3 py-2 text-left transition-colors"
        :class="
          isDisabled(target.population)
            ? 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
            : 'border-slate-200 bg-white hover:border-indigo-300 text-slate-700'
        "
        :disabled="isDisabled(target.population)"
        v-tippy="disabledReason(target.population)"
        @click="wait(target.population, target.label)"
      >
        <div class="text-[10px] font-black uppercase tracking-widest">{{ target.label }}</div>
        <div class="text-xs font-mono-premium font-bold">{{ formatNumber(target.population, 3) }}</div>
      </button>
    </div>

    <form class="flex items-center gap-2" @submit.prevent="waitForCustom">
      <input
        ref="customInput"
        v-model="customText"
        type="text"
        placeholder="e.g. 2.5B"
        class="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        class="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white disabled:opacity-40"
        :disabled="customPopulation === null || isDisabled(customPopulation)"
      >
        Wait
      </button>
    </form>
    <p v-if="customPopulation !== null && isDisabled(customPopulation)" class="text-xs text-amber-600">
      {{ disabledReason(customPopulation) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useActionsStore } from '@/stores/actions';
import { useActionExecutor } from '@/composables/useActionExecutor';
import { computeDependencies } from '@/lib/actions/executor';
import { populationTargets } from '@/calculations/goals';
import { formatNumber, parseNumber } from '@/lib/format';
import { generateActionId, type WaitForPopulationPayload } from '@/types';

const actionsStore = useActionsStore();
const { prepareExecution, completeExecution } = useActionExecutor();

const targets = populationTargets();
const customText = ref('');
const customInput = ref<HTMLInputElement | null>(null);

const customPopulation = computed(() => {
  const value = parseNumber(customText.value);
  return Number.isFinite(value) && value > 0 ? value : null;
});

function disabledReason(population: number): string {
  const { population: current, habCapacity } = actionsStore.effectiveSnapshot;
  if (current >= population) return 'The farm is already there.';
  if (population > habCapacity) return `The habs only hold ${formatNumber(habCapacity, 3)}.`;
  return '';
}

function isDisabled(population: number): boolean {
  return disabledReason(population) !== '';
}

function wait(population: number, label?: string) {
  if (isDisabled(population)) return;
  const beforeSnapshot = prepareExecution();
  const ihr = beforeSnapshot.offlineIHR;
  const payload: WaitForPopulationPayload = {
    targetPopulation: population,
    label,
    currentPopulation: beforeSnapshot.population,
    ihr,
    reachable: true,
    totalTimeSeconds: ihr > 0 ? (population - beforeSnapshot.population) / (ihr / 60) : 0,
  };
  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'wait_for_population',
      payload,
      cost: 0,
      dependsOn: computeDependencies(
        'wait_for_population',
        payload,
        actionsStore.actionsBeforeInsertion,
        actionsStore.initialSnapshot.researchLevels
      ),
    },
    beforeSnapshot
  );
}

function waitForCustom() {
  if (customPopulation.value === null) return;
  wait(customPopulation.value);
  customText.value = '';
}

defineExpose({ focus: () => customInput.value?.focus() });
</script>
