<template>
  <div class="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <span class="text-xs font-bold uppercase tracking-wider text-indigo-700">From the artifact explorer</span>
        <p v-if="!planStore.file" class="text-[11px] text-gray-500 mt-0.5">
          Load a <code>humility-plan.json</code> to write a solved visit into this plan.
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
            {{ formatDuration(visit.makespanSeconds) }} · joint {{ (visit.jointProbability * 100).toFixed(1) }}%
          </span>
        </div>

        <ul class="mt-1 space-y-0.5">
          <li v-for="(launch, i) in visit.launches" :key="i" class="text-[11px] text-gray-600">
            {{ launch.count }}× {{ launch.duration }} {{ launch.ship }}
            <span class="text-gray-400">→ {{ getTargetName(launch.targetAfxId) }}</span>
          </li>
        </ul>

        <p v-if="visit.gemCost > visit.gemBudget" class="mt-1 text-[11px] text-amber-700">
          Costs {{ formatNumber(visit.gemCost, 2) }} gems against a budget of {{ formatNumber(visit.gemBudget, 2) }}.
          The explorer caps what one ship may cost, not what the whole visit may spend.
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
      <p class="text-[11px] font-bold text-red-700">
        Fuel tables disagree with the artifact explorer. The tank is charged this planner's figures.
      </p>
      <ul class="mt-1 space-y-0.5">
        <li v-for="d in planStore.drift" :key="d.egg" class="text-[11px] text-red-700">
          {{ d.egg }}: here {{ formatNumber(d.ours, 2) }}, in the file {{ formatNumber(d.theirs, 2) }}
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { getTargetName } from 'lib';

import { useActionsStore } from '@/stores/actions';
import { useHumilityPlanStore } from '@/stores/humilityPlan';
import { humilityVisitIds, stageableVisitIds, HumilityPlanError, type HumilityPlanVisit } from '@/lib/humilityPlan';
import { formatDuration, formatNumber } from '@/lib/format';

const planStore = useHumilityPlanStore();
const actionsStore = useActionsStore();
const error = ref('');

// Numbered against this plan rather than against the file, so the rows read the way the plan
// does: a file solved for three visits and imported into a plan with four still says "of 4".
const planVisitIds = computed(() => humilityVisitIds(actionsStore.actions));

const stageable = computed(() =>
  planStore.file ? stageableVisitIds(planStore.file, planVisitIds.value) : new Set<string>()
);

function visitName(visit: HumilityPlanVisit): string {
  return `H${visit.visitIndex + 1} of ${planVisitIds.value.length}`;
}

// Built once per plan change rather than per lookup: the row reads its reason twice, to decide
// whether to show it and then to show it.
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
    await planStore.stage(visit);
  } catch (err) {
    error.value = err instanceof HumilityPlanError ? err.message : (err as Error).message;
  }
}
</script>
