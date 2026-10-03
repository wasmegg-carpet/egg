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

    <HumilityPlanImport />

    <!-- Mission Grid -->
    <MissionGrid :ftl-level="ftlLevel" :earnings-per-second="earningsPerSecond" />

    <!-- Mission Summary -->
    <MissionSummary :summary="summary" :schedule="schedule" />

    <!-- Artifact Warning -->
    <div v-if="showArtifactWarning" class="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
      <div class="text-amber-500 mt-0.5">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fill-rule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clip-rule="evenodd"
          />
        </svg>
      </div>
      <div class="text-xs text-amber-800 leading-normal">
        Saving for these ships will take <strong>{{ formatDuration(saveTimeSeconds) }}</strong
        >. Consider switching to your <strong>earnings set</strong> while you wait.
      </div>
    </div>

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

    <!-- Pre-shift Launch Option -->
    <div v-if="schedule.totalMissions >= 1 && schedule.totalMissions <= 3">
      <div class="flex items-center gap-2 px-1">
        <input type="checkbox" id="zero-time-launch" v-model="isZeroTime" class="rounded text-blue-600" />
        <label for="zero-time-launch" class="text-xs text-gray-600 font-medium cursor-pointer select-none">
          Launch for 0 time (pre-shift sends)
        </label>
      </div>

      <p class="text-[11px] text-gray-500 leading-relaxed italic border-l-2 border-gray-200 pl-3 py-0.5">
        If you choose this option, the missions will launch for 0 time. This is useful for "pre-shift" sends where you
        launch ships right before shifting, avoiding adding mission duration to your plan.
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
import { useActionExecutor } from '@/composables/useActionExecutor';
import { computeDependencies } from '@/lib/actions/executor';
import { generateActionId, VIRTUE_EGGS } from '@/types';
import type { VirtueEgg, LaunchMissionEntry } from '@/types';
import { launchCost } from '@/lib/rockets/launches';
import { formatDuration } from '@/lib/format';
import { getTimeToSave } from '@/engine/apply';

import FuelTankGraphic from './rockets/FuelTankGraphic.vue';
import HumilityPlanImport from './rockets/HumilityPlanImport.vue';
import MissionGrid from './rockets/MissionGrid.vue';
import MissionSummary from './rockets/MissionSummary.vue';

const fuelTankStore = useFuelTankStore();
const rocketsStore = useRocketsStore();
const actionsStore = useActionsStore();
const initialStateStore = useInitialStateStore();
const { output: earningsOutput } = useEarnings();
const { prepareExecution, completeExecution } = useActionExecutor();

const isZeroTime = ref(false);

const ftlLevel = computed(() => initialStateStore.epicResearchLevels['afx_mission_time'] || 0);

const earningsPerSecond = computed(() =>
  Math.max(earningsOutput.value.onlineEarnings, earningsOutput.value.offlineEarnings)
);

const schedule = computed(() => rocketsStore.getSchedule(ftlLevel.value));
const summary = computed(() => rocketsStore.getSummary(ftlLevel.value));

const totalLaunchCost = computed(() => launchCost(rocketsStore.queuedMissions));

const saveTimeSeconds = computed(() => {
  const cost = totalLaunchCost.value;
  if (cost <= 0) return 0;

  // Use the engine's timeToSave which correctly handles bank balance,
  // population growth, and uses offline rates (consistent with the rest of the app).
  return getTimeToSave(cost, actionsStore.effectiveSnapshot);
});

const showArtifactWarning = computed(() => {
  return initialStateStore.activeArtifactSet === 'elr' && saveTimeSeconds.value > 10;
});

function handleLaunch() {
  if (rocketsStore.isOverBudget || rocketsStore.queuedMissions.length === 0) return;

  const beforeSnapshot = prepareExecution();

  const missions: LaunchMissionEntry[] = rocketsStore.queuedMissions.map(m => ({
    ship: m.ship,
    duration: m.duration,
    count: m.count,
  }));

  const fuelConsumed: Record<VirtueEgg, number> = { ...rocketsStore.totalFuelCost };

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
  for (const egg of VIRTUE_EGGS) {
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
      cost: totalLaunchCost.value,
      dependsOn: dependencies,
    },
    beforeSnapshot
  );

  rocketsStore.clearAll();
  isZeroTime.value = false;
}
</script>
