<template>
  <InitialStateDisplay
    ref="displayRef"
    :has-data="store.hasData"
    :epic-research-levels="store.epicResearchLevels"
    :artifact-loadout="store.artifactLoadout"
    :te="store.truthEggs"
    :prophecy-eggs="store.prophecyEggs"
    :ascension-date="planStore.ascensionDate"
    :ascension-time="planStore.ascensionTime"
    :ascension-timezone="planStore.ascensionTimezone"
    :tank-level="fuelTankStore.tankLevel"
    :fuel-amounts="store.initialFuelAmounts"
    :tank-capacity="fuelTankStore.tankCapacity"
    :soul-eggs="store.soulEggs"
    :assume-double-earnings="store.assumeDoubleEarnings"
    :pro-permit="store.proPermit"
    :artifact-sets="store.artifactSets"
    :active-artifact-set="store.activeArtifactSet"
    :colleggtible-tiers="store.colleggtibleTiers"
    @set-epic-research-level="handleSetEpicResearchLevel"
    @update:artifact-loadout="handleArtifactLoadout"
    @set-te="handleSetTE"
    @set-prophecy-eggs="handleSetProphecyEggs"
    @set-ascension-date="handleSetAscensionDate"
    @set-ascension-time="handleSetAscensionTime"
    @set-ascension-timezone="handleSetAscensionTimezone"
    @apply-ascension-settings="handleApplyAscensionSettings"
    @set-tank-level="handleSetTankLevel"
    @set-fuel-amount="handleSetFuelAmount"
    @set-soul-eggs="handleSetSoulEggs"
    @set-assume-double-earnings="handleSetAssumeDoubleEarnings"
    @set-pro-permit="handleSetProPermit"
    @save-current-to-set="handleSaveCurrentToSet"
    @update-artifact-set="handleUpdateArtifactSet"
    @set-active-artifact-set="handleSetActiveArtifactSet"
    @set-colleggtible-tier="handleSetColleggtibleTier"
  />
</template>

<script setup lang="ts">
/**
 * Container component for Initial State.
 * Displays player info loaded from backup.
 */
import { ref } from 'vue';
import { useInitialStateStore } from '@/stores/initialState';
import { usePlanStore } from '@/stores/plan';
import { useActionsStore } from '@/stores/actions';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useCommonResearchStore } from '@/stores/commonResearch';
import { useHabCapacityStore } from '@/stores/habCapacity';
import { useShippingCapacityStore } from '@/stores/shippingCapacity';
import { useSilosStore } from '@/stores/silos';
import InitialStateDisplay from '@/components/presenters/InitialStateDisplay.vue';
import type { FuelEgg, ArtifactSetName } from '@/types';
import type { EquippedArtifact } from '@/lib/artifacts';

const store = useInitialStateStore();
const planStore = usePlanStore();
const actionsStore = useActionsStore();
const fuelTankStore = useFuelTankStore();
const commonResearchStore = useCommonResearchStore();
const habCapacityStore = useHabCapacityStore();
const shippingCapacityStore = useShippingCapacityStore();
const silosStore = useSilosStore();

import { computeSnapshot } from '@/engine/compute';
import { getSimulationContext, createBaseEngineState } from '@/engine/adapter';

function updateInitialSnapshotAndRecalculate() {
  // Recompute the pure initial snapshot from base conditions (ignoring simulated head state)
  const context = getSimulationContext();
  const baseState = createBaseEngineState(null);
  const initialSnapshot = computeSnapshot(baseState, context);

  actionsStore.setInitialSnapshot(initialSnapshot);
}

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

function handleSetTankLevel(level: number) {
  fuelTankStore.setTankLevel(level);
  updateInitialSnapshotAndRecalculate();
}

function handleSetFuelAmount(egg: FuelEgg, amount: number) {
  store.setInitialFuelAmount(egg, amount);
  updateInitialSnapshotAndRecalculate();
}

function handleSetTE(te: number) {
  store.setTruthEggs(te);
  updateInitialSnapshotAndRecalculate();
}

function handleSetProphecyEggs(count: number) {
  store.setProphecyEggs(count);
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
