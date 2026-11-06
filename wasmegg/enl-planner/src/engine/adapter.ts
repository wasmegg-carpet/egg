import type { EngineState, SimulationContext } from './types';
import type { CalculationsSnapshot } from '@/types';
import { useInitialStateStore } from '@/stores/initialState';
import { usePlanStore } from '@/stores/plan';
import { useSilosStore } from '@/stores/silos';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useActionsStore } from '@/stores/actions';
import { restoreFromSnapshot } from '@/lib/actions/snapshot';
import { activeSlots } from '@/lib/artifacts/calculator';
import { getLocalTimestampInTimezone } from 'lib/planners/events';
import { researchCubeOverride } from '@/lib/artifacts/researchCube';

/**
 * Get the current simulation context from Pinia stores.
 * This captures global settings like Epic Research and Colleggtibles.
 */
export function getSimulationContext(): SimulationContext {
  const initialStateStore = useInitialStateStore();
  const planStore = usePlanStore();

  // Convert ascension date/time/timezone to Unix timestamp (seconds)
  const ascensionStartTime = getLocalTimestampInTimezone(
    planStore.ascensionDate,
    planStore.ascensionTime,
    planStore.ascensionTimezone
  );

  return {
    epicResearchLevels: initialStateStore.epicResearchLevels,
    colleggtibleModifiers: initialStateStore.colleggtibleModifiers,
    ascensionStartTime,
    planStartOffset: useActionsStore().planStartOffset || 0,
    assumeDoubleEarnings: initialStateStore.assumeDoubleEarnings,
    researchCubeMultiplier: researchCubeOverride(initialStateStore.researchCube),
    rawBackup: initialStateStore.rawBackup || undefined,
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
      te: initialSnapshot.te,
      soulEggs: initialSnapshot.soulEggs,
      prophecyEggs: initialSnapshot.prophecyEggs,
      vehicles: [...initialSnapshot.vehicles],
      habIds: [...initialSnapshot.habIds],
      researchLevels: { ...initialSnapshot.researchLevels },
      siloCount: initialSnapshot.siloCount,
      tankLevel: initialSnapshot.tankLevel || 0,
      proPermit: initialSnapshot.proPermit,
      artifactLoadout: initialSnapshot.artifactLoadout.map(slot => ({
        artifactId: slot.artifactId,
        stones: [...slot.stones],
      })),
      fuelTankAmounts: { ...initialSnapshot.fuelTankAmounts },
      activeArtifactSet: initialSnapshot.activeArtifactSet,
      artifactSets: JSON.parse(JSON.stringify(initialSnapshot.artifactSets)),
      population: initialSnapshot.population,
      lastStepTime: initialSnapshot.lastStepTime,
      bankValue: initialSnapshot.bankValue || 0,
      activeSales: { ...initialSnapshot.activeSales },
      earningsBoost: { ...initialSnapshot.earningsBoost },
    };
  }

  const planStore = usePlanStore();
  const initialStateStore = useInitialStateStore();
  const silosStore = useSilosStore();
  const fuelTankStore = useFuelTankStore();

  const isContinuing = initialStateStore.isContinuing;

  // Fallback state
  return {
    te: initialStateStore.truthEggs,
    soulEggs: initialStateStore.soulEggs,
    prophecyEggs: initialStateStore.prophecyEggs,

    vehicles: (isContinuing && initialStateStore.currentFarmState?.vehicles) || [{ vehicleId: 0, trainLength: 1 }],
    habIds: (isContinuing && initialStateStore.currentFarmState?.habs) || [0, null, null, null],
    researchLevels: isContinuing ? { ...initialStateStore.currentFarmState?.commonResearches } : {},
    siloCount: silosStore.siloCount || 1,
    tankLevel: fuelTankStore.tankLevel || 0,
    proPermit: initialStateStore.proPermit,

    artifactLoadout: activeSlots(
      initialStateStore.artifactLoadout.map(slot => ({
        artifactId: slot.artifactId,
        stones: [...slot.stones],
      })),
      initialStateStore.proPermit
    ),

    // Progress state starts from what was in the backup
    fuelTankAmounts: { ...initialStateStore.initialFuelAmounts },
    activeArtifactSet: initialStateStore.activeArtifactSet,
    artifactSets: JSON.parse(JSON.stringify(initialStateStore.artifactSets)),

    population: (isContinuing && initialStateStore.currentFarmState?.population) || 0,
    lastStepTime: (isContinuing && initialStateStore.currentFarmState?.lastStepTime) || 0,
    bankValue: (isContinuing && initialStateStore.currentFarmState?.cash) || planStore.bankValue || 0,
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
