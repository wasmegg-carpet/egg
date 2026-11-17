<template>
  <div class="space-y-4">
    <p v-if="visitError" class="text-xs text-red-600">{{ visitError }}</p>
    <p v-else-if="!current" class="text-xs text-gray-500">Shift to Humility to plan this visit's missions.</p>

    <template v-else-if="settings">
      <!-- Where the ships, inventory and crafting level come from. -->
      <div
        v-if="!store.player"
        class="rounded-md border border-amber-200 bg-amber-50 p-2.5 flex flex-wrap items-center justify-between gap-2"
      >
        <p class="text-[11px] text-amber-800 leading-normal">
          The optimizer needs your ship levels, inventory and crafting level, which this plan does not carry.
        </p>
        <button
          type="button"
          class="px-2 py-1 text-xs rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          :disabled="store.saveLoading"
          @click="store.loadSave()"
        >
          {{ store.saveLoading ? 'Loading…' : 'Load my save' }}
        </button>
        <p v-if="store.saveError" class="w-full text-[11px] text-red-600">{{ store.saveError }}</p>
      </div>

      <p v-else class="text-[11px] text-gray-400 leading-normal">
        Ship levels, inventory and crafting level come from your save.
        <button
          type="button"
          class="text-blue-600 hover:text-blue-700 disabled:opacity-50"
          :disabled="store.saveLoading"
          @click="store.loadSave()"
        >
          {{ store.saveLoading ? 'Reloading…' : 'Reload it' }}
        </button>
        <span v-if="store.saveError" class="block text-red-600">{{ store.saveError }}</span>
      </p>

      <!-- What to aim for -->
      <section>
        <h4 class="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">
          Legendaries to aim for · H{{ current.visit.visitIndex + 1 }} of {{ current.visitCount }}
        </h4>
        <TargetSelector :model-value="settings.targetIds" label="" @update:model-value="setTargets" />
      </section>

      <!-- What the visit has to spend -->
      <section class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label for="humility-optimizer-time" class="block text-xs font-medium text-gray-700">Time on Humility</label>
          <div class="mt-1 flex items-center gap-1.5">
            <input
              id="humility-optimizer-time"
              type="text"
              :value="settings.duration"
              placeholder="e.g. 3d, 36h"
              class="block w-24 px-2 py-1 text-xs border rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              :class="timeRejected ? 'border-red-300' : 'border-gray-300'"
              @change="setDuration(($event.target as HTMLInputElement).value)"
            />
            <button
              v-for="preset in DURATION_PRESETS"
              :key="preset"
              type="button"
              class="px-1.5 py-1 text-[11px] rounded-md border"
              :class="
                settings.duration === preset
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              "
              @click="setDuration(preset)"
            >
              {{ preset }}
            </button>
          </div>
          <p class="mt-1 text-[11px] leading-normal" :class="timeRejected ? 'text-red-600' : 'text-gray-400'">
            {{
              timeRejected
                ? 'Enter a duration such as 3d or 36h.'
                : 'How long the three mission slots may be kept busy.'
            }}
          </p>
        </div>

        <div>
          <span class="block text-xs font-medium text-gray-700">Effort</span>
          <div class="mt-1 inline-flex rounded-md border border-gray-200 bg-white overflow-hidden" role="group">
            <button
              v-for="level in EFFORT_LEVELS"
              :key="level"
              type="button"
              class="px-2.5 py-1 text-[11px] border-r border-gray-200 last:border-r-0"
              :class="settings.effort === level ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'"
              :aria-pressed="settings.effort === level"
              @click="patch({ effort: level })"
            >
              {{ EFFORT_META[level].label }}
            </button>
          </div>
          <p class="mt-1 text-[11px] text-gray-400 leading-normal">{{ EFFORT_META[settings.effort].hint }}</p>
        </div>

        <div>
          <span class="block text-xs font-medium text-gray-700">Fuel</span>
          <div class="mt-1 inline-flex rounded-md border border-gray-200 bg-white overflow-hidden" role="group">
            <button
              v-for="option in FUEL_OPTIONS"
              :key="option.value"
              type="button"
              class="px-2.5 py-1 text-[11px] border-r border-gray-200 last:border-r-0"
              :class="
                settings.fuelBudget === option.value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              "
              :aria-pressed="settings.fuelBudget === option.value"
              @click="patch({ fuelBudget: option.value })"
            >
              {{ option.label }}
            </button>
          </div>
          <p class="mt-1 text-[11px] text-gray-400 leading-normal">
            <template v-if="settings.fuelBudget === 'banked'">
              {{
                stagedLaunch
                  ? 'Only what the tank holds here before the staged missions burn theirs'
                  : 'Only what is in the tank here'
              }}<template v-if="bankedFuel.length > 0">:</template>
              <span v-for="fuel in bankedFuel" :key="fuel.egg" class="inline-flex items-center gap-0.5 ml-1">
                <img :src="eggIcon(fuel.egg)" class="h-3 w-3" :alt="VIRTUE_EGG_NAMES[fuel.egg]" />
                {{ formatNumber(fuel.amount, 1) }}
              </span>
              <template v-if="bankedFuel.length === 0"> — which is nothing yet. Try a full tank.</template>
            </template>
            <template v-else>
              Plans against a full {{ formatNumber(tankCapacity, 0) }} tank. Staging adds the fuel stores to your
              earlier visits.
            </template>
          </p>
        </div>

        <div>
          <label for="humility-optimizer-gems" class="block text-xs font-medium text-gray-700">Ship price limit</label>
          <select
            id="humility-optimizer-gems"
            :value="settings.gemLimit"
            class="mt-1 block pl-2 pr-7 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            @change="patch({ gemLimit: ($event.target as HTMLSelectElement).value as GemLimit })"
          >
            <option value="plan">What this visit earns</option>
            <option value="unlimited">No limit</option>
          </select>
          <p class="mt-1 text-[11px] text-gray-400 leading-normal">
            <template v-if="settings.gemLimit === 'plan'">
              <template v-if="!timeInvalid">
                Only ships costing up to {{ formatNumber(gemBudget, 1) }} gems, the visit's earnings over that time.
              </template>
              <template v-else>Only ships the visit's earnings can pay for in that time.</template>
            </template>
            <template v-else>Any ship, however long it takes to afford.</template>
          </p>
        </div>

        <label
          v-if="store.player"
          class="sm:col-span-2 flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none"
        >
          <input
            type="checkbox"
            class="h-3.5 w-3.5 rounded text-blue-600 border-gray-300"
            :checked="settings.capCrafting"
            @change="patch({ capCrafting: ($event.target as HTMLInputElement).checked })"
          />
          Keep the crafting within my golden eggs ({{ formatNumber(store.player.goldenEggs, 1) }})
        </label>

        <OptimizerScheduleSettings class="sm:col-span-2" compact :model-value="settings" @update:model-value="patch" />
      </section>

      <!-- The answer -->
      <section class="rounded-md border border-gray-200 bg-white p-3">
        <p v-if="!store.player" class="text-xs text-gray-400">Load your save to find a ship set.</p>
        <p v-else-if="settings.targetIds.length === 0" class="text-xs text-gray-400">
          Pick at least one artifact above to find the best ship set for it.
        </p>
        <p v-else-if="timeInvalid" class="text-xs text-gray-400">Enter the time on Humility to find a ship set.</p>
        <p v-else-if="scheduleInvalid" class="text-xs text-gray-400">
          Enter the time left in the 2× capacity event to find a ship set.
        </p>
        <p v-else-if="error" class="text-xs text-red-600">Could not compute a ship set: {{ error }}</p>
        <p v-else-if="!shown && computing" role="status" class="flex items-center gap-2 text-xs text-gray-500">
          <InlineSpinner class="h-4 w-4 text-gray-400" />
          Finding the best ship set…
        </p>
        <p v-else-if="!shown" class="text-xs text-gray-400">No ship set yet.</p>

        <div v-else class="relative">
          <div class="space-y-3" :class="stale ? 'opacity-40 pointer-events-none transition-opacity' : ''">
            <p v-if="totalShips === 0" class="text-xs text-gray-500">
              No ship set fits these budgets. Try more time, a full tank, or no ship price limit.
            </p>

            <template v-else-if="view && projected">
              <div class="flex flex-wrap items-end gap-x-3 gap-y-1">
                <span class="text-2xl font-bold text-green-700 leading-none">
                  {{ formatProbabilityForDisplay(shown.solution.jointProbability) }}
                </span>
                <span class="text-xs text-gray-600 pb-0.5">
                  <template v-if="view.targets.length === 1">
                    chance of a legendary {{ view.targets[0].name }}
                  </template>
                  <template v-else>joint chance of all {{ view.targets.length }} legendaries</template>
                </span>
              </div>

              <ul v-if="view.targets.length > 1" class="flex flex-wrap gap-x-3 gap-y-1">
                <li
                  v-for="target in view.targets"
                  :key="target.nodeId"
                  class="flex items-center gap-1 text-[11px] text-gray-600"
                >
                  <img :src="target.iconUrl" class="h-4 w-4" alt="" />
                  {{ target.name }}
                  <span class="font-semibold text-green-700">
                    {{ formatProbabilityForDisplay(target.perTarget.bestProbability) }}
                  </span>
                </li>
              </ul>

              <!-- The same timeline and totals the explorer's card shows, here rather than under the breakdown,
                   since what to launch is what staging puts in the plan. -->
              <OptimizerLaunchPlan
                class="text-sm"
                :solution="shown.solution"
                heading-class="text-[10px] font-bold uppercase tracking-widest text-gray-400"
              />

              <dl class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div class="rounded bg-gray-50 px-2 py-1.5">
                  <dt class="text-gray-400">Ships</dt>
                  <dd class="font-semibold text-gray-800">{{ totalShips }}</dd>
                </div>
                <div class="rounded bg-gray-50 px-2 py-1.5">
                  <dt class="text-gray-400">Busiest slot</dt>
                  <dd class="font-semibold text-gray-800">
                    {{ formatDuration(projected.makespanSeconds) }}
                    <span class="font-normal text-gray-400">of {{ formatDuration(shown.timeSeconds) }}</span>
                  </dd>
                </div>
                <div class="rounded bg-gray-50 px-2 py-1.5">
                  <dt class="text-gray-400">Ship cost</dt>
                  <dd class="font-semibold text-gray-800">{{ formatNumber(projected.gemCost, 1) }} gems</dd>
                </div>
                <div class="rounded bg-gray-50 px-2 py-1.5">
                  <dt class="text-gray-400">Fuel</dt>
                  <dd class="font-semibold text-gray-800 flex flex-wrap gap-x-2">
                    <span v-for="fuel in fuelNeeds" :key="fuel.egg" class="inline-flex items-center gap-0.5">
                      <img :src="eggIcon(fuel.egg)" class="h-3 w-3" :alt="VIRTUE_EGG_NAMES[fuel.egg]" />
                      {{ formatNumber(fuel.amount, 1) }}
                    </span>
                    <span v-if="fuelNeeds.length === 0" class="font-normal text-gray-400">Humility only</span>
                  </dd>
                </div>
              </dl>

              <p v-if="fuelOverflow > 0" class="text-[11px] text-red-600 leading-normal">
                This ship set needs {{ formatNumber(fuelToStoreTotal, 1) }} more fuel than is banked, and the tank only
                has room for {{ formatNumber(current.tankFree, 1) }}.
                <template v-if="settings.fuelBudget === 'full-tank'">
                  A full tank assumes all of it can hold what these ships burn, and part of yours already holds fuel
                  they do not.
                </template>
                Make room in the Tank tab, give the visit less time, or plan with the banked fuel.
              </p>
              <p v-else-if="fuelToStore.length > 0" class="text-[11px] text-amber-700 leading-normal">
                {{ inPlan ? 'Stored for this launch:' : 'Not in the tank yet:' }}
                <span v-for="fuel in fuelToStore" :key="fuel.egg" class="inline-flex items-center gap-0.5 mr-1.5">
                  <img :src="eggIcon(fuel.egg)" class="h-3 w-3" :alt="VIRTUE_EGG_NAMES[fuel.egg]" />
                  {{ formatNumber(fuel.amount, 1) }}
                </span>
                <template v-if="inPlan">Staging put it in your earlier visits to those eggs.</template>
                <template v-else>
                  Staging stores it in your earlier visits to those eggs, or adds a visit where there is none.
                </template>
              </p>

              <p v-if="current.visit.visitIndex > 0" class="text-[11px] text-gray-400 leading-normal">
                Solved on its own: drops and crafts from earlier Humility visits are not counted, so this may ask for
                more than you still need.
              </p>

              <!-- Applying it -->
              <div class="border-t border-gray-100 pt-3 space-y-2">
                <p v-if="saving?.withEarningsSet !== undefined" class="text-[11px] text-gray-600 leading-normal">
                  Saving for these ships takes {{ formatDuration(saving.seconds) }} on the elr set,
                  {{ formatDuration(saving.withEarningsSet) }} on the earnings set.
                  <label class="ml-1 inline-flex items-center gap-1 cursor-pointer">
                    <input v-model="swapSet" type="checkbox" class="h-3 w-3 rounded text-blue-600 border-gray-300" />
                    Swap to the earnings set for the launch
                  </label>
                </p>
                <p v-else-if="saving && saving.seconds >= 60" class="text-[11px] text-gray-600">
                  The launch waits {{ formatDuration(saving.seconds) }} for the gems these ships cost.
                </p>

                <div class="flex flex-wrap items-center gap-2">
                  <span
                    v-if="inPlan"
                    class="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md border border-green-200 bg-green-50 text-green-700"
                  >
                    ✓ Staged in the plan
                  </span>
                  <button
                    v-else
                    type="button"
                    class="px-3 py-1.5 text-xs font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    :disabled="staging || stale || fuelOverflow > 0"
                    @click="stage"
                  >
                    {{ staging ? 'Staging…' : stagedLaunch ? 'Restage with this ship set' : 'Stage into plan' }}
                  </button>
                  <span v-if="stagedLaunch && !inPlan && fuelOverflow === 0" class="text-[11px] text-amber-700">
                    The plan has a different answer staged for this visit. Restaging replaces it.
                  </span>
                  <span v-else-if="inPlan" class="text-[11px] text-gray-500">
                    The launch, its fuel and the wait for the ships are in the action history.
                  </span>
                </div>
                <p v-if="stageError" class="text-[11px] text-red-600">{{ stageError }}</p>
                <p v-if="inPlan && missionsStore.drift.length > 0" class="text-[11px] text-red-600 leading-normal">
                  This planner charges different fuel than the optimizer assumed for
                  {{ missionsStore.drift.map(d => VIRTUE_EGG_NAMES[d.egg]).join(', ') }}. The plan uses this planner's
                  amounts.
                </p>
              </div>

              <details class="border-t border-gray-100 pt-2">
                <summary class="text-[11px] font-medium text-blue-600 hover:text-blue-700 cursor-pointer select-none">
                  Full breakdown: odds, crafts and expected drops
                </summary>
                <div class="mt-2">
                  <OptimizerSolutionCard
                    :solution="shown.solution"
                    :max-wait-time-seconds="shown.timeSeconds"
                    :has-inventory="true"
                    :golden-egg-balance="shown.player.goldenEggs"
                    :targets="view.targets"
                    :plan-cost="view.planCost"
                    :over-provisioned="current.visit.visitIndex > 0"
                    :show-launch-plan="false"
                  />
                </div>
              </details>
            </template>
          </div>

          <div v-if="stale && computing" role="status" class="absolute inset-0 flex items-start justify-center pt-6">
            <InlineSpinner class="h-6 w-6 text-gray-500" />
            <span class="sr-only">Finding the best ship set…</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';

