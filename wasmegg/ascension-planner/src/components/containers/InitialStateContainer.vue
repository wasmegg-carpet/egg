<template>
  <InitialStateDisplay
    ref="displayRef"
    :has-data="store.hasData"
    :epic-research-levels="store.epicResearchLevels"
    :ascension-date="planStore.ascensionDate"
    :ascension-time="planStore.ascensionTime"
    :ascension-timezone="planStore.ascensionTimezone"
    :tank-level="fuelTankStore.tankLevel"
    :fuel-amounts="store.initialFuelAmounts"
    :tank-capacity="fuelTankStore.tankCapacity"
    :assume-double-earnings="store.assumeDoubleEarnings"
    :pro-permit="store.proPermit"
    :colleggtible-tiers="store.colleggtibleTiers"
    @set-epic-research-level="handleSetEpicResearchLevel"
    @set-ascension-date="handleSetAscensionDate"
    @set-ascension-time="handleSetAscensionTime"
    @set-ascension-timezone="handleSetAscensionTimezone"
    @apply-ascension-settings="handleApplyAscensionSettings"
    @set-tank-level="handleSetTankLevel"
    @set-fuel-amount="handleSetFuelAmount"
    @set-assume-double-earnings="handleSetAssumeDoubleEarnings"
    @set-pro-permit="handleSetProPermit"
    @set-colleggtible-tier="handleSetColleggtibleTier"
  >
    <template #settings-rows>
      <AscensionSettingsRows
        :initial-egg="startAction?.payload.initialEgg ?? 'curiosity'"
        :initial-shift-count="planStore.initialShiftCount"
        :soul-eggs="store.soulEggs"
        @set-initial-egg="handleSetInitialEgg"
        @set-initial-shift-count="handleSetInitialShiftCount"
        @set-soul-eggs="handleSetSoulEggs"
      />
    </template>
    <template #sections>
      <VirtueProgressSections
        :has-data="store.hasData"
        :pro-permit="store.proPermit"
        :artifact-loadout="store.artifactLoadout"
        :eggs-delivered="store.initialEggsDelivered"
        :te-earned="store.initialTeEarned"
        :te-pending="store.initialTePending"
        :total-te="initialTotalTe"
        :artifact-sets="store.artifactSets"
        :active-artifact-set="store.activeArtifactSet"
        :clothed-te="earningsClothedTe"
        @update:artifact-loadout="handleArtifactLoadout"
        @set-eggs-delivered="handleSetEggsDelivered"
        @set-te-earned="handleSetTEEarned"
        @include-pending-te="handleIncludePendingTe"
        @save-current-to-set="handleSaveCurrentToSet"
        @update-artifact-set="handleUpdateArtifactSet"
        @set-active-artifact-set="handleSetActiveArtifactSet"
      />
    </template>
  </InitialStateDisplay>
</template>

<script setup lang="ts">
/**
 * Container component for Initial State.
 * Displays player info loaded from backup.
 */
import { computed, ref } from 'vue';
import { useInitialStateStore } from '@/stores/initialState';
import { usePlanStore } from '@/stores/plan';
import { useActionsStore } from '@/stores/actions';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useTruthEggsStore } from '@/stores/truthEggs';
import { useCommonResearchStore } from 'lib/planners/stores/commonResearch';
import { useHabCapacityStore } from 'lib/planners/stores/habCapacity';
import { useShippingCapacityStore } from 'lib/planners/stores/shippingCapacity';
import { useSilosStore } from 'lib/planners/stores/silos';
import InitialStateDisplay from 'ui/components/planners/presenters/InitialStateDisplay.vue';
import AscensionSettingsRows from '@/components/presenters/AscensionSettingsRows.vue';
import VirtueProgressSections from '@/components/presenters/VirtueProgressSections.vue';
import type { VirtueEgg, Action, ArtifactSetName } from '@/types';
import { VIRTUE_EGGS } from '@/types';
import type { EquippedArtifact } from '@/lib/artifacts';
import { calculateClothedTEForSet } from '@/lib/artifacts';

