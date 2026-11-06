/**
 * Snapshot Computation
 *
 * Captures the current calculation state from all composables.
 */

import type { CalculationsSnapshot, CalculationsFullOutputs, VehicleSlot, ResearchLevels } from '@/types';
import { type HabId } from '@/lib/habs';
import { activeSlots } from '@/lib/artifacts/calculator';
import { useEggValue } from '@/composables/useEggValue';
import { useHabCapacity } from '@/composables/useHabCapacity';
import { useLayRate } from '@/composables/useLayRate';
import { useShippingCapacity } from '@/composables/useShippingCapacity';
import { useEffectiveLayRate } from '@/composables/useEffectiveLayRate';
import { useEarnings } from '@/composables/useEarnings';
import { useInternalHatcheryRate } from '@/composables/useInternalHatcheryRate';

import { useHabCapacityStore } from 'lib/planners/stores/habCapacity';
import { useShippingCapacityStore } from 'lib/planners/stores/shippingCapacity';
import { useCommonResearchStore } from 'lib/planners/stores/commonResearch';
import { usePlanStore } from '@/stores/plan';
import { useInitialStateStore } from '@/stores/initialState';
import { useSilosStore, totalAwayTime } from '@/stores/silos';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useSalesStore } from 'lib/planners/stores/sales';

/**
 * Compute a CalculationsSnapshot from current store state.
 * Uses the existing composables to get all calculation outputs.
 */
export function computeCurrentSnapshot(): CalculationsSnapshot {
  // Get composable outputs
  const { output: eggValue } = useEggValue();
  const { output: habCapacity } = useHabCapacity();
  const { output: layRate } = useLayRate();
  const { output: shipping } = useShippingCapacity();
  const { output: elr } = useEffectiveLayRate();
  const { output: earnings } = useEarnings();
  const { output: ihr } = useInternalHatcheryRate();

  // Get store state for reconstruction
  const habCapacityStore = useHabCapacityStore();
  const shippingCapacityStore = useShippingCapacityStore();
  const commonResearchStore = useCommonResearchStore();
  const planStore = usePlanStore();
  const initialStateStore = useInitialStateStore();
  const silosStore = useSilosStore();
  const fuelTankStore = useFuelTankStore();
  const salesStore = useSalesStore();

  // Calculate silo time
  const siloCapacityLevel = initialStateStore.epicResearchLevels['silo_capacity'] || 0;
  const siloTimeMinutes = totalAwayTime(silosStore.siloCount, siloCapacityLevel);

  return {
    // Key metrics
    eggValue: eggValue.value.finalValue,
    habCapacity: habCapacity.value.totalFinalCapacity,
    elr: elr.value.effectiveLayRate,
    shippingCapacity: shipping.value.totalFinalCapacity,
    layRate: layRate.value.totalRatePerSecond,
    onlineEarnings: earnings.value.onlineEarnings,
    offlineEarnings: earnings.value.offlineEarnings,
    onlineIHR: ihr.value.onlineRate,
    offlineIHR: ihr.value.offlineRate,
    ratePerChickenPerSecond: layRate.value.ratePerChickenPerSecond,
    bankValue: planStore.bankValue,

    // Earning bonus inputs
    te: initialStateStore.truthEggs,
    soulEggs: initialStateStore.soulEggs,
    prophecyEggs: initialStateStore.prophecyEggs,

    // Silo state
    siloCount: silosStore.siloCount,
    siloTimeMinutes,

    // Fuel tank state
    tankLevel: fuelTankStore.tankLevel,
    proPermit: initialStateStore.proPermit,
    fuelTankAmounts: { ...fuelTankStore.fuelAmounts },

    // Truth Eggs state

    // Store state for reconstruction
    vehicles: [...shippingCapacityStore.vehicles],
    habIds: [...habCapacityStore.habIds],
    researchLevels: { ...commonResearchStore.researchLevels },
    artifactLoadout: activeSlots(
      initialStateStore.artifactLoadout.map(slot => ({
        artifactId: slot.artifactId,
        stones: [...slot.stones],
      })),
      initialStateStore.proPermit
    ),
    activeArtifactSet: initialStateStore.activeArtifactSet,
    artifactSets: JSON.parse(JSON.stringify(initialStateStore.artifactSets)),
    population: planStore.population,
    lastStepTime: 0,
    activeSales: { ...salesStore.$state },
    earningsBoost: {
      active: salesStore.earningsBoostActive || false,
      multiplier: salesStore.earningsBoostMultiplier || 1,
    },
  };
}

/**
 * Compute full outputs for modal display.
 * More expensive than basic snapshot - only compute when needed.
 */