import { fuelTankSizes, iconURL, virtueShipGemCosts } from 'lib';
import { finalizeSolutions, formatProbabilityForDisplay, solutionView } from 'lib/mission-optimizer';
import { createOptimizerClient, type OptimizerClient } from 'lib/mission-optimizer/optimizer-client';
import { EFFORT_LEVELS, EFFORT_META } from 'lib/mission-optimizer/effort';
import { gemBudgetFor, PlanSaveError } from 'lib/mission-optimizer/plan/read';
import { projectSolvedVisit } from 'lib/mission-optimizer/plan/write';
import { NON_HUMILITY_EGG_IDS } from 'lib/mission-optimizer/plan/schema';
import { scheduleArgsOf } from 'lib/mission-optimizer/schedule-settings';
import { getSimulationContext } from 'lib/planners/engine/adapter';
import { fuelForLaunches } from 'lib/planners/rockets/launches';
import InlineSpinner from 'ui/components/planners/InlineSpinner.vue';
import OptimizerLaunchPlan from 'ui/components/mission-optimizer/OptimizerLaunchPlan.vue';
import OptimizerScheduleSettings from 'ui/components/mission-optimizer/OptimizerScheduleSettings.vue';
import OptimizerSolutionCard from 'ui/components/mission-optimizer/OptimizerSolutionCard.vue';
import TargetSelector from 'ui/components/mission-optimizer/TargetSelector.vue';

