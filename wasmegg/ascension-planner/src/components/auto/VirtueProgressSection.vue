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
            <span class="text-[10px] font-black text-indigo-500 uppercase">{{ claimedTotal }} TE Total</span>
            <span v-if="pendingTotal > 0" class="text-[10px] font-black text-emerald-500 uppercase">
              +{{ pendingTotal }} Pending
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
      <div v-if="backupProgress" class="flex items-center gap-2">
        <button
          v-if="teOverride"
          @click="removeOverride"
          class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all border border-slate-200 active:scale-95"
        >
          Remove Override
        </button>
        <button
          v-else
          @click="addOverride"
          class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all border border-slate-200 active:scale-95"
        >
          Override
        </button>
      </div>
    </div>

    <!-- Default: the backup's virtue progress, read-only -->
    <template v-if="backupProgress && !teOverride">
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div
          v-for="egg in VIRTUE_TE_ORDER"
          :key="egg"
          class="bg-slate-50 border rounded-xl p-3"
          :class="egg === currentEgg ? 'border-indigo-200' : 'border-slate-100'"
        >
          <div class="flex items-center gap-2 mb-2">
            <img :src="iconURL(`egginc/egg_${egg}.png`, 64)" class="w-4 h-4 object-contain" />
            <span class="text-[8px] font-black text-slate-500 uppercase tracking-widest">{{ VIRTUE_EGG_NAMES[egg] }}</span>
          </div>
          <div class="flex items-baseline gap-1">
            <span class="text-lg font-mono-premium font-black text-slate-900 leading-none">{{ backupProgress.teEarned[egg] }}</span>
            <span class="text-[8px] font-black text-slate-400 uppercase">Claimed</span>
          </div>
          <div class="mt-1 text-[9px] font-black uppercase" :class="backupProgress.tePending[egg] > 0 ? 'text-emerald-600' : 'text-slate-300'">
            +{{ backupProgress.tePending[egg] }} Pending
          </div>
        </div>
      </div>
      <p v-if="sinceSync" class="text-[11px] font-bold text-slate-600 px-1 tabular-nums">
        <span class="font-black text-indigo-600">+{{ formatNumber(sinceSync.eggs, 3) }}</span>
        {{ VIRTUE_EGG_NAMES[sinceSync.egg] }} eggs since your last sync {{ formatDuration(sinceSync.seconds) }} ago
        <span v-if="sinceSync.te > 0" class="font-black text-emerald-600">(+{{ sinceSync.te }} TE)</span>
      </p>
    </template>

    <!-- Override (or no backup to default to): claimed TE per egg, editable -->
    <template v-else>
      <p
        v-if="teOverride"
        class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] font-bold text-amber-800 leading-relaxed"
      >
        The plan starts from exactly the claimed TE entered below. Pending (unclaimed) TE, partial progress toward
        your next TE, and eggs shipped since your last sync are not counted.
      </p>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div v-for="egg in VIRTUE_TE_ORDER" :key="egg" class="relative group">
          <div class="bg-slate-50 border border-slate-100 rounded-xl p-3 group-hover:border-indigo-100 group-hover:bg-slate-50/80 transition-all duration-300">
            <div class="flex items-center gap-2 mb-2">
              <img :src="iconURL(`egginc/egg_${egg}.png`, 64)" class="w-4 h-4 object-contain grayscale group-hover:grayscale-0 transition-all" />
              <span class="text-[8px] font-black text-slate-500 uppercase tracking-widest group-hover:text-indigo-400 transition-colors">
                {{ VIRTUE_EGG_NAMES[egg] }}
              </span>
            </div>
            <input
              type="number"
              :value="teOverride ? teOverride[egg] : truthEggsStore.teEarned[egg]"
              min="0"
              max="98"
              class="w-full bg-white border border-slate-100 rounded-lg px-3 py-1.5 text-[11px] font-mono-premium font-black text-slate-900 outline-none focus:border-indigo-500/50 focus:bg-white transition-all"
              @change="handleTEEarnedChange(egg, ($event.target as HTMLInputElement).value)"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
          </div>
        </div>
      </div>
    </template>

    <!-- Artifacts & Stones: what C1/C3/H1 use in place of the backup's inventory -->
    <div v-if="autoPlannerStore.loadoutInputs" class="bg-slate-50 border border-slate-100 rounded-xl">
      <button
        class="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
        :aria-expanded="isLoadoutOpen"
        @click="isLoadoutOpen = !isLoadoutOpen"
      >
        <div class="min-w-0">
          <div class="text-[10px] font-black text-slate-700 uppercase tracking-widest">Artifacts &amp; Stones</div>
          <div class="text-[10px] font-bold text-slate-500 truncate">{{ loadoutSummary }}</div>
        </div>
        <svg
          class="w-4 h-4 text-slate-400 flex-shrink-0 transition-transform"
          :class="{ 'rotate-180': isLoadoutOpen }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-if="isLoadoutOpen" class="px-3 pb-3 space-y-2">
        <p v-if="!initialStateStore.rawBackup" class="text-[10px] font-bold text-amber-600">
          No inventory — enter stones manually.
        </p>
        <AutoLoadoutEditor
          :model-value="autoPlannerStore.loadoutInputs"
          :default-value="autoPlannerStore.defaultLoadoutInputs"
          :inventory-delivery="autoPlannerStore.defaultLoadoutInputs?.delivery ?? null"
          reset-label="Reset to inventory"
          default-label="Inventory"
          :slot-count="artifactSlotCount(initialStateStore.proPermit)"
          @update:model-value="handleLoadoutChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { iconURL } from 'lib';