export function computeFullOutputs(): CalculationsFullOutputs {
  const { output: eggValue } = useEggValue();
  const { output: habCapacity } = useHabCapacity();
  const { output: layRate } = useLayRate();
  const { output: shipping } = useShippingCapacity();
  const { output: elr } = useEffectiveLayRate();
  const { output: earnings } = useEarnings();
  const { output: ihr } = useInternalHatcheryRate();

  return {
    eggValue: eggValue.value,
    habCapacity: habCapacity.value,
    layRate: layRate.value,
    shippingCapacity: shipping.value,
    elr: elr.value,
    earnings: earnings.value,
    ihr: ihr.value,
  };
}

/**
 * Compute deltas between two snapshots.
 */
export function computeDeltas(
  before: CalculationsSnapshot,
  after: CalculationsSnapshot
): {
  elrDelta: number;
  offlineEarningsDelta: number;
  eggValueDelta: number;
  habCapacityDelta: number;
  layRateDelta: number;
  shippingCapacityDelta: number;
  ihrDelta: number;
  bankDelta: number;
  populationDelta: number;
} {
  return {
    elrDelta: after.elr - before.elr,
    offlineEarningsDelta: after.offlineEarnings - before.offlineEarnings,
    eggValueDelta: after.eggValue - before.eggValue,
    habCapacityDelta: after.habCapacity - before.habCapacity,
    layRateDelta: after.layRate - before.layRate,
    shippingCapacityDelta: after.shippingCapacity - before.shippingCapacity,
    ihrDelta: after.offlineIHR - before.offlineIHR,
    bankDelta: after.bankValue - before.bankValue,
    populationDelta: after.population - before.population,
  };
}

/**
 * Restore store state from a snapshot.
 * Used when replaying actions after an undo or when switching editing groups.
 */
export function restoreFromSnapshot(snapshot: CalculationsSnapshot): void {
  const habCapacityStore = useHabCapacityStore();
  const shippingCapacityStore = useShippingCapacityStore();
  const commonResearchStore = useCommonResearchStore();
  const planStore = usePlanStore();
  const initialStateStore = useInitialStateStore();
  const silosStore = useSilosStore();
  const fuelTankStore = useFuelTankStore();
  const salesStore = useSalesStore();

  // Restore hab state
  habCapacityStore.$patch(state => {
    state.habIds = [...snapshot.habIds] as (HabId | null)[];
    // Keep research levels in sync
    state.researchLevels = { ...snapshot.researchLevels };
  });

  // Restore vehicle state
  shippingCapacityStore.$patch(state => {
    state.vehicles = snapshot.vehicles.map(v => ({ ...v }));
    // Keep research levels in sync
    state.researchLevels = { ...snapshot.researchLevels };
  });

  // Restore common research levels
  commonResearchStore.$patch(state => {
    state.researchLevels = { ...snapshot.researchLevels };
  });

  // Restore plan state
  planStore.$patch(state => {
    state.bankValue = snapshot.bankValue;
    state.population = snapshot.population;
  });

  // Sync artifact state so that composables (which read from initialStateStore.artifactModifiers)
  // stay consistent with the engine simulation. Without this, after an equip_artifact_set or
  // update_artifact_set action, the composables would still compute with the old loadout,
  // causing ELR/earnings/etc. to diverge from the engine-computed snapshot values.
  // Note: We intentionally do NOT sync soulEggs or other truly-initial values here.
  initialStateStore.$patch(state => {
    state.artifactLoadout = snapshot.artifactLoadout.map(slot => ({
      artifactId: slot.artifactId,
      stones: [...slot.stones],
    }));
    state.activeArtifactSet = snapshot.activeArtifactSet;
    state.artifactSets = JSON.parse(JSON.stringify(snapshot.artifactSets));
  });

  // Restore silo state
  if (snapshot.siloCount !== undefined) {
    silosStore.setSiloCount(snapshot.siloCount);
  }

  // Restore fuel tank state
  if (snapshot.fuelTankAmounts) {
    fuelTankStore.$patch(state => {
      state.tankLevel = snapshot.tankLevel ?? state.tankLevel;
      state.fuelAmounts = { ...snapshot.fuelTankAmounts };
    });
  }

  // Restore truth eggs state

  // Restore sales state
  if (snapshot.activeSales) {
    salesStore.$patch(state => {
      state.research = !!snapshot.activeSales.research;
      state.hab = !!snapshot.activeSales.hab;
      state.vehicle = !!snapshot.activeSales.vehicle;

      if (snapshot.earningsBoost) {
        state.earningsBoostActive = snapshot.earningsBoost.active;
        state.earningsBoostMultiplier = snapshot.earningsBoost.multiplier;
      }
    });
  }
}