import { useActionsStore } from '@/stores/actions';
import { useHumilityMissionsStore } from '@/stores/humilityMissions';
import { useHumilityOptimizerStore } from '@/stores/humilityOptimizer';
import { useInitialStateStore } from '@/stores/initialState';
import { usePlanStore } from '@/stores/plan';
import { formatDuration, formatNumber } from '@/lib/format';
import { HumilityMissionsError, launchSchedule, resolveLaunches } from '@/lib/humilityMissions';
import { humilitySourceTag, previewLaunchDurations } from '@/lib/humilityMissionsStage';
import {
  currentHumilityVisit,
  durationSeconds,
  type CurrentVisit,
  type FuelBudget,
  type GemLimit,
  type OptimizerVisitSettings,
} from '@/lib/humilityOptimizer';
import { buildRequest } from '@/lib/humilityOptimizerEngine';
import { VIRTUE_EGG_NAMES, type VirtueEgg } from '@/types';

const DURATION_PRESETS = ['1d', '3d', '7d', '14d'];
const FUEL_OPTIONS: { value: FuelBudget; label: string }[] = [
  { value: 'banked', label: 'Banked fuel' },
  { value: 'full-tank', label: 'Full tank' },
];

const store = useHumilityOptimizerStore();
const actionsStore = useActionsStore();
const initialStateStore = useInitialStateStore();
const planStore = usePlanStore();
const missionsStore = useHumilityMissionsStore();