import { formatDuration, formatNumber } from '@/lib/format';
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import { parseVirtueFarm, parseVirtueProgress } from '@/lib/backupVirtue';
import { useTruthEggsStore, VIRTUE_TE_ORDER } from '@/stores/truthEggs';
import { VIRTUE_EGG_NAMES } from '@/types';
import { useActionsStore } from '@/stores/actions';
import { useInitialStateStore } from '@/stores/initialState';
import { useVirtueStore } from '@/stores/virtue';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useSilosStore } from '@/stores/silos';
import { getSimulationContext } from '@/engine/adapter';
import { getArtifactLoadoutFromBackup, getOptimalEarningsSet, activeSlots, artifactSlotCount } from '@/lib/artifacts';
import { useEarningsClothedTE } from '@/composables/useEarningsClothedTE';
import { computeSnapshot } from '@/engine/compute';
import { consumeAutoPlannerTEInputs, saveAutoPlannerTEInputs } from '@/lib/autoPlannerFormCache';
import { applyAutoStartingTE, eggsSinceLastSync } from '@/auto/startingTE';
import type { VirtueEgg } from '@/types';
import { useAutoPlannerStore } from '@/stores/autoPlanner';
import { calculateClothedTEForSet } from '@/lib/artifacts/virtue';
import {
  buildLoadoutInputsFromBackup,
  buildLoadoutInputsFromSets,
  cloneLoadoutInputs,
  loadoutInputsEqual,
  socketEarningsStones,
  summarizeLoadoutInputs,
  type AutoLoadoutInputs,
} from '@/auto/loadout';
import {
  consumeAutoPlannerLoadoutInputs,
  saveAutoPlannerLoadoutInputs,
} from '@/lib/autoPlannerFormCache';
import AutoLoadoutEditor from './AutoLoadoutEditor.vue';

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
const autoPlannerStore = useAutoPlannerStore();

const currentTE = computed(() => {
  const snapshot = actionsStore.effectiveSnapshot;
  if (!snapshot?.teEarned) return 0;
  return Object.values(snapshot.teEarned).reduce((a, b) => a + b, 0);
});

