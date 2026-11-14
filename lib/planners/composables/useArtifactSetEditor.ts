import { computed, watch, type ComputedRef, type Ref } from 'vue';
import { generateActionId, type ArtifactSetName, type ArtifactSlotPayload, type CalculationsSnapshot } from '@planner/types';
import { activeSlots, calculateArtifactModifiers, createEmptyLoadout, type EquippedArtifact } from '@planner/lib/artifacts';
import { useActionsStore } from '@planner/stores/actions';
import { formatNumber } from '@planner/lib/format';
import { computeDependencies } from '../actions/executor';
import { calculateHabCapacity_Full } from '../calculations/habCapacity';
import { getSimulationContext } from '../engine/adapter';
import { useWarningStore } from '../stores/warning';
import { useActionExecutor } from './useActionExecutor';

/** Editing an artifact set on the Artifacts tab: tracks unsaved edits, then saves and equips them. */
export function useArtifactSetEditor(
  selectedTab: Ref<ArtifactSetName>,
  localLoadout: Ref<EquippedArtifact[]>,
  artifactSets: ComputedRef<Record<ArtifactSetName, EquippedArtifact[] | null>>,
  activeArtifactSet: ComputedRef<ArtifactSetName | null>,
  /** `equipOnSave`: for planners with no separate equip step. */
  options: { equipOnSave: boolean }
) {
  const actionsStore = useActionsStore();
  const warningStore = useWarningStore();
  const { prepareExecution, completeExecution } = useActionExecutor();

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
    if (options.equipOnSave && activeArtifactSet.value !== selectedTab.value) equipSet();
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

  return { isDirty, undoChanges, saveChanges, equipSet };
}
