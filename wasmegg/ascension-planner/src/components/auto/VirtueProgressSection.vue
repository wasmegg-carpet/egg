<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between px-1">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 shadow-sm shadow-indigo-100">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h2 class="text-xs font-black text-slate-800 uppercase tracking-wider leading-none">Virtue Progress</h2>
          <div class="flex items-center gap-2 mt-1">
            <span class="text-[10px] font-black text-indigo-500 uppercase">{{ currentTE }} TE Total</span>
            <span v-if="truthEggsStore.totalPendingTE > 0" class="text-[10px] font-black text-emerald-500 uppercase">
              +{{ truthEggsStore.totalPendingTE }} Pending
            </span>
            <span v-if="earningsClothedTe !== null" class="w-1 h-1 bg-slate-200 rounded-full"></span>
            <span v-if="earningsClothedTe !== null" class="text-[10px] font-black text-indigo-500 uppercase"
              >Clothed TE {{ Math.round(earningsClothedTe) }}</span
            >
            <span class="w-1 h-1 bg-slate-200 rounded-full"></span>
            <span class="text-[10px] font-black text-slate-500">Delivery Rate {{ formatNumber(currentELR * 3600, 3) }}/hr</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="teInputsDifferFromDefault"
          @click="resetTEInputsToDefault"
          title="Reset starting TE back to what your backup showed when you loaded the page today"
          class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all border border-slate-200 flex items-center gap-2 active:scale-95"
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Reset to Today's Defaults
        </button>
        <button
          v-if="truthEggsStore.hasPendingTE"
          @click="rollUpPendingTE()"
          class="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-all shadow-md shadow-emerald-100 flex items-center gap-2 active:scale-95"
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          Roll Up Pending
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
      <div v-for="egg in VIRTUE_TE_ORDER" :key="egg" class="relative group">
        <div class="bg-slate-50 border border-slate-100 rounded-xl p-3 group-hover:border-indigo-100 group-hover:bg-slate-50/80 transition-all duration-300">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <img :src="iconURL(`egginc/egg_${egg}.png`, 64)" class="w-4 h-4 object-contain grayscale group-hover:grayscale-0 transition-all" />
              <span class="text-[8px] font-black text-slate-500 uppercase tracking-widest group-hover:text-indigo-400 transition-colors">
                {{ VIRTUE_EGG_NAMES[egg] }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <div class="relative flex-grow">
              <input
                type="number"
                :value="truthEggsStore.teEarned[egg]"
                min="0"
                max="98"
                class="w-full bg-white border border-slate-100 rounded-lg px-3 py-1.5 text-[11px] font-mono-premium font-black text-slate-900 outline-none focus:border-indigo-500/50 focus:bg-white transition-all"
                @change="handleTEEarnedChange(egg, ($event.target as HTMLInputElement).value)"
                @keydown.enter="($event.target as HTMLInputElement).blur()"
              />
            </div>
            <div
              v-if="truthEggsStore.pendingTEForEgg(egg) > 0"
              class="flex flex-col items-center justify-center bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100 min-w-[44px]"
            >
              <span class="text-[9px] font-black text-emerald-600">+{{ truthEggsStore.pendingTEForEgg(egg) }}</span>
              <span class="text-[5px] font-black text-emerald-400 uppercase leading-none">Pending</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { iconURL } from 'lib';
import { formatNumber } from '@/lib/format';
import { useTruthEggsStore, VIRTUE_TE_ORDER } from '@/stores/truthEggs';
import { VIRTUE_EGG_NAMES } from '@/types';
import { useActionsStore } from '@/stores/actions';
import { useInitialStateStore } from '@/stores/initialState';
import { useVirtueStore } from '@/stores/virtue';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useSilosStore } from '@/stores/silos';
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import { getSimulationContext, createBaseEngineState } from '@/engine/adapter';
import { getArtifactLoadoutFromBackup, getOptimalEarningsSet } from '@/lib/artifacts';
import { useEarningsClothedTE } from '@/composables/useEarningsClothedTE';
import { computeSnapshot } from '@/engine/compute';
import { rollUpPendingTE } from '@/lib/modes';
import { consumeAutoPlannerTEInputs, saveAutoPlannerTEInputs } from '@/lib/autoPlannerFormCache';
import type { VirtueEgg } from '@/types';

const VIRTUE_EGGS_MAP: Record<number, VirtueEgg> = {
  50: 'curiosity',
  51: 'integrity',
  52: 'humility',
  53: 'resilience',
  54: 'kindness',
};

const truthEggsStore = useTruthEggsStore();
const actionsStore = useActionsStore();
const initialStateStore = useInitialStateStore();
const virtueStore = useVirtueStore();
const fuelTankStore = useFuelTankStore();
const silosStore = useSilosStore();

// Snapshot "today's" starting TE — whatever the fresh backup fetch put into the store before this
// component mounted — so the Reset button below has something to reset back to, independent of
// whatever gets restored from (or later saved to) the local form cache.
const defaultTeEarned: Partial<Record<VirtueEgg, number>> = { ...truthEggsStore.teEarned };

const currentTE = computed(() => {
  const snapshot = actionsStore.effectiveSnapshot;
  if (!snapshot?.teEarned) return 0;
  return Object.values(snapshot.teEarned).reduce((a, b) => a + b, 0);
});

// Clothed TE for the earnings set as of the current simulation snapshot.
const { clothedTE: earningsClothedTe } = useEarningsClothedTE();

