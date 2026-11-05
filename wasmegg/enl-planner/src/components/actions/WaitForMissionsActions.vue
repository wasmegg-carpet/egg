<template>
  <div class="space-y-6">
    <div class="bg-blue-50 border border-blue-100/50 rounded-2xl p-5 shadow-inner">
      <div class="flex gap-3">
        <div
          class="w-8 h-8 rounded-xl bg-white border border-blue-100 shadow-sm flex items-center justify-center p-1.5 flex-shrink-0"
        >
          <svg class="w-full h-full text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <p class="text-[11px] font-medium text-blue-700 leading-relaxed">
          <span class="font-black uppercase tracking-widest text-[9px] block mb-1">Info:</span>
          This tab displays missions that were in progress when your backup was taken. You can "Wait" for them to return
          to account for their duration in your ascension plan.
        </p>
      </div>
    </div>

    <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <ActiveMissionsDisplay
        :missions="initialStateStore.virtueMissions"
        :current-time-seconds="currentTimeSeconds"
        @wait-missions="handleWaitMissions"
      />
    </div>

    <div
      v-if="initialStateStore.virtueMissions.length === 0"
      class="flex flex-col items-center justify-center py-16 px-6 text-center bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200"
    >
      <div
        class="w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-md border border-slate-100 mb-6 group hover:scale-110 transition-transform"
      >
        <svg
          class="w-10 h-10 text-slate-300 group-hover:text-slate-400 transition-colors"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M20.24 12.24a6 6 0 0 0-8.49-8.49M12 21.75V11.25m8.25 10.5h-16.5"
          />
        </svg>
      </div>
      <h3 class="text-sm font-black text-slate-900 uppercase tracking-widest mb-2">No Active Missions</h3>
      <p class="text-[11px] text-slate-500 max-w-xs leading-relaxed font-medium">
        There are no active virtue missions found in your last backup. Once missions return, use the "Rockets" tab to
        plan new launches.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useInitialStateStore } from '@/stores/initialState';
import { useActionsStore } from '@/stores/actions';
import { useActionExecutor } from '@/composables/useActionExecutor';
import { generateActionId, type ActiveMissionInfo } from '@/types';
import { computeDependencies } from '@/lib/actions/executor';
import { useVirtueStore } from '@/stores/virtue';
import ActiveMissionsDisplay from './rockets/ActiveMissionsDisplay.vue';

const initialStateStore = useInitialStateStore();
const actionsStore = useActionsStore();
const virtueStore = useVirtueStore();
const { prepareExecution, completeExecution } = useActionExecutor();

const currentTimeSeconds = computed(() => actionsStore.effectiveSnapshot.lastStepTime);

function handleWaitMissions(missionsToWait: ActiveMissionInfo[]) {
  if (missionsToWait.length === 0) return;

  const maxReturn = Math.max(...missionsToWait.map(m => m.returnTimestamp || 0));
  const waitSeconds = Math.max(0, maxReturn - currentTimeSeconds.value);

  if (waitSeconds <= 0) return;

  const beforeSnapshot = prepareExecution();

  const payload = {
    missions: JSON.parse(JSON.stringify(missionsToWait)),
    totalTimeSeconds: waitSeconds,
  };

  const dependencies = computeDependencies(
    'wait_for_missions',
    payload,
    actionsStore.actionsBeforeInsertion,
    actionsStore.initialSnapshot.researchLevels
  );

  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'wait_for_missions',
      payload,
      cost: 0,
      dependsOn: dependencies,
    },
    beforeSnapshot
  );
}
</script>
