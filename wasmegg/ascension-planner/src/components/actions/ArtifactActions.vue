<template>
  <div class="space-y-3">

    <!-- Set Selector Tabs -->
    <div class="flex gap-2">
      <button
        v-for="setName in ['earnings', 'elr'] as const"
        :key="setName"
        class="flex-1 py-1.5 px-2 rounded-xl border-2 transition-all duration-200 flex flex-col items-center justify-center shadow-sm"
        :class="[
          selectedTab === setName ? 'border-blue-600 bg-blue-50/30' : 'border-gray-100 bg-white hover:border-gray-200',
        ]"
        @click="selectedTab = setName"
      >
        <!-- Equipped Indicator Space -->
        <div class="h-3.5 flex items-center justify-center w-full mb-0.5">
          <div
            v-if="activeArtifactSet === setName"
            class="flex items-center gap-1"
            v-tippy="'This set is currently equipped'"
          >
            <div class="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
            <span class="text-[8px] font-black uppercase tracking-tighter text-emerald-600 leading-none">Equipped</span>
          </div>
        </div>

        <span
          class="text-[10px] font-black uppercase tracking-[0.2em] leading-none mb-1"
          :class="selectedTab === setName ? 'text-blue-700' : 'text-gray-400'"
        >
          {{ setName }}
        </span>
      </button>
    </div>

    <!-- Active Set Editor -->
    <div class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-visible">
      <div class="px-3 py-2 bg-gray-50/50 border-b border-gray-100 flex flex-col gap-2.5">
        <div class="flex justify-between items-center">

          <div class="flex items-center gap-2">
            <template v-if="activeArtifactSet !== selectedTab">
              <button
                class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg shadow-sm transition-colors"
                @click="equipSet"
              >
                Equip Set
              </button>
            </template>

            <template v-if="isDirty">
              <button
                class="text-[10px] font-bold text-gray-400 hover:text-gray-600 uppercase tracking-wider"
                @click="undoChanges"
              >
                Undo
              </button>
              <button
                class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg shadow-sm transition-colors"
                @click="saveChanges"
              >
                Save Changes
              </button>
            </template>
          </div>

          <div v-if="selectedTab === 'earnings' && earningsClothedTe !== null" class="flex items-center gap-1.5">
            <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Clothed TE</span>
            <span class="text-xs font-mono-premium font-bold text-gray-900">{{ Math.round(earningsClothedTe) }}</span>
          </div>
        </div>

        <div v-if="selectedTab === 'elr'" class="flex flex-wrap items-center justify-end gap-y-2 gap-x-4 border-t border-gray-200/60 pt-2 -mt-1">
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-bold text-gray-500 uppercase tracking-tight"
              >Exclude Gusset</span
            >
            <button
              @click="excludeGusset = !excludeGusset"
              class="relative inline-flex h-4 w-8 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
              :class="excludeGusset ? 'bg-amber-600' : 'bg-gray-200'"
            >
              <span
                class="pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                :class="excludeGusset ? 'translate-x-4' : 'translate-x-0'"
              ></span>
            </button>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-[10px] font-bold text-gray-500 uppercase tracking-tight"
              >Assume Max Habs/Vehicles</span
            >
            <button
              @click="assumeMaxHabsVehicles = !assumeMaxHabsVehicles"
              class="relative inline-flex h-4 w-8 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
              :class="assumeMaxHabsVehicles ? 'bg-amber-600' : 'bg-gray-200'"
            >
              <span
                class="pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                :class="assumeMaxHabsVehicles ? 'translate-x-4' : 'translate-x-0'"
              ></span>
            </button>
          </div>

          <button
            class="px-3 py-1 text-white text-[10px] font-black uppercase tracking-widest rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
            :class="isOptimalELR ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'"
            @click="equipOptimalELR"
            v-tippy="'Find and equip the best delivery rate set from your inventory'"
          >
            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
                clip-rule="evenodd"
              />
            </svg>
            Optimal Delivery Rate
          </button>
        </div>
      </div>

      <div class="p-2">
        <ArtifactSelector
          :model-value="localLoadout"
          :slot-count="artifactSlotCount(initialStateStore.proPermit)"
          @update:model-value="localLoadout = $event"
        />
      </div>
    </div>

    <div class="bg-blue-50/30 rounded-xl p-2.5 border border-blue-100/50">
      <div class="flex flex-col gap-2">
        <div class="flex items-start gap-2.5">
          <div class="mt-0.5 text-blue-400">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <h4 class="text-[10px] font-bold text-blue-900 uppercase tracking-tight mb-0.5">Set Optimization</h4>
            <p class="text-[10px] text-blue-700 leading-tight">
              <strong>Earnings:</strong> Necklaces, Ankhs, Cubes, Lunar stones.
              <br />
              <strong>Delivery:</strong> Metronomes, Compasses, Tachyon/Quantum stones.
            </p>
          </div>
        </div>


      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import ArtifactSelector from '@/components/ArtifactSelector.vue';
