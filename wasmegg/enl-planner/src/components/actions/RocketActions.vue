<template>
  <div class="space-y-4">
    <p class="text-sm text-gray-500">
      Plan rocket missions. Choose how many of each ship to send — fuel is drawn from your tank.
    </p>

    <!-- Fuel Tank Graphic -->
    <FuelTankGraphic
      :fuel-amounts="fuelTankStore.fuelAmounts"
      :committed="rocketsStore.totalFuelCost"
      :capacity="fuelTankStore.tankCapacity"
      :tank-level="fuelTankStore.tankLevel"
    />

    <!-- Mission Grid -->
    <MissionGrid :ftl-level="ftlLevel" :earnings-per-second="earningsPerSecond" />

    <!-- Mission Summary -->
    <MissionSummary :summary="summary" :schedule="schedule" />

    <!-- Launch Button -->
    <div v-if="rocketsStore.queuedMissions.length > 0" class="flex items-center gap-3">
      <button
        class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        :disabled="rocketsStore.isOverBudget"
        @click="handleLaunch"
      >
        Launch {{ schedule.totalMissions }} Missions
      </button>
      <button class="px-3 py-2 text-gray-600 hover:text-gray-800 text-sm" @click="rocketsStore.clearAll()">
        Clear All
      </button>
      <span v-if="rocketsStore.isOverBudget" class="text-red-500 text-xs"> Not enough fuel in tank </span>
    </div>

    <!-- Launch without waiting -->
    <div v-if="schedule.totalMissions >= 1 && schedule.totalMissions <= 3">
      <div class="flex items-center gap-2 px-1">
        <input type="checkbox" id="zero-time-launch" v-model="isZeroTime" class="rounded text-blue-600" />
        <label for="zero-time-launch" class="text-xs text-gray-600 font-medium cursor-pointer select-none">
          Launch for 0 time
        </label>
      </div>

      <p class="text-[11px] text-gray-500 leading-relaxed italic border-l-2 border-gray-200 pl-3 py-0.5">
        With this on, launching adds no time to your plan, so you keep planning instead of waiting for the missions to return.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useRocketsStore } from '@/stores/rockets';
import { useActionsStore } from '@/stores/actions';
import { useInitialStateStore } from '@/stores/initialState';
import { useEarnings } from '@/composables/useEarnings';
import { useEventCrossingWaits } from '@/composables/useEventCrossingWaits';
import { computeDependencies } from '@/lib/actions/executor';
import { generateActionId, FUEL_EGGS, createEmptyFuelAmounts } from '@/types';
import type { FuelEgg, LaunchMissionEntry } from '@/types';
import { SHIP_INFO, Spaceship } from '@/lib/missions';
import { formatDuration } from '@/lib/format';
import { getBoostAwareTimeToSave } from '@/engine/apply';
import { getSimulationContext } from '@/engine/adapter';

import FuelTankGraphic from './rockets/FuelTankGraphic.vue';
import MissionGrid from './rockets/MissionGrid.vue';
import MissionSummary from './rockets/MissionSummary.vue';

const fuelTankStore = useFuelTankStore();
const rocketsStore = useRocketsStore();
const actionsStore = useActionsStore();
const initialStateStore = useInitialStateStore();
const { output: earningsOutput } = useEarnings();
const { prepareExecution, completeExecution, batch, isEditingPastGroup, settled, insertBoostCrossingWaits } =
  useEventCrossingWaits();

const isZeroTime = ref(false);

const ftlLevel = computed(() => initialStateStore.epicResearchLevels['afx_mission_time'] || 0);

const earningsPerSecond = computed(() =>
  Math.max(earningsOutput.value.onlineEarnings, earningsOutput.value.offlineEarnings)
);

const schedule = computed(() => rocketsStore.getSchedule(ftlLevel.value));
const summary = computed(() => rocketsStore.getSummary(ftlLevel.value));

function handleLaunch() {
  if (rocketsStore.isOverBudget || rocketsStore.queuedMissions.length === 0) return;

  addLaunch();
}

function addLaunch() {
  const beforeSnapshot = prepareExecution();

  // Build mission entries for the payload
  const missions: LaunchMissionEntry[] = rocketsStore.queuedMissions.map(m => ({
    ship: m.ship,
    duration: m.duration,
    count: m.count,
  }));

  // Calculate total fuel consumed
  const fuelConsumed = createEmptyFuelAmounts();
  for (const egg of FUEL_EGGS) {
    fuelConsumed[egg] = rocketsStore.totalFuelCost[egg];
  }

  const scheduleResult = schedule.value;
  const isZeroTimeLaunch = isZeroTime.value;

  const payload = {
    missions,
    totalTimeSeconds: isZeroTimeLaunch ? 0 : scheduleResult.totalSeconds,
    totalMissions: scheduleResult.totalMissions,
    fuelConsumed,
    isZeroTime: isZeroTimeLaunch,
  };

  const dependencies = computeDependencies(
    'launch_missions',
    payload,
    actionsStore.actionsBeforeInsertion,
    actionsStore.initialSnapshot.researchLevels
  );

  // Deduct fuel from tank
  for (const egg of FUEL_EGGS) {
    if (fuelConsumed[egg] > 0) {
      const current = fuelTankStore.fuelAmounts[egg];
      fuelTankStore.setFuelAmount(egg, Math.max(0, current - fuelConsumed[egg]));
    }
  }

  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'launch_missions',
      payload,
      cost: 0, // Launches from a non-virtue farm cost fuel only
      dependsOn: dependencies,
    },
    beforeSnapshot
  );

  // Clear the mission queue
  rocketsStore.clearAll();
  isZeroTime.value = false;
}
</script>
