<template>
  <div class="space-y-5">
    <section>
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Player data</h3>
      <player-id-form :player-id="playerId" @submit="$emit('submitPlayerId', $event)" />
      <div class="flex items-center gap-1.5 text-xs">
        <span class="h-2 w-2 rounded-full flex-shrink-0" :class="hasPlayerData ? 'bg-green-500' : 'bg-gray-300'"></span>
        <span :class="hasPlayerData ? 'text-gray-600' : 'text-gray-400'">
          {{ hasPlayerData ? 'Save data loaded' : 'No save loaded — using manual settings' }}
        </span>
      </div>
    </section>

    <section>
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Ascension plan</h3>
      <div class="space-y-2">
        <label
          class="w-full flex items-center justify-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm rounded-md text-gray-600 bg-gray-100 hover:bg-gray-200 cursor-pointer"
        >
          {{ plan ? 'Load another plan…' : 'Load ascension plan…' }}
          <input type="file" accept=".json,application/json" class="hidden" @change="onPlanFilePicked" />
        </label>

        <p v-if="planLoadError" class="text-xs text-red-500">{{ planLoadError }}</p>

        <template v-if="plan">
          <div class="text-sm text-gray-700 truncate">{{ plan.label }}</div>

          <div>
            <label for="planVisitSelect" class="block text-sm text-gray-700">Visit</label>
            <select
              id="planVisitSelect"
              class="mt-1 block w-full pl-3 pr-8 py-1.5 sm:text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              :value="planVisit ? planVisit.visitId : ''"
              @change="onVisitPicked(($event.target as HTMLSelectElement).value)"
            >
              <!-- Off the plan: every budget goes back to the save's, and the plan stays loaded. -->
              <option value="">-</option>
              <option v-for="option in visitOptions" :key="option.visitId" :value="option.visitId">
                {{ option.text }}
              </option>
            </select>
          </div>

          <button
            type="button"
            :disabled="solvedCount === 0 || exportBlocked"
            class="w-full flex items-center justify-center px-3 py-1.5 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            @click="onExportPlan"
          >
            Export {{ solvedCount }} solved visit{{ solvedCount === 1 ? '' : 's' }}
          </button>

          <button
            type="button"
            class="w-full flex items-center justify-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm rounded-md text-gray-600 bg-white hover:bg-gray-100"
            @click="onUnloadPlan"
          >
            Unload plan
          </button>
        </template>

        <p v-else class="text-xs text-gray-400">
          Solve a cycle's Humility visits against the budgets the plan says you will have at each of them.
        </p>
      </div>
    </section>

    <section>
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Constraints</h3>
      <div class="space-y-3">
        <div>
          <label for="waitTimeInput" class="block text-sm text-gray-700">Time budget</label>
          <base-input
            id="waitTimeInput"
            :model-value="waitTimeDraft"
            type="text"
            name="waitTimeInput"
            class="mt-1 appearance-none block w-full px-3 py-1.5 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            placeholder="e.g. 30, 12d12h, 10h5m"
            @update:model-value="onWaitTimeInput"
            @blur="onWaitTimeBlur"
          />
          <p v-if="timeBudgetInvalid" class="mt-1 text-xs text-red-500">
            Enter a positive duration (e.g. 30, 12d12h, 10h5m)
          </p>
          <!-- Not chained off the error above: a visit with nothing scheduled reports zero, which
               empties this field and so is exactly the case the error fires on. Saying only
               "enter a positive duration" there leaves the player with no idea why the plan gave
               them nothing to start from. -->
          <p v-if="planVisit" class="mt-1 text-xs text-gray-400">
            From plan: how long this visit stays on Humility. The plan reports zero until the visit has missions
            scheduled, so type one over it.
          </p>
          <p v-else-if="!timeBudgetInvalid" class="mt-1 text-xs text-gray-400">
            Maximum time you're willing to spend launching missions
          </p>
        </div>

        <div>
          <span class="text-sm text-gray-600">Effort</span>
          <div
            ref="effortTrack"
            role="slider"
            tabindex="0"
            aria-label="Effort"
            :aria-valuemin="0"
            :aria-valuemax="EFFORT_LEVELS.length - 1"
            :aria-valuenow="effortIndex"
            :aria-valuetext="effortMeta[missionFilters.effort].label"
            class="relative mt-2 h-6 cursor-pointer select-none touch-none focus:outline-none"
            @pointerdown="onTrackPointerDown"
            @pointermove="onTrackPointerMove"
            @pointerup="onTrackPointerUp"
            @pointercancel="onTrackPointerUp"
            @keydown="onTrackKeydown"
          >
            <div ref="effortRail" class="absolute inset-x-2 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-gray-200">
              <div
                class="absolute left-0 top-0 h-full rounded-full bg-green-500"
                :style="{ width: `${(effortIndex / (EFFORT_LEVELS.length - 1)) * 100}%` }"
              ></div>
              <span
                v-for="(lvl, i) in EFFORT_LEVELS"
                :key="lvl"
                class="absolute top-1/2 rounded-full border-2 -translate-x-1/2 -translate-y-1/2 transition-all"
                :class="[
                  i === effortIndex
                    ? 'h-4 w-4 border-green-600 bg-white shadow ring-1 ring-green-600/20'
                    : i < effortIndex
                      ? 'h-3 w-3 border-green-500 bg-green-500'
                      : 'h-3 w-3 border-gray-300 bg-white',
                ]"
                :style="{ left: `${(i / (EFFORT_LEVELS.length - 1)) * 100}%` }"
              ></span>
            </div>
          </div>
          <div class="mt-1 flex items-baseline justify-between">
            <span
              v-for="lvl in EFFORT_LEVELS"
              :key="'lbl-' + lvl"
              :class="lvl === missionFilters.effort ? 'text-sm font-bold text-gray-900' : 'text-[11px] text-gray-400'"
              >{{ effortMeta[lvl].short }}</span
            >
          </div>
          <p class="mt-1 text-xs text-gray-400">{{ effortMeta[missionFilters.effort].hint }}</p>
        </div>

        <div>
          <label for="gemCostMode" class="block text-sm text-gray-600">Maximum purchase cost</label>
          <select
            id="gemCostMode"
            :value="gemCostMode"
            class="mt-1 block w-full pl-3 pr-8 py-1.5 sm:text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            @change="onGemModeChange"
          >
            <option v-if="planVisit" value="plan">From plan</option>
            <option value="custom">Override</option>
            <option value="unlimited">Unlimited</option>
          </select>
          <div v-if="gemCostMode !== 'unlimited'" class="mt-1 flex items-center gap-2">
            <input
              type="text"
              aria-label="Maximum purchase cost in gems"
              :disabled="gemCostMode !== 'custom'"
              :value="gemCostFieldValue"
              placeholder="e.g. 10S"
              class="block w-24 sm:text-sm rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 px-2 py-1 border border-gray-300 disabled:bg-gray-50 disabled:text-gray-400"
              @input="setGemCostInput(($event.target as HTMLInputElement).value)"
              @blur="normalizeGemCost"
            />
            <span class="text-xs text-gray-500">gems</span>
          </div>
          <!-- An unparseable draft is not silently swapped for the last good number: it stops the
               solve and says so, rather than answering a question nobody asked. -->
          <p v-if="gemCostInvalid" class="mt-1 text-xs text-red-500">
            Enter a non-negative amount (e.g. 10S). Nothing is computed until this is corrected.
          </p>
          <p v-else-if="gemCostMode === 'custom'" class="mt-1 text-xs text-gray-400">
            Only schedule ships costing at most this many gems (e.g. 10S = 10 septillion)
          </p>
          <p v-else-if="gemCostMode === 'plan'" class="mt-1 text-xs text-gray-400">
            From plan: the bank on arrival plus what the visit earns, capping one ship rather than the whole visit. Pick
            "Set my own" to override it.
          </p>
        </div>

        <div>
          <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              class="h-4 w-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
              :checked="missionFilters.maxGoldenEggCostEnabled"
              @change="setMaxGoldenEggCostEnabled(($event.target as HTMLInputElement).checked)"
            />
            Maximum crafting cost
          </label>
          <div class="mt-1 flex items-center gap-2">
            <input
              type="text"
              aria-label="Maximum crafting cost in golden eggs"
              :disabled="!missionFilters.maxGoldenEggCostEnabled"
              :value="craftingCostInput"
              placeholder="e.g. 25M"
              class="block w-24 sm:text-sm rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 px-2 py-1 border border-gray-300 disabled:bg-gray-50 disabled:text-gray-400"
              @input="setCraftingCostInput(($event.target as HTMLInputElement).value)"
              @blur="normalizeCraftingCost"
            />
            <!-- The unit lives in the input's aria-label; the icon repeats it visually. -->
            <base-icon
              icon-rel-path="egginc-extras/icon_golden_egg.png"
              :size="64"
              class="h-4 w-4"
              aria-hidden="true"
            />
          </div>
          <p v-if="craftingCostInvalid" class="mt-1 text-xs text-red-500">
            Enter a non-negative amount (e.g. 25M). Nothing is computed until this is corrected.
          </p>
          <p v-else-if="missionFilters.maxGoldenEggCostEnabled" class="mt-1 text-xs text-gray-400">
            Cap the golden eggs the plan's crafts may cost, at your own crafting prices
          </p>
          <p v-else-if="playerGoldenEggs !== null" class="mt-1 text-xs text-gray-400">
            Your balance, until you turn this on and set your own
          </p>
        </div>

        <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            id="sidebar_show_nodata"
            v-model="config.showNodata"
            type="checkbox"
            class="h-4 w-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
          />
          Show targets with no data
        </label>
      </div>
    </section>

    <section>
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Settings</h3>
      <div class="divide-y divide-gray-100">
        <optimizer-setting-row
          label="Crafting level"
          :has-save="playerCraftingLevel !== null"
          :overridden="overrides.craftingLevel"
          :save-value="playerCraftingLevel"
          :manual-value="extras.craftingLevel"
          :min="0"
          :max="30"
          max-label="/ 30"
          @update:overridden="setOverrideCraftingLevel"
          @update:manual="setCraftingLevel"
        />
        <optimizer-setting-row
          label="Previous crafts"
          :has-save="playerPreviousCrafts !== null"
          :overridden="overrides.previousCrafts"
          :save-value="playerPreviousCrafts"
          :save-entries="previousCraftEntries"
          :manual-value="extras.previousCrafts"
          :min="0"
          hint="Applies to every selected target."
          @update:overridden="setOverridePreviousCrafts"
          @update:manual="setPreviousCraftCount"
        />
        <!-- Capacity stops feeding the model once the per-egg budget is on, so the
             control goes inert rather than staying live and changing nothing. -->
        <div :class="perEggBudget ? 'opacity-40 pointer-events-none' : ''">
          <optimizer-setting-row
            label="Fuel tank level"
            :has-save="sourceTankLevel !== null"
            :source-label="planSourceLabel"
            :overridden="overrides.tankLevel"
            :save-value="sourceTankLevel"
            :manual-value="extras.tankLevel"
            :min="0"
            :max="maxTankLevel"
            :max-label="`/ ${maxTankLevel}`"
            :capacity="tankCapacityLabel"
            @update:overridden="setOverrideTankLevel"
            @update:manual="setTankLevel"
          />
        </div>
        <div v-if="canBudgetPerEgg" class="py-2">
          <label class="flex items-start gap-2 text-sm select-none text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              class="mt-0.5 h-4 w-4 shrink-0 text-green-600 border-gray-300 rounded focus:ring-green-500"
              :checked="perEggBudget"
              @change="writePerEggBudget(($event.target as HTMLInputElement).checked)"
            />
            <span>
              Only use fuel in tank
              <span class="block text-xs text-gray-500">
                {{
                  planVisit
                    ? 'Budget against what the plan banks here, egg by egg. Off, the answer may spend the whole tank and say how much of each egg to go store.'
                    : 'Budget against what you have stocked right now, egg by egg, instead of a full tank.'
                }}
              </span>
            </span>
          </label>
          <ul v-if="perEggBudget" class="mt-2 pl-6 space-y-0.5">
            <li v-for="entry of perEggBudgetEntries" :key="'tank-' + entry.egg" class="flex items-center text-xs">
              <base-icon :icon-rel-path="entry.icon" :size="64" class="h-4 w-4 mr-1"></base-icon>
              <span class="text-gray-500">{{ entry.name }}</span>
              <span class="ml-auto tabular-nums" :class="entry.empty ? 'text-red-500' : 'text-gray-700'">
                {{ entry.amount }}
              </span>
            </li>
          </ul>
        </div>
        <optimizer-setting-row
          label="FTL Drive Upgrades"
          :has-save="sourceFTLLevel !== null"
          :source-label="planSourceLabel"
          :overridden="overrides.epicResearchFTLLevel"
          :save-value="sourceFTLLevel"
          :manual-value="config.epicResearchFTLLevel"
          :min="0"
          :max="60"
          max-label="/ 60"
          @update:overridden="setOverrideFTL"
          @update:manual="setEpicResearchFTLLevel"
        />
        <optimizer-setting-row
          label="Zero-g Quantum Containment"
          :has-save="sourceZerogLevel !== null"
          :source-label="planSourceLabel"
          :overridden="overrides.epicResearchZerogLevel"
          :save-value="sourceZerogLevel"
          :manual-value="config.epicResearchZerogLevel"
          :min="0"
          :max="10"
          max-label="/ 10"
          @update:overridden="setOverrideZerog"
          @update:manual="setEpicResearchZerogLevel"
        />
      </div>
    </section>

    <section>
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Ships</h3>
      <div class="text-sm text-gray-600 mb-2">{{ shipsVisibleCount }} of {{ totalShips }} ships visible</div>
      <button
        type="button"
        class="w-full flex items-center justify-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm rounded-md text-gray-600 bg-gray-100 hover:bg-gray-200 focus:outline-none"
        @click="openPlayerOverridesModal"
      >
        Edit ships…
      </button>
    </section>

    <loot-data-credit />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue';