import { useInitialStateStore } from '@/stores/initialState';
import { useActionsStore } from '@/stores/actions';
import { useWarningStore } from 'lib/planners/stores/warning';
import { generateActionId, type ArtifactSlotPayload, type ArtifactSetName, type CalculationsSnapshot } from '@/types';
import {
  type EquippedArtifact,
  createEmptyLoadout,
  summarizeLoadout,
  calculateArtifactModifiers,
  activeSlots,
  artifactSlotCount,
} from '@/lib/artifacts';
import { getOptimalELRSet, isFunctionallyIdentical, calculateClothedTEForSet } from '@/lib/artifacts/virtue';
import { useActionExecutor } from '@/composables/useActionExecutor';
import { computeDependencies } from '@/lib/actions/executor';
import { calculateHabCapacity_Full } from 'lib/planners/calculations/habCapacity';
import { getSimulationContext } from '@/engine/adapter';
import { formatNumber } from '@/lib/format';

const initialStateStore = useInitialStateStore();
const actionsStore = useActionsStore();
const warningStore = useWarningStore();
const { prepareExecution, completeExecution } = useActionExecutor();

const activeArtifactSet = computed(() => actionsStore.effectiveSnapshot.activeArtifactSet);
const artifactSets = computed(() => actionsStore.effectiveSnapshot.artifactSets);

const selectedTab = ref<ArtifactSetName>('earnings');

// Local state for the selected set (allows unsaved changes)
const localLoadout = ref<EquippedArtifact[]>(createEmptyLoadout());
const assumeMaxHabsVehicles = ref(true);
const excludeGusset = ref(false);

// Clothed TE for the earnings set currently being viewed (localLoadout may hold
// unsaved edits), regardless of whether it's the equipped set.
const earningsClothedTe = computed<number | null>(() => {
  if (selectedTab.value !== 'earnings') return null;
  const context = getSimulationContext();
  return calculateClothedTEForSet(localLoadout.value, {
    truthEggs: actionsStore.effectiveSnapshot.te,
    colleggtibleModifiers: context.colleggtibleModifiers,
    labUpgradeLevel: context.epicResearchLevels['cheaper_research'] ?? 0,
    proPermit: initialStateStore.proPermit,
  });
});

const isOptimalELR = computed(() => {
  if (!initialStateStore.rawBackup) return false;

  const savedSet = artifactSets.value.elr;
  const context = getSimulationContext();
  const optimized = getOptimalELRSet(initialStateStore.rawBackup, {
    assumeMaxHabsVehicles: assumeMaxHabsVehicles.value,
    habIds: actionsStore.effectiveSnapshot.habIds,
    vehicles: actionsStore.effectiveSnapshot.vehicles,
    currentSet: savedSet || undefined,
    excludeGusset: excludeGusset.value,
    commonResearch: actionsStore.effectiveSnapshot.researchLevels,
    epicResearchLevels: context.epicResearchLevels,
    colleggtibleModifiers: context.colleggtibleModifiers,
    proPermit: initialStateStore.proPermit,
  });

  const currentArtifacts = actionsStore.effectiveSnapshot.artifactLoadout;
  return isFunctionallyIdentical(optimized, currentArtifacts);

});

function equipOptimalELR() {
  if (!initialStateStore.rawBackup) return;

  const savedSet = artifactSets.value.elr;
  const context = getSimulationContext();
  const optimized = getOptimalELRSet(initialStateStore.rawBackup, {
    assumeMaxHabsVehicles: assumeMaxHabsVehicles.value,
    habIds: actionsStore.effectiveSnapshot.habIds,
    vehicles: actionsStore.effectiveSnapshot.vehicles,
    currentSet: savedSet || undefined,
    excludeGusset: excludeGusset.value,
    commonResearch: actionsStore.effectiveSnapshot.researchLevels,
    epicResearchLevels: context.epicResearchLevels,
    colleggtibleModifiers: context.colleggtibleModifiers,
    proPermit: initialStateStore.proPermit,
  });

  // If the optimized set is DIFFERENT from our saved ELR set, update it
  if (optimized !== savedSet) {
    localLoadout.value = optimized.map(slot => ({
      artifactId: slot.artifactId,
      stones: [...slot.stones],
    }));

    // Auto-save the new optimized loadout
    saveChanges();
  }

  // If the optimized set is DIFFERENT from our currently active set, equip the ELR set
  const currentArtifacts = actionsStore.effectiveSnapshot.artifactLoadout;
  if (!isFunctionallyIdentical(optimized, currentArtifacts)) {
    // If the tab is not 'elr', we need to switch to it before calling equipSet
    // because equipSet uses selectedTab to decide what to equip.
    if (selectedTab.value !== 'elr') {
      selectedTab.value = 'elr';
    }
    equipSet();
  }
}

