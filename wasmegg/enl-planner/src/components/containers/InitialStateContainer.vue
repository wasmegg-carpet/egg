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
    @set-assume-double-earnings="handleSetAssumeDoubleEarnings"
    @set-pro-permit="handleSetProPermit"
    @set-colleggtible-tier="handleSetColleggtibleTier"
  >
    <template #settings-rows>
      <TankLevelSelect :tank-level="fuelTankStore.tankLevel" @set-tank-level="handleSetTankLevel" />
      <EnlightenmentSettingsRows
        :soul-eggs="store.soulEggs"
        :prophecy-eggs="store.prophecyEggs"
        :te="store.truthEggs"
        @set-soul-eggs="handleSetSoulEggs"
        @set-prophecy-eggs="handleSetProphecyEggs"
        @set-te="handleSetTE"
      />
    </template>
  </InitialStateDisplay>
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
import { useCommonResearchStore } from 'lib/planners/stores/commonResearch';
import { useHabCapacityStore } from 'lib/planners/stores/habCapacity';
import { useShippingCapacityStore } from 'lib/planners/stores/shippingCapacity';
import { useSilosStore } from 'lib/planners/stores/silos';
import InitialStateDisplay from 'ui/components/planners/presenters/InitialStateDisplay.vue';
import TankLevelSelect from 'ui/components/planners/presenters/TankLevelSelect.vue';
import EnlightenmentSettingsRows from '@/components/presenters/EnlightenmentSettingsRows.vue';
import { updateInitialSnapshotAndRecalculate } from '@/lib/actions/updateInitialSnapshot';

const store = useInitialStateStore();
const planStore = usePlanStore();
const actionsStore = useActionsStore();
const fuelTankStore = useFuelTankStore();
const commonResearchStore = useCommonResearchStore();
const habCapacityStore = useHabCapacityStore();
const shippingCapacityStore = useShippingCapacityStore();
const silosStore = useSilosStore();

function handleSetEpicResearchLevel(id: string, level: number) {
  store.setEpicResearchLevel(id, level);
  updateInitialSnapshotAndRecalculate();
}

function handleSetColleggtibleTier(id: string, tierIndex: number) {
  store.setColleggtibleTier(id, tierIndex);
  updateInitialSnapshotAndRecalculate();
}

function handleSetTankLevel(level: number) {
  fuelTankStore.setTankLevel(level);
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

const displayRef = ref<InstanceType<typeof InitialStateDisplay> | null>(null);

defineExpose({
  applyPendingAscensionChanges() {
    if (displayRef.value?.hasAscensionChanges) {
      displayRef.value.applyAscensionChanges();
    }
  },
});
</script>