const eggIcon = (egg: VirtueEgg) => iconURL(`egginc/egg_${egg}.png`, 64);

// ---------------------------------------------------------------------------
// The visit and what it is being solved for
// ---------------------------------------------------------------------------

// Read together, so a plan the reader rejects shows its message instead of an empty card.
const reading = computed<{ current: CurrentVisit | null; error: string }>(() => {
  try {
    const current = currentHumilityVisit(
      actionsStore.actions,
      actionsStore.actionsBeforeInsertion,
      initialStateStore.epicResearchLevels,
      {
        ascensionDate: planStore.ascensionDate,
        ascensionTime: planStore.ascensionTime,
        ascensionTimezone: planStore.ascensionTimezone,
      }
    );
    return { current, error: '' };
  } catch (err) {
    if (!(err instanceof PlanSaveError)) throw err;
    return { current: null, error: `This plan cannot be read for the optimizer: ${err.message}` };
  }
});
const current = computed(() => reading.value.current);
const visitError = computed(() => reading.value.error);

const settings = computed<OptimizerVisitSettings | null>(() =>
  current.value ? store.settingsFor(current.value.visit) : null
);

function patch(change: Partial<OptimizerVisitSettings>) {
  if (current.value) store.update(current.value.visit, change);
}
const setTargets = (targetIds: string[]) => patch({ targetIds });
const setDuration = (duration: string) => patch({ duration: duration.trim() });