// Clothed TE for the setup form's earnings set (socketed from its stone pool, as C1 will), falling
// back to the earnings set in the current simulation snapshot when there are no loadout inputs.
const { clothedTE: snapshotClothedTe } = useEarningsClothedTE();
const earningsClothedTe = computed<number | null>(() => {
  const inputs = autoPlannerStore.loadoutInputs;
  if (!inputs) return snapshotClothedTe.value;
  const context = getSimulationContext();
  return calculateClothedTEForSet(socketEarningsStones(inputs.earnings, inputs.stones), {
    truthEggs: currentTE.value,
    colleggtibleModifiers: context.colleggtibleModifiers,
    labUpgradeLevel: context.epicResearchLevels['cheaper_research'] ?? 0,
    proPermit: initialStateStore.proPermit,
  });
});

const currentELR = computed(() => {
  const farmState = initialStateStore.currentFarmState;
  if (!farmState) {
    return actionsStore.effectiveSnapshot?.elr ?? 0;
  }

  const rawLoadout = initialStateStore.rawBackup
    ? getArtifactLoadoutFromBackup(initialStateStore.rawBackup)
    : initialStateStore.artifactLoadout;

  const optimalEarnings = initialStateStore.rawBackup
    ? getOptimalEarningsSet(initialStateStore.rawBackup, initialStateStore.proPermit)
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
    proPermit: initialStateStore.proPermit,
    artifactLoadout: activeSlots(
      rawLoadout.map(slot => ({ artifactId: slot.artifactId, stones: [...slot.stones] })),
      initialStateStore.proPermit
    ),
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

// --- Starting TE: the backup's virtue progress by default, or the user's override ---

const teOverride = computed(() => autoPlannerStore.teOverride);

// The save as it is — not the stores, which the generator rolls pending TE into.
const backupProgress = computed(() =>
  initialStateStore.rawBackup ? parseVirtueProgress(initialStateStore.rawBackup) : null
);
const backupFarm = computed(() => (initialStateStore.rawBackup ? parseVirtueFarm(initialStateStore.rawBackup) : null));
const currentEgg = computed<VirtueEgg | null>(() =>
  backupFarm.value ? VIRTUE_EGGS_MAP[backupFarm.value.eggType] ?? null : null
);

const claimedTotal = computed(() => {
  const source = teOverride.value ?? backupProgress.value?.teEarned;
  return source ? VIRTUE_TE_ORDER.reduce((sum, egg) => sum + (source[egg] ?? 0), 0) : currentTE.value;
});
const pendingTotal = computed(() =>
  !teOverride.value && backupProgress.value
    ? VIRTUE_TE_ORDER.reduce((sum, egg) => sum + backupProgress.value!.tePending[egg], 0)
    : 0
);

// Eggs shipped on the current egg since the backup's last sync — the same catch-up the generator
// adds to every variant's starting eggs up to the plan start. Ticks every second.
const nowMs = ref(Date.now());
const clock = setInterval(() => (nowMs.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(clock));

const sinceSync = computed(() => {
  const nowSecs = nowMs.value / 1000;
  const catchUp = backupProgress.value ? eggsSinceLastSync(nowSecs) : null;
  if (!catchUp) return null;
  const delivered = backupProgress.value!.eggsDelivered[catchUp.egg];
  const te = countTEThresholdsPassed(delivered + catchUp.eggs) - countTEThresholdsPassed(delivered);
  return { egg: catchUp.egg, eggs: catchUp.eggs, seconds: Math.max(0, nowSecs - catchUp.lastSyncTime), te };
});

function cacheTEOverride() {
  const override = autoPlannerStore.teOverride;
  saveAutoPlannerTEInputs(initialStateStore.playerId, override ? { teEarned: { ...override } } : null);
}

function addOverride() {
  autoPlannerStore.teOverride = { ...(backupProgress.value?.teEarned ?? truthEggsStore.teEarned) };
  applyAutoStartingTE();
  cacheTEOverride();
}

function removeOverride() {
  autoPlannerStore.teOverride = null;
  applyAutoStartingTE();
  cacheTEOverride();
}

const handleTEEarnedChange = (egg: VirtueEgg, value: string) => {
  const count = parseInt(value);
  if (isNaN(count)) return;

  const base = autoPlannerStore.teOverride ?? backupProgress.value?.teEarned ?? truthEggsStore.teEarned;
  autoPlannerStore.teOverride = { ...base, [egg]: Math.max(0, Math.min(98, count)) };
  applyAutoStartingTE();
  cacheTEOverride();
};

// Restore a TE override from a previous visit, if any, so a page reload keeps it.
// `consumeAutoPlannerTEInputs` only returns a value the first time it's called per player per page
// load, so switching Auto/Manual back and forth (which remounts this component) won't reapply it
// over a plan import or a removed override. A plan or Chain Finder route that already set its own
// override wins.
const cachedTEInputs = consumeAutoPlannerTEInputs(initialStateStore.playerId);
if (cachedTEInputs?.teEarned && !autoPlannerStore.teOverride) {
  autoPlannerStore.teOverride = { ...cachedTEInputs.teEarned };
  applyAutoStartingTE();
}

// A backup refresh rewrites the stores from the save; put an override back on top of it.
watch(
  () => initialStateStore.rawBackup,
  () => {
    if (autoPlannerStore.teOverride) applyAutoStartingTE();
  }
);

// --- Artifacts & Stones ---

const isLoadoutOpen = ref(false);

const loadoutSummary = computed(() =>
  autoPlannerStore.loadoutInputs
    ? summarizeLoadoutInputs(
        autoPlannerStore.loadoutInputs,
        !loadoutInputsEqual(autoPlannerStore.loadoutInputs, autoPlannerStore.defaultLoadoutInputs),
        artifactSlotCount(initialStateStore.proPermit)
      )
    : ''
);

function inventoryLoadoutInputs(): AutoLoadoutInputs {
  return initialStateStore.rawBackup
    ? buildLoadoutInputsFromBackup(initialStateStore.rawBackup, initialStateStore.proPermit)
    : buildLoadoutInputsFromSets(initialStateStore.artifactSets);
}

/**
 * Seed the setup inputs from the inventory. The fresh inventory always becomes Reset's target. The
 * inputs themselves are replaced only when there are none yet or the backup changed since they were
 * seeded — not when the store already holds this session's edits (an Auto/Manual remount) or a
 * restored plan's inputs. Like the TE inputs, cached edits from a previous visit then apply on top,
 * once per page load.
 */
function seedLoadoutInputs({ applyCache }: { applyCache: boolean }) {
  const fresh = inventoryLoadoutInputs();
  const previousDefault = autoPlannerStore.defaultLoadoutInputs;
  const restoredFromPlan = !!autoPlannerStore.loadoutInputs && !previousDefault;
  autoPlannerStore.defaultLoadoutInputs = fresh;
  if (!autoPlannerStore.loadoutInputs || (previousDefault && !loadoutInputsEqual(previousDefault, fresh))) {
    autoPlannerStore.loadoutInputs = cloneLoadoutInputs(fresh);
  }
  if (applyCache) {
    const cached = consumeAutoPlannerLoadoutInputs(initialStateStore.playerId);
    if (cached && !restoredFromPlan) autoPlannerStore.loadoutInputs = cached;
  }
}

seedLoadoutInputs({ applyCache: true });
// A permit change also changes the default: the recommended earnings set is 2 artifacts with Standard.
watch(
  () => [initialStateStore.rawBackup, initialStateStore.proPermit],
  () => seedLoadoutInputs({ applyCache: false })
);

function handleLoadoutChange(inputs: AutoLoadoutInputs) {
  autoPlannerStore.loadoutInputs = inputs;
  // Back at the inventory default = nothing worth caching.
  const customized = !loadoutInputsEqual(inputs, autoPlannerStore.defaultLoadoutInputs);
  saveAutoPlannerLoadoutInputs(initialStateStore.playerId, customized ? inputs : null);
}
</script>

<style scoped>
.font-mono-premium {
  font-family: 'JetBrains Mono', 'Roboto Mono', monospace;
}
</style>
