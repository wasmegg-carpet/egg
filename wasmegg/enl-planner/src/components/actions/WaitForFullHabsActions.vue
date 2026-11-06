<template>
  <div class="space-y-6">

    <!-- Current State Info -->
    <div class="bg-slate-50/50 rounded-2xl p-5 border border-slate-100 shadow-inner">
      <div class="flex items-center gap-4 mb-4">
        <div
          class="w-12 h-12 rounded-2xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-2"
        >
          <img
            :src="iconURL('egginc/ei_hab_icon_chicken_universe.png', 64)"
            class="w-full h-full object-contain"
            alt="Habitats"
          />
        </div>
        <div>
          <div class="text-sm font-bold text-slate-800">Habitat Capacity</div>
          <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Filling to {{ formatNumber(habCapacity, 3) }}
          </div>
        </div>
      </div>

      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px]">
          <div class="text-slate-400 uppercase tracking-[0.2em] font-black">Metric</div>
          <div class="text-slate-400 uppercase tracking-[0.2em] font-black text-right">Value</div>

          <div class="text-slate-600 font-bold uppercase tracking-tight">Current Pop:</div>
          <div class="font-mono-premium text-right text-slate-700 font-bold">
            {{ formatNumber(currentPopulation, 3) }}
          </div>

          <div class="text-slate-600 font-bold uppercase tracking-tight">Remaining:</div>
          <div class="font-mono-premium text-right text-slate-900 font-black">
            {{ formatNumber(chickensToGrow, 3) }}
          </div>

          <div class="text-slate-600 font-bold uppercase tracking-tight pt-2 border-t border-slate-100/50">
            IHR (Offline):
          </div>
          <div class="font-mono-premium text-right text-slate-700 font-bold pt-2 border-t border-slate-100/50">
            {{ formatNumber(ihr, 3) }} / min
          </div>
        </div>

        <div class="pt-3 border-t border-slate-100/50">
          <div class="flex justify-between items-center text-[10px]">
            <span class="font-black text-slate-400 uppercase tracking-widest">Time Required:</span>
            <span class="font-mono-premium font-black text-slate-900 text-sm">{{
              formatDuration(timeToGrowSeconds)
            }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Wait button -->
    <button
      class="btn-premium btn-primary w-full mt-6 py-4 flex items-center justify-center gap-2 group disabled:opacity-20 shadow-lg shadow-slate-900/10"
      :disabled="!canWait"
      @click="handleWaitForFullHabs"
    >
      <img
        :src="iconURL('egginc/ei_hab_icon_chicken_universe.png', 64)"
        class="w-5 h-5 object-contain group-hover:scale-110 transition-transform"
        alt="Hab"
      />
      <span>Wait for Full Habs</span>
    </button>

    <p class="text-[10px] text-slate-400 uppercase font-black tracking-widest leading-relaxed opacity-60">
      Time is based on your current offline internal hatchery rate.
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { iconURL } from 'lib';
import { useActionsStore } from '@/stores/actions';
import { formatNumber, formatDuration } from '@/lib/format';
import { generateActionId } from '@/types';
import { useActionExecutor } from '@/composables/useActionExecutor';
import { computeDependencies } from '@/lib/actions/executor';

const actionsStore = useActionsStore();
const { prepareExecution, completeExecution } = useActionExecutor();

const habCapacity = computed(() => actionsStore.effectiveSnapshot.habCapacity);
const currentPopulation = computed(() => actionsStore.effectiveSnapshot.population);
const ihr = computed(() => actionsStore.effectiveSnapshot.offlineIHR);

const chickensToGrow = computed(() => Math.max(0, habCapacity.value - currentPopulation.value));

const timeToGrowSeconds = computed(() => {
  if (chickensToGrow.value <= 0) return 0;
  if (ihr.value <= 0) return Infinity;
  // ihr is chickens/min for all 4 habs
  return chickensToGrow.value / (ihr.value / 60);
});

const canWait = computed(
  () => chickensToGrow.value > 0 && isFinite(timeToGrowSeconds.value) && timeToGrowSeconds.value > 0
);

function handleWaitForFullHabs() {
  if (!canWait.value) return;

  const beforeSnapshot = prepareExecution();

  const payload = {
    habCapacity: habCapacity.value,
    ihr: ihr.value,
    currentPopulation: currentPopulation.value,
    totalTimeSeconds: timeToGrowSeconds.value,
  };

  const dependencies = computeDependencies(
    'wait_for_full_habs',
    payload,
    actionsStore.actionsBeforeInsertion,
    actionsStore.initialSnapshot.researchLevels
  );

  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'wait_for_full_habs',
      payload,
      cost: 0,
      dependsOn: dependencies,
    },
    beforeSnapshot
  );
}
</script>
