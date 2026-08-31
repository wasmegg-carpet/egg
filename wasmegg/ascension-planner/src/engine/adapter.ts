import type { EngineState, SimulationContext } from './types';
import { CalculationsSnapshot, VIRTUE_EGGS, VirtueEgg } from '@/types';
import { useInitialStateStore } from '@/stores/initialState';
import { useVirtueStore } from '@/stores/virtue';
import { useAutoPlannerStore } from '@/stores/autoPlanner';
import { useSilosStore } from '@/stores/silos';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useActionsStore } from '@/stores/actions';
import { restoreFromSnapshot } from '@/lib/actions/snapshot';
import { getLocalTimestampInTimezone } from '@/lib/events';

/**
 * Get the current simulation context from Pinia stores.
 * This captures global settings like Epic Research and Colleggtibles.
 */
export function getSimulationContext(): SimulationContext {
  const initialStateStore = useInitialStateStore();
  const virtueStore = useVirtueStore();

  // Convert ascension date/time/timezone to Unix timestamp (seconds)
  const ascensionStartTime = getLocalTimestampInTimezone(
    virtueStore.ascensionDate,
    virtueStore.ascensionTime,
    virtueStore.ascensionTimezone
  );

  return {
    epicResearchLevels: initialStateStore.epicResearchLevels,
    colleggtibleModifiers: initialStateStore.colleggtibleModifiers,
    ascensionStartTime,
    planStartOffset: (useActionsStore() as any).planStartOffset || 0,
    assumeDoubleEarnings: initialStateStore.assumeDoubleEarnings,
    rawBackup: initialStateStore.rawBackup || undefined,
    deferForEarningsMode: useAutoPlannerStore().deferForEarningsMode,
  };
}

/**
 * Create the base engine state from initial conditions.
 * This represents the state BEFORE the first action (start_ascension).
 */
export function createBaseEngineState(initialSnapshot?: CalculationsSnapshot | null): EngineState {
  // Deliberately NOT hoisted to the top of the function: this branch (a snapshot was provided)
  // never reads any of the four stores below, and several callers — computeTierMilestoneChain
  // (calculations/milestoneChain.ts), reused unchanged by both auto/shifts/c3.ts and the beam
  // search engine (src/beam-search/engine/macros.ts) — call this with a snapshot from contexts
  // with no active Pinia instance (a Web Worker, or a plain vitest unit test). Hoisting these calls
  // unconditionally previously broke exactly that: `useXStore()` throws immediately if there's no
  // active Pinia app, even though this branch's return value never depends on any store.
  if (initialSnapshot) {
    return {
      currentEgg: initialSnapshot.currentEgg,
      shiftCount: initialSnapshot.shiftCount,
      te: initialSnapshot.te,
      soulEggs: initialSnapshot.soulEggs,
      vehicles: [...initialSnapshot.vehicles],
      habIds: [...initialSnapshot.habIds],
      researchLevels: { ...initialSnapshot.researchLevels },
      siloCount: initialSnapshot.siloCount,
      tankLevel: initialSnapshot.tankLevel || 0,
      artifactLoadout: initialSnapshot.artifactLoadout.map(slot => ({
        artifactId: slot.artifactId,
        stones: [...slot.stones],
      })),
      fuelTankAmounts: { ...initialSnapshot.fuelTankAmounts },
      eggsDelivered: { ...initialSnapshot.eggsDelivered },
      teEarned: { ...initialSnapshot.teEarned },
      activeArtifactSet: initialSnapshot.activeArtifactSet,
      artifactSets: JSON.parse(JSON.stringify(initialSnapshot.artifactSets)),
      population: initialSnapshot.population,
      lastStepTime: initialSnapshot.lastStepTime,
      bankValue: initialSnapshot.bankValue || 0,
      activeSales: { ...initialSnapshot.activeSales },
      earningsBoost: { ...initialSnapshot.earningsBoost },
    };
  }

  const virtueStore = useVirtueStore();
  const initialStateStore = useInitialStateStore();
  const silosStore = useSilosStore();
  const fuelTankStore = useFuelTankStore();

  const isContinuing = initialStateStore.isContinuing;

  // Fallback state
  return {
    currentEgg: (isContinuing && initialStateStore.currentFarmState?.eggType
      ? VIRTUE_EGGS[initialStateStore.currentFarmState.eggType - 50]
      : 'curiosity') as VirtueEgg,
    shiftCount: virtueStore.initialShiftCount,
    te: virtueStore.initialTE,
    soulEggs: initialStateStore.soulEggs,

    vehicles: (isContinuing && initialStateStore.currentFarmState?.vehicles) || [{ vehicleId: 0, trainLength: 1 }],
    habIds: (isContinuing && initialStateStore.currentFarmState?.habs) || [0, null, null, null],
    researchLevels: isContinuing ? { ...initialStateStore.currentFarmState?.commonResearches } : {},
    siloCount: silosStore.siloCount || 1,
    tankLevel: fuelTankStore.tankLevel || 0,

    artifactLoadout: initialStateStore.artifactLoadout.map(slot => ({
      artifactId: slot.artifactId,
      stones: [...slot.stones],
    })),

    // Progress state starts from what was in the backup
    fuelTankAmounts: { ...initialStateStore.initialFuelAmounts },
    eggsDelivered: { ...initialStateStore.initialEggsDelivered },
    teEarned: { ...initialStateStore.initialTeEarned },
    activeArtifactSet: initialStateStore.activeArtifactSet,
    artifactSets: JSON.parse(JSON.stringify(initialStateStore.artifactSets)),

    population: (isContinuing && initialStateStore.currentFarmState?.population) || 0,
    lastStepTime: (isContinuing && initialStateStore.currentFarmState?.lastStepTime) || 0,
    bankValue: (isContinuing && initialStateStore.currentFarmState?.cash) || virtueStore.bankValue || 0,
    activeSales: {
      research: false,
      hab: false,
      vehicle: false,
    },
    earningsBoost: {
      active: false,
      multiplier: 1,
    },
  };
}

/**
 * Sync Pinia stores to match a calculation snapshot.
 * This allows the rest of the application (which relies on stores)
 * to reflect the state of the simulation.
 */
export function syncStoresToSnapshot(snapshot: CalculationsSnapshot): void {
  restoreFromSnapshot(snapshot);
}