const timeSeconds = computed(() => (settings.value ? durationSeconds(settings.value.duration) : NaN));
const timeInvalid = computed(() => !Number.isFinite(timeSeconds.value));
// Typed, and not a duration: an empty field is only unanswered.
const timeRejected = computed(() => timeInvalid.value && (settings.value?.duration ?? '') !== '');

const bankedFuel = computed(() => {
  const visit = current.value?.visit;
  if (!visit) return [];
  return NON_HUMILITY_EGG_IDS.map(([egg, id]) => ({ egg, amount: visit.fuelByEgg.get(id) ?? 0 })).filter(
    fuel => fuel.amount > 0
  );
});
const tankCapacity = computed(() => fuelTankSizes[current.value?.visit.tankLevel ?? 0] ?? 0);
const gemBudget = computed(() => (current.value ? gemBudgetFor(current.value.visit, timeSeconds.value) : NaN));

// ---------------------------------------------------------------------------
// Solving
// ---------------------------------------------------------------------------

// The meaning of the inputs, not their identity: the visit is rebuilt on every plan edit, and only a
// change to what it has to spend should cost a solve.
const questionKey = computed(() => {
  const visit = current.value?.visit;
  const asked = settings.value;
  if (!visit || !asked || !store.player) return '';
  return JSON.stringify({
    visit: visit.visitId,
    settings: asked,
    // A full tank is solved against the tank's size, whatever it holds.
    fuel: asked.fuelBudget === 'banked' ? [...visit.fuelByEgg] : null,
    tank: visit.tankLevel,
    // The price limit only decides which ships are on the menu, so two budgets that afford the same
    // ships pose the same question. Staging nudges the visit's earnings; this keeps that from
    // re-solving, and possibly replacing, the answer that was just staged.
    ships:
      asked.gemLimit === 'plan'
        ? Object.values(virtueShipGemCosts).filter(price => price <= gemBudget.value).length
        : null,
    ftl: visit.epicResearchFTLLevel,
    zerog: visit.epicResearchZerogLevel,
    save: store.playerRevision,
  });
});
// The event's "time left" is the one schedule setting that can be typed wrong.
const scheduleInvalid = computed(() => settings.value !== null && scheduleArgsOf(settings.value) === null);
const posed = computed(
  () =>
    questionKey.value !== '' &&
    !timeInvalid.value &&
    !scheduleInvalid.value &&
    (settings.value?.targetIds.length ?? 0) > 0
);