const store = useInitialStateStore();
const planStore = usePlanStore();
const actionsStore = useActionsStore();
const fuelTankStore = useFuelTankStore();
const truthEggsStore = useTruthEggsStore();
const commonResearchStore = useCommonResearchStore();
const habCapacityStore = useHabCapacityStore();
const shippingCapacityStore = useShippingCapacityStore();
const silosStore = useSilosStore();

const startAction = computed(() => actionsStore.getStartAction() as Action<'start_ascension'> | undefined);

import { computeSnapshot } from 'lib/planners/engine/compute';
import { getSimulationContext, createBaseEngineState } from 'lib/planners/engine/adapter';

function updateInitialSnapshotAndRecalculate() {
  // Recompute the pure initial snapshot from base conditions (ignoring simulated head state)
  const context = getSimulationContext();
  const baseState = createBaseEngineState(null);
  const initialSnapshot = computeSnapshot(baseState, context);

  actionsStore.setInitialSnapshot(initialSnapshot);
}

const initialTotalTe = computed(() => Object.values(store.initialTeEarned).reduce((sum, val) => sum + val, 0));

// Clothed TE for the earnings artifact set, computed from live initial-state inputs
// (not the frozen backup snapshot) so it stays in sync as the player edits research/colleggtibles.
const earningsClothedTe = computed<number | null>(() => {
  if (!store.artifactSets.earnings) return null;
  return calculateClothedTEForSet(store.artifactSets.earnings, {
    truthEggs: initialTotalTe.value,
    colleggtibleModifiers: store.colleggtibleModifiers,
    labUpgradeLevel: store.epicResearchLevels['cheaper_research'] ?? 0,
    proPermit: store.proPermit,
  });
});


function handleSetEpicResearchLevel(id: string, level: number) {
  store.setEpicResearchLevel(id, level);
  updateInitialSnapshotAndRecalculate();
}

function handleSetColleggtibleTier(id: string, tierIndex: number) {
  store.setColleggtibleTier(id, tierIndex);
  updateInitialSnapshotAndRecalculate();
}

function handleArtifactLoadout(loadout: EquippedArtifact[]) {
  store.setArtifactLoadout(loadout);
  updateInitialSnapshotAndRecalculate();
}

function handleSetInitialEgg(egg: VirtueEgg) {
  // Update the actions store
  actionsStore.setInitialEgg(egg);

  // Update the virtue store's current egg
  planStore.setCurrentEgg(egg);

  updateInitialSnapshotAndRecalculate();
}

function handleSetTankLevel(level: number) {
  fuelTankStore.setTankLevel(level);
  updateInitialSnapshotAndRecalculate();
}

function handleSetFuelAmount(egg: VirtueEgg, amount: number) {
  store.setInitialFuelAmount(egg, amount);
  updateInitialSnapshotAndRecalculate();
}

function handleSetEggsDelivered(egg: VirtueEgg, amount: number) {
  // We still use truthEggsStore for the sync logic (detecting TE thresholds)
  // but we must store the resulting initial values back into InitialStateStore
  truthEggsStore.$patch(state => {
    state.eggsDelivered = { ...store.initialEggsDelivered };
    state.teEarned = { ...store.initialTeEarned };
  });

  truthEggsStore.setEggsDeliveredWithSync(egg, amount);

  // Sync back to InitialStateStore
  for (const e of VIRTUE_EGGS) {
    store.setInitialEggsDelivered(e, truthEggsStore.eggsDelivered[e]);
    store.setInitialTeEarned(e, truthEggsStore.teEarned[e]);
  }

  // Also update the virtue store's total TE and initial TE baseline
  planStore.setTE(truthEggsStore.totalTE);
  planStore.setInitialTE(truthEggsStore.totalTE);

  updateInitialSnapshotAndRecalculate();
}

