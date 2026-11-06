<template>
  <div class="space-y-3">

    <!-- Artifact set editor (one set on an enlightenment farm) -->
    <div class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-visible">
      <div class="px-3 py-2 bg-gray-50/50 border-b border-gray-100 flex flex-col gap-2.5">
        <div class="flex justify-between items-center">

          <div class="flex items-center gap-2">
            <button
              class="px-3 py-1 bg-white border border-blue-200 hover:bg-blue-50 hover:border-blue-300 text-blue-700 text-[10px] font-bold uppercase tracking-widest rounded-lg shadow-sm transition-colors"
              v-tippy="'Equip the artifacts and stones that earn the most while offline right now'"
              @click="applyBest('offlineEarnings')"
            >
              Max Offline Earnings
            </button>
            <button
              class="px-3 py-1 bg-white border border-blue-200 hover:bg-blue-50 hover:border-blue-300 text-blue-700 text-[10px] font-bold uppercase tracking-widest rounded-lg shadow-sm transition-colors"
              v-tippy="'Equip the highest offline internal hatchery rate (the slots IHR can\'t use go to offline earnings)'"
              @click="applyBest('ihr')"
            >
              Max IHR
            </button>
          </div>

          <div class="flex items-center gap-2">
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
            <h4 class="text-[10px] font-bold text-blue-900 uppercase tracking-tight mb-0.5">Clarity Stones</h4>
            <p class="text-[10px] text-blue-700 leading-tight">
              On an enlightenment farm an artifact and its stones do nothing without a clarity stone in that
              artifact. Each clarity stone adds its share of their effects. Light of Eggendil always works in full.
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
import { useActionExecutor } from '@/composables/useActionExecutor';
import { computeDependencies } from '@/lib/actions/executor';
import { calculateHabCapacity_Full } from 'lib/planners/calculations/habCapacity';
import { getSimulationContext, createBaseEngineState } from '@/engine/adapter';
import { optimizeArtifacts, type ArtifactGoal } from '@/lib/artifacts/optimizeArtifacts';
import { formatNumber } from '@/lib/format';

const initialStateStore = useInitialStateStore();
const actionsStore = useActionsStore();
const warningStore = useWarningStore();
const { prepareExecution, completeExecution } = useActionExecutor();

const activeArtifactSet = computed(() => actionsStore.effectiveSnapshot.activeArtifactSet);
const artifactSets = computed(() => actionsStore.effectiveSnapshot.artifactSets);

// One set on an enlightenment farm; the second set the plan model has goes unused.
const selectedTab = ref<ArtifactSetName>('earnings');

// Local state for the selected set (allows unsaved changes)
const localLoadout = ref<EquippedArtifact[]>(createEmptyLoadout());

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
  if (activeArtifactSet.value !== selectedTab.value) equipSet();
}

// One click: the best loadout for the goal at this point in the plan, saved to this set and equipped.
function applyBest(goal: ArtifactGoal) {
  const result = optimizeArtifacts(
    createBaseEngineState(actionsStore.effectiveSnapshot),
    getSimulationContext(),
    goal
  );
  if (!result.ok) {
    warningStore.showWarning(goal === 'ihr' ? 'Max IHR' : 'Max Offline Earnings', result.reason);
    return;
  }
  localLoadout.value = result.loadout;
  if (isDirty.value) saveChanges();
  else if (activeArtifactSet.value !== selectedTab.value) equipSet();
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