const computing = ref(false);
const error = ref('');

// Lazy, so opening the panel on a visit with nothing to solve starts no worker.
let client: OptimizerClient | null = null;
let generation = 0;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

async function solve() {
  const mine = ++generation;
  const visit = current.value?.visit;
  const asked = settings.value;
  const player = store.player;
  const key = questionKey.value;
  if (!visit || !asked || !player) {
    computing.value = false;
    return;
  }
  try {
    const request = buildRequest(visit, asked, player);
    if (!request) return;
    const solutions = await (client ??= createOptimizerClient()).run(request.input);
    if (mine !== generation) return;
    // Null is "no result is coming": superseded, or the worker was torn down.
    if (solutions === null) return;
    const [solution] = finalizeSolutions(solutions, request.input.recipeDag);
    if (!solution) throw new Error('the optimizer returned no plan');
    store.solved = {
      visitId: visit.visitId,
      key,
      solution,
      timeSeconds: request.timeSeconds,
      gemBudget: request.gemBudget,
      effort: asked.effort,
      player,
    };
  } catch (err) {
    if (mine !== generation) return;
    error.value = err instanceof Error ? err.message : String(err);
    store.solved = null;
  } finally {
    if (mine === generation) computing.value = false;
  }
}

watch(
  [questionKey, posed],
  () => {
    // Retire a running request before its debounced replacement starts.
    ++generation;
    clearTimeout(debounceTimer);
    error.value = '';
    // An answer kept from before the tab was switched away still stands if the question does.
    computing.value = posed.value && store.solved?.key !== questionKey.value;
    if (computing.value) debounceTimer = setTimeout(solve, 250);
    // From here on the visit keeps what it was asked, whatever another visit's choices do to the defaults.
    if (posed.value && current.value) store.pin(current.value.visit);
  },
  { immediate: true }
);

onUnmounted(() => {
  ++generation;
  clearTimeout(debounceTimer);
  client?.terminate();
});

// The last answer for this visit, shown dimmed while a newer question is being solved.
const shown = computed(() => {
  const solved = store.solved;
  return posed.value && solved && solved.visitId === current.value?.visit.visitId ? solved : null;
});
const stale = computed(() => shown.value !== null && shown.value.key !== questionKey.value);

const view = computed(() => (shown.value ? solutionView(shown.value.solution, shown.value.player.inventory) : null));

// The same projection the explorer writes to its humility missions file, so staging takes the one path.
const projected = computed(() => {
  const visit = current.value?.visit;
  if (!visit || !shown.value) return null;
  const { solution, effort, gemBudget: budget } = shown.value;
  return projectSolvedVisit({ visit, solution, effort, gemBudget: budget });
});
const launches = computed(() => (projected.value ? resolveLaunches(projected.value) : []));
const totalShips = computed(() => launches.value.reduce((sum, launch) => sum + launch.count, 0));