import {
  eggIconPath,
  eggName,
  formatDuration,
  ei,
  formatEIValue,
  fuelTankSizes,
  getArtifactTierPropsFromId,
  isDurationNormalizable,
  parseDurationDays,
  spaceshipList,
} from 'lib';
import BaseIcon from 'ui/components/BaseIcon.vue';
import BaseInput from 'ui/components/BaseInput.vue';
import PlayerIdForm from 'ui/components/PlayerIdForm.vue';
import LootDataCredit from '@/components/LootDataCredit.vue';
import OptimizerSettingRow from './OptimizerSettingRow.vue';

import {
  config,
  currentOptimizerArtifactIds,
  effectiveMaxGemCost,
  gemCostMode,
  gemCostInput,
  gemCostInvalid,
  craftingCostInput,
  craftingCostInvalid,
  setGemCostMode,
  setGemCostInput,
  setCraftingCostInput,
  effectiveConfig,
  effectiveFuelByEggCapacity,
  EFFORT_LEVELS,
  type EffortLevel,
  extras,
  missionFilters,
  openPlayerOverridesModal,
  overrides,
  playerCraftingLevel,
  playerGoldenEggs,
  playerPreviousCrafts,
  playerPreviousCraftsByArtifact,
  playerShipsConfig,
  playerTankFuels,
  playerTankLevel,
  setCraftingLevel,
  setEffort,
  setEpicResearchFTLLevel,
  setEpicResearchZerogLevel,
  setFuelFromTankContents,
  setMaxGoldenEggCostEnabled,
  setOverrideCraftingLevel,
  setOverrideFTL,
  setOverridePreviousCrafts,
  setOverrideTankLevel,
  setOverrideZerog,
  setPreviousCraftCount,
  setTankLevel,
} from '@/store';
import {
  activePlanVisit,
  activeVisitSettings,
  clearLoadedPlan,
  type GemCostMode,
  loadedPlan,
  setCurrentVisit,
  setLoadedPlan,
  setVisitFuelBudget,
  solvedVisitCount,
} from '@/store/plan';
import { parsePlanSave, PlanSaveError, sliceHumilityVisits } from '@/lib/plan/read';
import { normalizeBudgetInput } from '@/store/budget-input';
import { buildHumilityPlanFile } from '@/lib/plan/write';