function handleSetTEEarned(egg: VirtueEgg, count: number) {
  truthEggsStore.$patch(state => {
    state.eggsDelivered = { ...store.initialEggsDelivered };
    state.teEarned = { ...store.initialTeEarned };
  });

  truthEggsStore.setTEEarnedWithSync(egg, count);

  // Sync back to InitialStateStore
  for (const e of VIRTUE_EGGS) {
    store.setInitialEggsDelivered(e, truthEggsStore.eggsDelivered[e]);
    store.setInitialTeEarned(e, truthEggsStore.teEarned[e]);
  }

  // Also update the virtue store's total TE and initial TE baseline
  planStore.setTE(truthEggsStore.totalTE);
  planStore.setInitialTE(truthEggsStore.totalTE);

  updateInitialSnapshotAndRecalculate();
}

function handleIncludePendingTe() {
  // Initialize truthEggsStore with current state for sync logic
  truthEggsStore.$patch(state => {
    state.eggsDelivered = { ...store.initialEggsDelivered };
    state.teEarned = { ...store.initialTeEarned };
  });

  let changed = false;

  for (const egg of VIRTUE_EGGS) {
    const pending = store.initialTePending[egg];
    if (pending > 0) {
      const currentEarned = store.initialTeEarned[egg];
      const newTotal = Math.min(98, currentEarned + pending);

      // Update via truthEggsStore to handle sync logic
      truthEggsStore.setTEEarned(egg, newTotal);

      // Clear pending
      store.setInitialTePending(egg, 0);
      changed = true;
    }
  }

  if (changed) {
    // Sync back to InitialStateStore
    for (const e of VIRTUE_EGGS) {
      store.setInitialEggsDelivered(e, truthEggsStore.eggsDelivered[e]);
      store.setInitialTeEarned(e, truthEggsStore.teEarned[e]);
    }

    // Update virtue store
    planStore.setTE(truthEggsStore.totalTE);
    planStore.setInitialTE(truthEggsStore.totalTE);

    updateInitialSnapshotAndRecalculate();
  }
}

function handleSetTE(te: number) {
  planStore.setTE(te);
  planStore.setInitialTE(te);
  updateInitialSnapshotAndRecalculate();
}

function handleSetInitialShiftCount(count: number) {
  planStore.setInitialShiftCount(count);
  updateInitialSnapshotAndRecalculate();
}

function handleSetAscensionDate(date: string) {
  planStore.setAscensionDate(date);
  actionsStore.recalculateFrom(0);
}

function handleSetAscensionTime(time: string) {
  planStore.setAscensionTime(time);
  actionsStore.recalculateFrom(0);
}

function handleSetAscensionTimezone(timezone: string) {
  planStore.setAscensionTimezone(timezone);
  actionsStore.recalculateFrom(0);
}

function handleApplyAscensionSettings(date: string, time: string, timezone: string) {
  planStore.setAscensionDate(date);
  planStore.setAscensionTime(time);
  planStore.setAscensionTimezone(timezone);
  actionsStore.recalculateFrom(0);
}

function handleSetSoulEggs(count: number) {
  store.setSoulEggs(count);
  updateInitialSnapshotAndRecalculate();
}

function handleSetAssumeDoubleEarnings(enabled: boolean) {
  store.setAssumeDoubleEarnings(enabled);
  updateInitialSnapshotAndRecalculate();
}

function handleSetProPermit(enabled: boolean) {
  store.setProPermit(enabled);
  updateInitialSnapshotAndRecalculate();
}

function handleSaveCurrentToSet(setName: ArtifactSetName) {
  store.saveCurrentToSet(setName);
  updateInitialSnapshotAndRecalculate();
}

function handleUpdateArtifactSet(setName: ArtifactSetName, loadout: EquippedArtifact[]) {
  store.updateArtifactSet(setName, loadout);
  updateInitialSnapshotAndRecalculate();
}

function handleSetActiveArtifactSet(setName: ArtifactSetName) {
  store.setActiveArtifactSet(setName);
  updateInitialSnapshotAndRecalculate();
}

const displayRef = ref<InstanceType<typeof InitialStateDisplay> | null>(null);

defineExpose({
  applyPendingAscensionChanges() {
    if (displayRef.value?.hasAscensionChanges) {
      displayRef.value.applyAscensionChanges();
    }
  },
});
</script>