// At this planner's own fuel table, which is what the launch will actually be charged.
const fuelNeeds = computed(() => {
  const required = fuelForLaunches(launches.value);
  return NON_HUMILITY_EGG_IDS.map(([egg]) => ({ egg, amount: required[egg] })).filter(fuel => fuel.amount > 0);
});
const fuelToStore = computed(() => {
  const visit = current.value?.visit;
  if (!visit) return [];
  const banked = new Map(NON_HUMILITY_EGG_IDS.map(([egg, id]) => [egg, visit.fuelByEgg.get(id) ?? 0]));
  return (
    fuelNeeds.value
      .map(need => ({ egg: need.egg, need: need.amount, amount: need.amount - (banked.get(need.egg) ?? 0) }))
      // Relative, so rounding in a fuel total that exactly empties the tank does not read as a shortfall.
      .filter(fuel => fuel.amount > fuel.need * 1e-9)
  );
});

const fuelToStoreTotal = computed(() => fuelToStore.value.reduce((sum, fuel) => sum + fuel.amount, 0));
// How far the stores this ship set needs overshoot the room the tank has for them. Known before staging
// tries, so the card can say why rather than let it fail on the tank check.
const fuelOverflow = computed(() => {
  const free = current.value?.tankFree ?? 0;
  const over = fuelToStoreTotal.value - free;
  return over > fuelToStoreTotal.value * 1e-9 ? over : 0;
});

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

// How long the plan waits for the gems before the ships can go, on the set it has on and, where a swap
// can be offered, on the earnings set. The launch's own duration is that wait plus the flight.
const saving = computed(() => {
  if (!projected.value || totalShips.value === 0) return null;
  try {
    const context = getSimulationContext();
    const durations = previewLaunchDurations(actionsStore.actions, projected.value, context);
    if (!durations) return null;
    const flight = launchSchedule(launches.value, context.epicResearchLevels['afx_mission_time'] ?? 0).totalSeconds;
    return {
      seconds: Math.max(0, durations.seconds - flight),
      withEarningsSet:
        durations.withEarningsSet === undefined ? undefined : Math.max(0, durations.withEarningsSet - flight),
    };
  } catch {
    return null;
  }
});

// Ticked whenever the swap is faster; the player can untick it to keep the plan's set.
const swapChoice = ref<boolean | null>(null);
const swapSet = computed({
  get: () => {
    if (swapChoice.value !== null) return swapChoice.value;
    const wait = saving.value;
    return wait?.withEarningsSet !== undefined && wait.withEarningsSet < wait.seconds;
  },
  set: value => {
    swapChoice.value = value;
  },
});
watch(
  () => current.value?.visit.visitId,
  () => {
    swapChoice.value = null;
  }
);

const stagedLaunch = computed(() => {
  const visit = current.value?.visit;
  if (!visit) return null;
  const tag = humilitySourceTag(visit.visitId);
  for (const action of actionsStore.actions) {
    if (action.sourceTag === tag && action.type === 'launch_missions') return action;
  }
  return null;
});

// Whether the plan already holds this answer, so the card can say so instead of offering to stage what is
// there. The same ships can answer two questions, a different effort for one, and those differ in the wait
// staged after the launch, so an answer staged in this session is also matched on what it was asked.
const inPlan = computed(() => {
  const visit = current.value?.visit;
  if (!visit || !shown.value || !stagedLaunch.value || launches.value.length === 0) return false;
  const signature = (
    missions: readonly { ship: number; duration: number; count: number; targetAfxId?: number; doubled?: true }[]
  ) =>
    missions
      .map(m => `${m.ship}|${m.duration}|${m.targetAfxId ?? ''}|${m.doubled ? 2 : 1}|${m.count}`)
      .sort()
      .join(',');
  if (signature(stagedLaunch.value.payload.missions) !== signature(launches.value)) return false;
  const staged = store.stagedAnswers[visit.visitId];
  return !staged || (staged.key === shown.value.key && staged.swap === swapSet.value);
});

const staging = ref(false);
const stageError = ref('');
watch(questionKey, () => {
  stageError.value = '';
});

async function stage() {
  if (!projected.value || !shown.value || staging.value) return;
  staging.value = true;
  stageError.value = '';
  try {
    const swap = swapSet.value;
    const { visitId, key } = shown.value!;
    await missionsStore.stage(projected.value, { equipEarningsSet: swap });
    store.stagedAnswers[visitId] = { key, swap };
  } catch (err) {
    stageError.value = err instanceof HumilityMissionsError ? err.message : (err as Error).message;
  } finally {
    staging.value = false;
  }
}
</script>
