/**
 * @module ActionIO
 * @description Import/Export logic for Ascension Plans.
 */

import { downloadGzipped } from 'lib/planners/utils/export';
import { useInitialStateStore } from '@/stores/initialState';
import { usePlanStore } from '@/stores/plan';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useNotesStore } from 'lib/planners/stores/notes';
import { useSilosStore } from '@/stores/silos';
import { createEmptySnapshot, type FuelEgg, type Action, type CalculationsSnapshot } from '@/types';
import { redactBackupForStorage } from '@/lib/artifacts';

export function exportPlanData(actions: Action[], initialSnapshot?: CalculationsSnapshot, activePlanId: string | null = null) {
  const initialStateStore = useInitialStateStore();
  const planStore = usePlanStore();
  const fuelTankStore = useFuelTankStore();
  const notesStore = useNotesStore();

  const silosStore = useSilosStore();

  const baseSoulEggs = initialSnapshot ? initialSnapshot.soulEggs : initialStateStore.soulEggs;
  const baseProphecyEggs = initialSnapshot ? initialSnapshot.prophecyEggs : initialStateStore.prophecyEggs;
  const baseTruthEggs = initialSnapshot ? initialSnapshot.te : initialStateStore.truthEggs;
  const baseLoadout = initialSnapshot ? initialSnapshot.artifactLoadout : initialStateStore.artifactLoadout;
  const baseSets = initialSnapshot ? initialSnapshot.artifactSets : initialStateStore.artifactSets;
  const baseActiveSet = initialSnapshot ? initialSnapshot.activeArtifactSet : initialStateStore.activeArtifactSet;
  const baseSiloCount = initialSnapshot ? initialSnapshot.siloCount : silosStore.siloCount;
  const baseTankLevel = initialSnapshot ? (initialSnapshot.tankLevel ?? fuelTankStore.tankLevel) : fuelTankStore.tankLevel;
  const baseFuelAmounts = initialSnapshot ? initialSnapshot.fuelTankAmounts : fuelTankStore.fuelAmounts;

  // Redacted backup (artifact inventory only — no username, contracts, missions, or serverId)
  // stored as `initialState.rawBackup`, the same field `initialStateStore.hydrate()` reads on import.
  const redactedBackup = initialStateStore.rawBackup ? redactBackupForStorage(initialStateStore.rawBackup) : null;

  return {
    version: 1,
    timestamp: Date.now(),
    initialState: {
      playerId: 'EIxxxxxxxxxx',
      nickname: 'Redacted',
      lastBackupTime: 0,
      soulEggs: baseSoulEggs,
      prophecyEggs: baseProphecyEggs,
      truthEggs: baseTruthEggs,
      epicResearchLevels: initialStateStore.epicResearchLevels,
      colleggtibleTiers: initialStateStore.colleggtibleTiers,
      artifactLoadout: baseLoadout,
      artifactSets: baseSets,
      activeArtifactSet: baseActiveSet,
      currentFarmState: initialStateStore.currentFarmState,
      assumeDoubleEarnings: initialStateStore.assumeDoubleEarnings,
      researchCube: initialStateStore.researchCube,
      proPermit: initialStateStore.proPermit,
      initialSiloCount: baseSiloCount,
      initialTankLevel: baseTankLevel,
      initialFuelAmounts: baseFuelAmounts,
      rawBackup: redactedBackup,
    },
    planState: {
      ascensionDate: planStore.ascensionDate,
      ascensionTime: planStore.ascensionTime,
      ascensionTimezone: planStore.ascensionTimezone,
    },
    fuelTankState: {
      tankLevel: baseTankLevel,
      fuelAmounts: baseFuelAmounts,
    },
    notesState: {
      notes: notesStore.notes,
    },
    actions: actions,
    activePlanId: activePlanId,
  };
}

export async function exportPlanLogic(actions: Action[], initialSnapshot?: CalculationsSnapshot) {
  const exportData = exportPlanData(actions, initialSnapshot);

  // Sanitization: Ensure any internal mapping IDs or partitions are NOT in the export
  // (In this case, EIxxxxxxxxxx is already a placeholder, and we don't include storage keys)

  const jsonString = JSON.stringify(exportData, null, 2);
  const now = new Date();
  const filename = `enlightenment-plan-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.json`;
  await downloadGzipped(filename, jsonString);
}

export function importPlanLogic(jsonString: string) {
  const data = JSON.parse(jsonString);
  if (!data.version || !data.actions || !data.initialState) {
    throw new Error('Invalid plan file format');
  }

  const initialStateStore = useInitialStateStore();
  const planStore = usePlanStore();
  const fuelTankStore = useFuelTankStore();
  const notesStore = useNotesStore();

  initialStateStore.hydrate(data.initialState);

  if (data.planState) {
    if (data.planState.ascensionDate) planStore.setAscensionDate(data.planState.ascensionDate);
    if (data.planState.ascensionTime) planStore.setAscensionTime(data.planState.ascensionTime);
    if (data.planState.ascensionTimezone) planStore.setAscensionTimezone(data.planState.ascensionTimezone);
  }

  if (data.fuelTankState) {
    fuelTankStore.setTankLevel(data.fuelTankState.tankLevel || 0);
    for (const [egg, amount] of Object.entries((data.fuelTankState.fuelAmounts || {}) as Record<string, number>)) {
      fuelTankStore.setFuelAmount(egg as FuelEgg, amount);
    }
  }

  if (data.notesState) {
    notesStore.setNotes(data.notesState.notes || []);
  } else {
    notesStore.$reset();
  }

  // Merge simple wait_for_time actions into subsequent purchases to reduce clutter
  if (data.actions && data.actions.length > 0) {
    const mergedActions: Action[] = [];
    for (let i = 0; i < data.actions.length; i++) {
      const action = data.actions[i];
      if (action.type === 'wait_for_time') {
        const nextAction = data.actions[i + 1];
        if (nextAction && ['buy_research', 'buy_hab', 'buy_vehicle', 'buy_train_car', 'buy_silo'].includes(nextAction.type)) {
          nextAction.totalTimeSeconds = (nextAction.totalTimeSeconds || 0) + (action.totalTimeSeconds || 0);
          nextAction.bankDelta = (nextAction.bankDelta || 0) + (action.bankDelta || 0);
          continue; // Skip adding the wait_for_time action
        }
      }
      mergedActions.push(action);
    }
    data.actions = mergedActions;
  }

  // Safeguard: Ensure a start_ascension action is present for the UI Action History
  if (data.actions && data.actions.length > 0 && data.actions[0].type !== 'start_ascension') {
    const startAction = {
      id: 'start_' + Math.random().toString(36).substring(2, 9),
      index: 0,
      timestamp: data.actions[0].timestamp || Date.now(),
      type: 'start_ascension',
      payload: {},
      cost: 0, elrDelta: 0, offlineEarningsDelta: 0, eggValueDelta: 0,
      habCapacityDelta: 0, layRateDelta: 0, shippingCapacityDelta: 0,
      ihrDelta: 0, bankDelta: 0, populationDelta: 0, totalTimeSeconds: 0,
      endState: createEmptySnapshot(),
      dependsOn: [], dependents: []
    };
    data.actions = [startAction, ...data.actions];
  }

  if (data.actions) {
    data.actions.forEach((a: Action, i: number) => a.index = i);
  }

  return data;
}