// Sync local loadout when tab or store state changes
watch(
  [selectedTab, () => actionsStore.effectiveSnapshot],
  () => {
    const setLoadout = artifactSets.value[selectedTab.value];
    if (setLoadout) {
      localLoadout.value = setLoadout.map(slot => ({
        artifactId: slot.artifactId,
        stones: [...slot.stones],
      }));
    } else {
      localLoadout.value = createEmptyLoadout();
    }
  },
  { immediate: true }
);

const isDirty = computed(() => {
  const currentSet = artifactSets.value[selectedTab.value];
  if (!currentSet) {
    // Check if local loadout is non-empty
    return localLoadout.value.some(slot => slot.artifactId !== null);
  }

  return localLoadout.value.some((slot, i) => {
    const orig = currentSet[i];
    if (slot.artifactId !== orig.artifactId) return true;
    if (slot.stones.length !== orig.stones.length) return true;
    return slot.stones.some((stone, j) => stone !== orig.stones[j]);
  });
});

function undoChanges() {
  const currentSet = artifactSets.value[selectedTab.value];
  if (currentSet) {
    localLoadout.value = currentSet.map(slot => ({
      artifactId: slot.artifactId,
      stones: [...slot.stones],
    }));
  } else {
    localLoadout.value = createEmptyLoadout();
  }
}

function checkHabCapacityViolation(
  loadout: ArtifactSlotPayload[],
  snapshot: CalculationsSnapshot,
  actionName: string
): boolean {
  const context = getSimulationContext();
  const artifactMods = calculateArtifactModifiers(activeSlots(loadout as EquippedArtifact[], snapshot.proPermit));
  const habCapacityOutput = calculateHabCapacity_Full({
    habIds: snapshot.habIds,
    researchLevels: snapshot.researchLevels,
    habCapMultiplier: context.colleggtibleModifiers.habCap,
    artifactMultiplier: artifactMods.habCapacity.totalMultiplier,
    artifactEffects: artifactMods.habCapacity.effects,
  });

  const newHabCap = habCapacityOutput.totalFinalCapacity;
  const population = snapshot.population;

  if (newHabCap < population) {
    warningStore.showWarning(
      'Hab Capacity Violation',
      `Cannot ${actionName}. The new habitat capacity (${formatNumber(newHabCap, 3)}) ` +
        `would be lower than your current population (${formatNumber(population, 3)}).`
    );
    return true; // Violation found
  }
  return false;
}

// If equipping/updating a set increased hab capacity (e.g. a new or upgraded
// gusset), queue a "Wait for Full Habs" action right after it.
function insertWaitForFullHabsIfCapacityIncreased(beforeSnapshot: CalculationsSnapshot) {
  if (actionsStore.effectiveSnapshot.habCapacity > beforeSnapshot.habCapacity) {
    actionsStore.pushWaitForFullHabsAction();
  }
}

function saveChanges() {
  const toLoadout: ArtifactSlotPayload[] = localLoadout.value.map(slot => ({
    artifactId: slot.artifactId,
    stones: [...slot.stones],
  }));

  const beforeSnapshot = prepareExecution();

  // If saving to the CURRENTLY EQUIPPED set, validate capacity
  if (selectedTab.value === activeArtifactSet.value) {
    if (checkHabCapacityViolation(toLoadout, beforeSnapshot, 'save changes')) {
      return;
    }
  }

  const payload = {
    setName: selectedTab.value,
    newLoadout: toLoadout,
  };
  const dependencies = computeDependencies(
    'update_artifact_set',
    payload,
    actionsStore.actionsBeforeInsertion,
    actionsStore.initialSnapshot.researchLevels
  );

  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'update_artifact_set',
      payload: {
        setName: selectedTab.value,
        newLoadout: toLoadout,
      },
      cost: 0,
      dependsOn: dependencies,
    },
    beforeSnapshot
  );
  insertWaitForFullHabsIfCapacityIncreased(beforeSnapshot);
}

function equipSet() {
  const beforeSnapshot = prepareExecution();

  // Validation: Check if new hab capacity is lower than current population
  const targetLoadout = beforeSnapshot.artifactSets[selectedTab.value];
  if (targetLoadout && checkHabCapacityViolation(targetLoadout, beforeSnapshot, 'equip this set')) {
    return;
  }

  const payload = {
    setName: selectedTab.value,
  };
  const dependencies = computeDependencies(
    'equip_artifact_set',
    payload,
    actionsStore.actionsBeforeInsertion,
    actionsStore.initialSnapshot.researchLevels
  );

  completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'equip_artifact_set',
      payload: {
        setName: selectedTab.value,
      },
      cost: 0,
      dependsOn: dependencies,
    },
    beforeSnapshot
  );
  insertWaitForFullHabsIfCapacityIncreased(beforeSnapshot);
}
</script>