const currentELR = computed(() => {
  const farmState = initialStateStore.currentFarmState;
  if (!farmState) {
    return actionsStore.effectiveSnapshot?.elr ?? 0;
  }

  const rawLoadout = initialStateStore.rawBackup
    ? getArtifactLoadoutFromBackup(initialStateStore.rawBackup)
    : initialStateStore.artifactLoadout;

  const optimalEarnings = initialStateStore.rawBackup
    ? getOptimalEarningsSet(initialStateStore.rawBackup)
    : initialStateStore.artifactSets.earnings || null;

  const continueState: import('@/engine/types').EngineState = {
    currentEgg: (VIRTUE_EGGS_MAP[farmState.eggType] || 'curiosity') as VirtueEgg,
    shiftCount: virtueStore.initialShiftCount,
    te: virtueStore.initialTE,
    soulEggs: initialStateStore.soulEggs,
    vehicles: farmState.vehicles || [{ vehicleId: 0, trainLength: 1 }],
    habIds: farmState.habs || [0, null, null, null],
    researchLevels: { ...farmState.commonResearches },
    siloCount: silosStore.siloCount || 1,
    tankLevel: fuelTankStore.tankLevel || 0,
    artifactLoadout: rawLoadout.map(slot => ({ artifactId: slot.artifactId, stones: [...slot.stones] })),
    activeArtifactSet: 'elr',
    artifactSets: {
      earnings: optimalEarnings ? JSON.parse(JSON.stringify(optimalEarnings)) : null,
      elr: JSON.parse(JSON.stringify(rawLoadout)),
    },
    fuelTankAmounts: { ...initialStateStore.initialFuelAmounts },
    eggsDelivered: { ...initialStateStore.initialEggsDelivered },
    teEarned: { ...initialStateStore.initialTeEarned },
    population: farmState.population || 0,
    lastStepTime: farmState.lastStepTime || 0,
    bankValue: farmState.cash || 0,
    activeSales: { research: false, hab: false, vehicle: false },
    earningsBoost: { active: false, multiplier: 1 },
  };

  return computeSnapshot(continueState, getSimulationContext(), { skipGrowth: true }).elr;
});

const handleTEEarnedChange = (egg: VirtueEgg, value: string) => {
  const count = parseInt(value);
  if (isNaN(count)) return;

  truthEggsStore.setTEEarnedWithSync(egg, count);
  syncTEAcrossStores(egg);
  cacheTEInputs();
};

const syncTEAcrossStores = async (egg: VirtueEgg) => {
  initialStateStore.setInitialEggsDelivered(egg, truthEggsStore.eggsDelivered[egg]);
  initialStateStore.setInitialTeEarned(egg, truthEggsStore.teEarned[egg]);

  const theoreticalTE = countTEThresholdsPassed(truthEggsStore.eggsDelivered[egg]);
  initialStateStore.setInitialTePending(egg, Math.max(0, theoreticalTE - truthEggsStore.teEarned[egg]));

  virtueStore.setInitialTE(truthEggsStore.totalTE);
  virtueStore.setTE(truthEggsStore.totalTE);

  const baseState = createBaseEngineState(null);
  const initialSnapshot = computeSnapshot(baseState, getSimulationContext());
  await actionsStore.setInitialSnapshot(initialSnapshot);
};

// Restore cached starting TE inputs from a previous visit, if any, so a page reload doesn't wipe
// out edits the user made to these fields. Applied on top of the fresh backup default captured
// above as `defaultTeEarned`. `consumeAutoPlannerTEInputs` only returns a value the first time
// it's called per player per page load, so switching Auto/Manual back and forth (which remounts
// this component) won't keep reapplying a stale cache on top of fresher state from a backup
// refresh, plan import, or Manual-mode edit.
const cachedTEInputs = consumeAutoPlannerTEInputs(initialStateStore.playerId);
if (cachedTEInputs?.teEarned) {
  for (const egg of VIRTUE_TE_ORDER) {
    const cachedValue = cachedTEInputs.teEarned[egg];
    if (cachedValue !== undefined && cachedValue !== truthEggsStore.teEarned[egg]) {
      truthEggsStore.setTEEarnedWithSync(egg, cachedValue);
      syncTEAcrossStores(egg);
    }
  }
}

// Persist starting TE inputs so they survive a page reload. Called explicitly from the actual
// user-driven entry points below (editing a field, resetting to defaults) rather than from a
// blanket store watcher, so values that change for other reasons (backup refresh, plan import,
// Manual-mode sync, rolling up pending TE) don't get cached as if the user had typed them.
function cacheTEInputs() {
  saveAutoPlannerTEInputs(initialStateStore.playerId, { teEarned: { ...truthEggsStore.teEarned } });
}

// Whether any starting TE input has drifted from what the backup showed on load — governs
// whether the Reset button is shown at all.
const teInputsDifferFromDefault = computed(() =>
  VIRTUE_TE_ORDER.some(egg => truthEggsStore.teEarned[egg] !== defaultTeEarned[egg])
);

/**
 * Reset all starting TE inputs back to the values the backup showed when the page loaded today,
 * discarding any manual edits (and the cached copy of them).
 */
function resetTEInputsToDefault() {
  for (const egg of VIRTUE_TE_ORDER) {
    const value = defaultTeEarned[egg];
    if (value !== undefined) {
      truthEggsStore.setTEEarnedWithSync(egg, value);
      syncTEAcrossStores(egg);
    }
  }
  cacheTEInputs();
}
</script>

<style scoped>
.font-mono-premium {
  font-family: 'JetBrains Mono', 'Roboto Mono', monospace;
}
</style>
