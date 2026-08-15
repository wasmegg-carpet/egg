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
          <p v-else class="mt-1 text-xs text-gray-400">Maximum time you're willing to spend launching missions</p>
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
          <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              class="h-4 w-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
              :checked="missionFilters.maxGemCostEnabled"
              @change="setMaxGemCostEnabled(($event.target as HTMLInputElement).checked)"
            />
            Maximum purchase cost
          </label>
          <div class="mt-1 flex items-center gap-2">
            <input
              type="text"
              :disabled="!missionFilters.maxGemCostEnabled"
              :value="maxGemCostDisplay"
              placeholder="e.g. 10S"
              class="block w-24 sm:text-sm rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 px-2 py-1 border border-gray-300 disabled:bg-gray-50 disabled:text-gray-400"
              @input="onGemCostInput($event)"
            />
            <span class="text-xs text-gray-500">gems</span>
          </div>
          <p v-if="missionFilters.maxGemCostEnabled" class="mt-1 text-xs text-gray-400">
            Only schedule ships costing at most this many gems (e.g. 10S = 10 septillion)
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
        <optimizer-setting-row
          label="Fuel tank level"
          :has-save="playerTankLevel !== null"
          :overridden="overrides.tankLevel"
          :save-value="playerTankLevel"
          :manual-value="extras.tankLevel"
          :min="0"
          :max="maxTankLevel"
          :max-label="`/ ${maxTankLevel}`"
          :capacity="tankCapacityLabel"
          @update:overridden="setOverrideTankLevel"
          @update:manual="setTankLevel"
        />
        <optimizer-setting-row
          label="FTL Drive Upgrades"
          :has-save="hasPlayerData"
          :overridden="overrides.epicResearchFTLLevel"
          :save-value="playerShipsConfig ? playerShipsConfig.epicResearchFTLLevel : null"
          :manual-value="config.epicResearchFTLLevel"
          :min="0"
          :max="60"
          max-label="/ 60"
          @update:overridden="setOverrideFTL"
          @update:manual="setEpicResearchFTLLevel"
        />
        <optimizer-setting-row
          label="Zero-g Quantum Containment"
          :has-save="hasPlayerData"
          :overridden="overrides.epicResearchZerogLevel"
          :save-value="playerShipsConfig ? playerShipsConfig.epicResearchZerogLevel : null"
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

    <section>
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Compute</h3>
      <label class="flex items-center gap-2 text-sm mb-2 select-none text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          class="h-4 w-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
          :checked="autoCompute"
          @change="setAutoCompute(($event.target as HTMLInputElement).checked)"
        />
        Recompute automatically
      </label>
      <button
        v-if="!autoCompute"
        type="button"
        :disabled="computing"
        class="w-full flex items-center justify-center px-3 py-2 border shadow-sm text-sm font-medium rounded-md focus:outline-none"
        :class="
          computing
            ? 'border-gray-300 text-gray-400 bg-gray-100 cursor-not-allowed'
            : pendingCompute
              ? 'border-transparent text-white bg-indigo-600 hover:bg-indigo-700'
              : 'border-gray-300 text-gray-600 bg-gray-100 hover:bg-gray-200'
        "
        @click="$emit('runCompute')"
      >
        {{ computing ? 'Computing…' : pendingCompute ? 'Recompute — results out of date' : 'Compute' }}
      </button>
      <p v-else-if="computing" role="status" class="text-xs text-gray-500">Computing…</p>
      <div class="mt-3">
        <loot-data-credit />
      </div>
    </section>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue';

import {
  formatDuration,
  formatEIValue,
  fuelTankSizes,
  getArtifactTierPropsFromId,
  isDurationNormalizable,
  parseDurationDays,
  parseValueWithUnit,
  spaceshipList,
} from 'lib';
import BaseInput from 'ui/components/BaseInput.vue';
import PlayerIdForm from 'ui/components/PlayerIdForm.vue';
import LootDataCredit from '@/components/LootDataCredit.vue';
import OptimizerSettingRow from './OptimizerSettingRow.vue';

import {
  autoCompute,
  config,
  currentOptimizerArtifactIds,
  effectiveConfig,
  EFFORT_LEVELS,
  type EffortLevel,
  extras,
  missionFilters,
  openPlayerOverridesModal,
  overrides,
  playerCraftingLevel,
  playerPreviousCrafts,
  playerPreviousCraftsByArtifact,
  playerShipsConfig,
  playerTankLevel,
  setAutoCompute,
  setCraftingLevel,
  setEffort,
  setEpicResearchFTLLevel,
  setEpicResearchZerogLevel,
  setMaxGemCost,
  setMaxGemCostEnabled,
  setOverrideCraftingLevel,
  setOverrideFTL,
  setOverridePreviousCrafts,
  setOverrideTankLevel,
  setOverrideZerog,
  setPreviousCraftCount,
  setTankLevel,
} from '@/store';

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
  components: { BaseInput, PlayerIdForm, LootDataCredit, OptimizerSettingRow },
  props: {
    playerId: { type: String, default: '' },
    pendingCompute: { type: Boolean, required: true },
    computing: { type: Boolean, required: true },
    waitTimeDays: { type: String, required: true },
    timeBudgetInvalid: { type: Boolean, default: false },
  },
  emits: {
    submitPlayerId: (_id: string) => true,
    runCompute: () => true,
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

    function onWaitTimeBlur() {
      if (!isDurationNormalizable(waitTimeDraft.value)) {
        // keep the text as typed rather than overwrite it with e.g. '>100yr'
        return;
      }
      const normalized = formatDuration(parseDurationDays(waitTimeDraft.value), true);
      waitTimeDraft.value = normalized;
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

    const shownTankLevel = computed(() => {
      const editable = playerTankLevel.value === null || overrides.value.tankLevel;
      return editable ? extras.value.tankLevel : (playerTankLevel.value ?? 0);
    });
    const tankCapacityLabel = computed(() => formatEIValue(fuelTankSizes[shownTankLevel.value] ?? 0, { trim: true }));

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

    function costFieldHandler(set: (value: number) => void) {
      return (event: Event) => {
        const raw = (event.target as HTMLInputElement).value.trim();
        if (!raw) return;
        const n = parseValueWithUnit(raw, false);
        if (n === null || !Number.isFinite(n) || n < 0) return;
        set(n);
      };
    }

    const maxGemCostDisplay = computed(() => formatEIValue(missionFilters.value.maxGemCost, { trim: true }));
    const onGemCostInput = costFieldHandler(setMaxGemCost);

    return {
      waitTimeDraft,
      onWaitTimeInput,
      onWaitTimeBlur,
      hasPlayerData,
      maxTankLevel,
      previousCraftEntries,
      tankCapacityLabel,
      totalShips,
      shipsVisibleCount,
      maxGemCostDisplay,
      onGemCostInput,
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
      autoCompute,
      playerCraftingLevel,
      playerPreviousCrafts,
      playerTankLevel,
      playerShipsConfig,
      setAutoCompute,
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
      setMaxGemCostEnabled,
      openPlayerOverridesModal,
    };
  },
});
</script>