function downloadJson(filename: string, body: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const effortMeta: Record<EffortLevel, { short: string; label: string; hint: string }> = {
  low: {
    short: 'Low',
    label: 'Low',
    hint: 'One launch per slot per day — favors long, low-maintenance missions.',
  },
  medium: {
    short: 'Med',
    label: 'Medium',
    hint: 'Two launches per slot per day.',
  },
  high: {
    short: 'High',
    label: 'High',
    hint: 'One launch per slot per hour.',
  },
  max: {
    short: 'Max',
    label: 'Max',
    hint: 'No launch limit — relaunch the instant a mission lands.',
  },
};

export default defineComponent({
  components: { BaseIcon, BaseInput, PlayerIdForm, LootDataCredit, OptimizerSettingRow },
  props: {
    playerId: { type: String, default: '' },
    exportBlocked: { type: Boolean, default: false },
    waitTimeDays: { type: String, required: true },
    timeBudgetInvalid: { type: Boolean, default: false },
  },
  emits: {
    submitPlayerId: (_id: string) => true,
    'update:waitTimeDays': (_days: string) => true,
  },
  setup(props, { emit }) {
    const waitTimeDraft = ref(props.waitTimeDays);
    watch(
      () => props.waitTimeDays,
      v => {
        waitTimeDraft.value = v;
      }
    );

    function onWaitTimeInput(value: string) {
      waitTimeDraft.value = value;
      emit('update:waitTimeDays', value);
    }

    // Every per-visit setting writes the same way: the visit's own field while one is open, the
    // global filter otherwise. One helper, so a setting added later cannot be the one that forgets
    // and writes the global filter out from under an open visit.
    function writeVisitOrGlobal<T>(setVisit: (visitId: string, value: T) => void, setGlobal: (value: T) => void) {
      return (value: T) => {
        const visit = activePlanVisit.value;
        if (visit) setVisit(visit.visitId, value);
        else setGlobal(value);
      };
    }

    function onWaitTimeBlur() {
      if (!isDurationNormalizable(waitTimeDraft.value)) {
        // keep the text as typed rather than overwrite it with e.g. '>100yr'
        return;
      }
      const normalized = formatDuration(parseDurationDays(waitTimeDraft.value), true);
      waitTimeDraft.value = normalized;
      if (!activePlanVisit.value || activeVisitSettings.value?.waitTimeOverride !== null)
        emit('update:waitTimeDays', normalized);
    }

    const maxTankLevel = fuelTankSizes.length - 1;
    const hasPlayerData = computed(() => !!playerShipsConfig.value);

    const previousCraftEntries = computed(() =>
      currentOptimizerArtifactIds.value
        .filter(id => playerPreviousCraftsByArtifact.value.has(id))
        .map(id => ({
          id,
          label: getArtifactTierPropsFromId(id).name,
          value: playerPreviousCraftsByArtifact.value.get(id)!,
        }))
    );

    // A plan visit's figures beat the save's wherever it has one — it simulates a moment the save
    // knows nothing about — and the manual override still beats both. The rows say which of the two
    // they are showing rather than both claiming to come from the save.
    const planSourceLabel = computed(() => (activePlanVisit.value ? 'from plan' : 'save'));

    const sourceTankLevel = computed(() => activePlanVisit.value?.tankLevel ?? playerTankLevel.value);
    const sourceFTLLevel = computed(
      () => activePlanVisit.value?.epicResearchFTLLevel ?? playerShipsConfig.value?.epicResearchFTLLevel ?? null
    );
    const sourceZerogLevel = computed(
      () => activePlanVisit.value?.epicResearchZerogLevel ?? playerShipsConfig.value?.epicResearchZerogLevel ?? null
    );
    const shownTankLevel = computed(() => {
      const editable = sourceTankLevel.value === null || overrides.value.tankLevel;
      return editable ? extras.value.tankLevel : sourceTankLevel.value;
    });
    const tankCapacityLabel = computed(() => formatEIValue(fuelTankSizes[shownTankLevel.value] ?? 0, { trim: true }));

    // Per-egg amounts to budget against: the plan's bank on arrival at a visit, the save's tank
    // otherwise. Without either there is nothing to budget against and the control would be a dead
    // toggle, which is why it is not rendered at all then.
    const perEggBudgetSource = computed<Map<ei.Egg, number> | null>(
      () => activePlanVisit.value?.fuelByEgg ?? playerTankFuels.value
    );
    const canBudgetPerEgg = computed(() => perEggBudgetSource.value !== null);
    // The store's gate is the one the solver runs against; restating it here is how the checkbox
    // and the answer drift apart.
    const perEggBudget = computed(() => effectiveFuelByEggCapacity.value !== null);

    const writePerEggBudget = writeVisitOrGlobal<boolean>(
      (visitId, enabled) => setVisitFuelBudget(visitId, enabled ? 'banked' : 'full-tank'),
      setFuelFromTankContents
    );

    const perEggBudgetEntries = computed(() =>
      [...(perEggBudgetSource.value ?? new Map<ei.Egg, number>())].map(([egg, amount]) => ({
        egg,
        name: eggName(egg),
        icon: eggIconPath(egg),
        amount: formatEIValue(amount, { trim: true }),
        empty: amount <= 0,
      }))
    );

    const totalShips = spaceshipList.length;
    const shipsVisibleCount = computed(() => spaceshipList.filter(s => effectiveConfig.value.shipVisibility[s]).length);

    const effortTrack = ref<HTMLElement | null>(null);
    const effortRail = ref<HTMLElement | null>(null);
    const dragging = ref(false);
    const effortIndex = computed(() => Math.max(0, EFFORT_LEVELS.indexOf(missionFilters.value.effort)));

    function setEffortByIndex(i: number) {
      const clamped = Math.min(EFFORT_LEVELS.length - 1, Math.max(0, i));
      setEffort(EFFORT_LEVELS[clamped]);
    }

    // Measure against the rail, not the outer track: the notch centers sit at
    // the rail's 0%/100%.
    function selectFromClientX(clientX: number) {
      const rect = (effortRail.value ?? effortTrack.value)?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const ratio = (clientX - rect.left) / rect.width;
      setEffortByIndex(Math.round(ratio * (EFFORT_LEVELS.length - 1)));
    }

    function onTrackPointerDown(e: PointerEvent) {
      e.preventDefault();
      effortTrack.value?.focus();
      effortTrack.value?.setPointerCapture?.(e.pointerId);
      dragging.value = true;
      selectFromClientX(e.clientX);
    }
    function onTrackPointerMove(e: PointerEvent) {
      if (!dragging.value) return;
      selectFromClientX(e.clientX);
    }
    function onTrackPointerUp(e: PointerEvent) {
      dragging.value = false;
      effortTrack.value?.releasePointerCapture?.(e.pointerId);
    }
    function onTrackKeydown(e: KeyboardEvent) {
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          setEffortByIndex(effortIndex.value - 1);
          break;
        case 'ArrowRight':
        case 'ArrowUp':
          setEffortByIndex(effortIndex.value + 1);
          break;
        case 'Home':
          setEffortByIndex(0);
          break;
        case 'End':
          setEffortByIndex(EFFORT_LEVELS.length - 1);
          break;
        default:
          return;
      }
      e.preventDefault();
    }

    const onGemModeChange = (event: Event) => setGemCostMode((event.target as HTMLSelectElement).value as GemCostMode);
    const normalizeGemCost = () => setGemCostInput(normalizeBudgetInput(gemCostInput.value));
    const normalizeCraftingCost = () => setCraftingCostInput(normalizeBudgetInput(craftingCostInput.value));
    const gemCostFieldValue = computed(() =>
      gemCostMode.value === 'custom'
        ? gemCostInput.value
        : formatEIValue(effectiveMaxGemCost.value ?? 0, { trim: true })
    );

    // ---------------------------------------------------------------------
    // The loaded ascension plan
    // ---------------------------------------------------------------------

    const planLoadError = ref('');

    async function onPlanFilePicked(event: Event) {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      // Cleared so picking the same file twice in a row still fires a change event.
      input.value = '';
      if (!file) return;
      planLoadError.value = '';
      try {
        const save = parsePlanSave(JSON.parse(await file.text()));
        setLoadedPlan(file.name.replace(/\.json$/i, ''), sliceHumilityVisits(save));
      } catch (err) {
        planLoadError.value =
          err instanceof PlanSaveError ? err.message : `Could not read that file: ${(err as Error).message}`;
      }
    }

    // `✓ H2 of 3`: the tick is a recorded answer, and the count is what places a visit in its cycle
    // now that no page lists them.
    const visitOptions = computed(() => {
      const plan = loadedPlan.value;
      if (!plan) return [];
      return plan.visits.map(visit => ({
        visitId: visit.visitId,
        text: `${plan.solved[visit.visitId] ? '✓ ' : ''}H${visit.visitIndex + 1} of ${plan.visits.length}`,
      }));
    });

    function onVisitPicked(visitId: string) {
      // Whatever is on screen seeds a visit with no targets of its own: loading the plan after
      // picking targets is the expected order, and this is the page those targets are picked on.
      setCurrentVisit(visitId === '' ? null : visitId, currentOptimizerArtifactIds.value);
    }

    // Solved visits go with the plan, so an unexported cycle asks first. Nothing else here is
    // recoverable by re-picking the file.
    function onUnloadPlan() {
      if (
        solvedVisitCount.value > 0 &&
        !window.confirm('Unload the plan? Solved visits you have not exported are discarded.')
      )
        return;
      planLoadError.value = '';
      clearLoadedPlan();
    }

    function onExportPlan() {
      const plan = loadedPlan.value;
      if (!plan || props.exportBlocked) return;
      const solved = plan.visits.map(v => plan.solved[v.visitId]).filter(v => v !== undefined);
      downloadJson('humility-plan.json', buildHumilityPlanFile(plan.label, solved));
    }

    return {
      waitTimeDraft,
      onWaitTimeInput,
      onWaitTimeBlur,
      hasPlayerData,
      maxTankLevel,
      previousCraftEntries,
      tankCapacityLabel,
      planSourceLabel,
      sourceTankLevel,
      sourceFTLLevel,
      sourceZerogLevel,
      canBudgetPerEgg,
      perEggBudget,
      perEggBudgetEntries,
      writePerEggBudget,
      totalShips,
      shipsVisibleCount,
      gemCostFieldValue,
      gemCostMode,
      gemCostInvalid,
      craftingCostInput,
      craftingCostInvalid,
      setGemCostMode,
      setGemCostInput,
      setCraftingCostInput,
      onGemModeChange,
      normalizeGemCost,
      normalizeCraftingCost,
      planVisit: activePlanVisit,
      plan: loadedPlan,
      planLoadError,
      onPlanFilePicked,
      visitOptions,
      onVisitPicked,
      solvedCount: solvedVisitCount,
      onExportPlan,
      onUnloadPlan,
      EFFORT_LEVELS,
      effortMeta,
      effortTrack,
      effortRail,
      effortIndex,
      onTrackPointerDown,
      onTrackPointerMove,
      onTrackPointerUp,
      onTrackKeydown,
      config,
      extras,
      overrides,
      missionFilters,
      playerCraftingLevel,
      playerGoldenEggs,
      playerPreviousCrafts,
      playerTankLevel,
      playerShipsConfig,
      setCraftingLevel,
      setPreviousCraftCount,
      setTankLevel,
      setEpicResearchFTLLevel,
      setEpicResearchZerogLevel,
      setOverrideCraftingLevel,
      setOverridePreviousCrafts,
      setOverrideTankLevel,
      setOverrideFTL,
      setOverrideZerog,
      setMaxGoldenEggCostEnabled,
      openPlayerOverridesModal,
    };
  },
});
</script>
