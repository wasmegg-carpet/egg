<template>
  <div class="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <span class="text-xs font-bold uppercase tracking-wider text-indigo-700">From the artifact explorer</span>
        <p v-if="!planStore.file" class="text-[11px] text-gray-500 mt-0.5">
          Import solved visits from <code>humility-plan.json</code>.
        </p>
        <p v-else class="text-[11px] text-gray-500 mt-0.5">
          {{ planStore.file.planLabel }} — {{ planStore.file.visits.length }} solved visit{{
            planStore.file.visits.length === 1 ? '' : 's'
          }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <label
          class="px-2 py-1 text-xs rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 cursor-pointer"
        >
          {{ planStore.file ? 'Load another…' : 'Choose file…' }}
          <input type="file" accept=".json,application/json" class="hidden" @change="onFilePicked" />
        </label>
        <button
          v-if="planStore.file"
          type="button"
          class="px-2 py-1 text-xs rounded-md text-gray-500 hover:text-gray-700"
          @click="planStore.clear()"
        >
          Close
        </button>
      </div>
    </div>

    <p v-if="error" class="text-xs text-red-600">{{ error }}</p>

    <ul v-if="planStore.file" class="space-y-2">
      <li
        v-for="visit in planStore.file.visits"
        :key="visit.visitId"
        class="rounded-md border bg-white p-2.5"
        :class="planStore.isStaged(visit) ? 'border-indigo-400 ring-1 ring-indigo-300' : 'border-gray-200'"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <span class="text-xs font-bold text-gray-800">{{ visitName(visit) }}</span>
          <span class="text-[11px] text-gray-500">
            {{ totalShips(visit) }} ship{{ totalShips(visit) === 1 ? '' : 's' }} ·
            {{ formatDuration(visit.makespanSeconds) }} · joint {{ formatProbability(visit.jointProbability) }}
          </span>
        </div>

        <ul class="mt-1 space-y-0.5">
          <li v-for="(launch, i) in visit.launches" :key="i" class="text-[11px] text-gray-600">
            {{ launch.count }}× {{ launchLabel(launch) }}
            <span class="text-gray-400">→ {{ getTargetName(launch.targetAfxId) }}</span>
          </li>
        </ul>

        <p v-if="visit.gemCost > visit.gemBudget" class="mt-1 text-[11px] text-amber-700">
          Total: {{ formatNumber(visit.gemCost, 2) }} gems; plan budget: {{ formatNumber(visit.gemBudget, 2) }}.
          Purchase limits apply per ship.
        </p>

        <p
          v-if="launchDurations.get(visit.visitId)?.withEarningsSet !== undefined"
          class="mt-1 text-[11px] text-gray-600"
        >
          Launch takes {{ formatDuration(launchDurations.get(visit.visitId)!.seconds) }} on the elr set,
          {{ formatDuration(launchDurations.get(visit.visitId)!.withEarningsSet!) }} on the earnings set.
          <label class="ml-1 inline-flex items-center gap-1 cursor-pointer">
            <input v-model="swapSets[visit.visitId]" type="checkbox" class="h-3 w-3" />
            Swap to the earnings set for the launch
          </label>
        </p>

        <div class="mt-2 flex items-center gap-2">
          <button
            type="button"
            class="px-2 py-1 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="!stageable.has(visit.visitId)"
            @click="onStage(visit)"
          >
            {{ planStore.isStaged(visit) ? 'Restage' : 'Stage into plan' }}
          </button>
          <span v-if="unavailableReasons.get(visit.visitId)" class="text-[11px] text-amber-700">
            {{ unavailableReasons.get(visit.visitId) }}
          </span>
        </div>
      </li>
    </ul>

    <div v-if="planStore.drift.length > 0" class="rounded-md border border-red-300 bg-red-50 p-2">
      <p class="text-[11px] font-bold text-red-700">Fuel amounts differ. Using this planner's values.</p>
      <ul class="mt-1 space-y-0.5">
        <li v-for="d in planStore.drift" :key="d.egg" class="text-[11px] text-red-700">
          {{ d.egg }}: here {{ formatNumber(d.ours, 2) }}, in the file {{ formatNumber(d.theirs, 2) }}
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { formatProbability, getTargetName } from 'lib';

import { getSimulationContext } from '@/engine/adapter';
import { useActionsStore } from '@/stores/actions';
import { useHumilityPlanStore } from '@/stores/humilityPlan';
import { previewLaunchDurations, type LaunchDurations } from '@/lib/humilityPlanStage';
import {
  humilityVisitIds,
  launchLabel,
  stageableVisitIds,
  HumilityPlanError,
  type HumilityPlanVisit,
} from '@/lib/humilityPlan';
import { formatDuration, formatNumber } from '@/lib/format';

const planStore = useHumilityPlanStore();
const actionsStore = useActionsStore();
const error = ref('');

// Use the current plan's visit count.
const planVisitIds = computed(() => humilityVisitIds(actionsStore.actions));

const stageable = computed(() =>
  planStore.file ? stageableVisitIds(planStore.file, planVisitIds.value) : new Set<string>()
);

function visitName(visit: HumilityPlanVisit): string {
  return `H${visit.visitIndex + 1} of ${planVisitIds.value.length}`;
}

const unavailableReasons = computed(() => {
  const inPlan = new Set(planVisitIds.value);
  const reasons = new Map<string, string>();
  for (const visit of planStore.file?.visits ?? []) {
    if (stageable.value.has(visit.visitId)) continue;
    reasons.set(
      visit.visitId,
      inPlan.has(visit.visitId)
        ? 'An earlier solved visit is no longer in the plan.'
        : 'This visit is no longer in the plan.'
    );
  }
  return reasons;
});

const launchDurations = computed(() => {
  const context = getSimulationContext();
  const durations = new Map<string, LaunchDurations>();
  for (const visit of planStore.file?.visits ?? []) {
    if (!stageable.value.has(visit.visitId)) continue;
    const preview = previewLaunchDurations(actionsStore.actions, visit, context);
    if (preview) durations.set(visit.visitId, preview);
  }
  return durations;
});

// Ticked whenever the swap is faster; the user can untick it to keep the plan's set.
const swapSets = reactive<Record<string, boolean>>({});
watch(
  launchDurations,
  durations => {
    for (const [visitId, d] of durations) {
      if (!(visitId in swapSets)) swapSets[visitId] = d.withEarningsSet !== undefined && d.withEarningsSet < d.seconds;
    }
  },
  { immediate: true }
);

function totalShips(visit: HumilityPlanVisit): number {
  return visit.launches.reduce((sum, l) => sum + l.count, 0);
}

async function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Cleared so re-picking the same file still fires a change event.
  input.value = '';
  if (!file) return;
  error.value = '';
  try {
    planStore.load(JSON.parse(await file.text()));
  } catch (err) {
    error.value =
      err instanceof HumilityPlanError ? err.message : `Could not read that file: ${(err as Error).message}`;
  }
}

async function onStage(visit: HumilityPlanVisit) {
  error.value = '';
  try {
    await planStore.stage(visit, { equipEarningsSet: swapSets[visit.visitId] === true });
  } catch (err) {
    error.value = err instanceof HumilityPlanError ? err.message : (err as Error).message;
  }
}
</script>
