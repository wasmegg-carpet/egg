/**
 * @module ActionIO
 * @description Import/Export logic for Ascension Plans.
 */

import { downloadFile } from '@/utils/export';
import { useInitialStateStore } from '@/stores/initialState';
import { useVirtueStore } from '@/stores/virtue';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useTruthEggsStore } from '@/stores/truthEggs';
import { useNotesStore } from '@/stores/notes';
import { useSilosStore } from '@/stores/silos';
import { createEmptySnapshot, type VirtueEgg, type Action, type CalculationsSnapshot } from '@/types';
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import { redactBackupForStorage } from '@/lib/artifacts';

export function exportPlanData(actions: Action[], initialSnapshot?: CalculationsSnapshot, activePlanId: string | null = null) {
  const initialStateStore = useInitialStateStore();
  const virtueStore = useVirtueStore();
  const fuelTankStore = useFuelTankStore();
  const truthEggsStore = useTruthEggsStore();
  const notesStore = useNotesStore();

  const silosStore = useSilosStore();

  const baseSoulEggs = initialSnapshot ? initialSnapshot.soulEggs : initialStateStore.soulEggs;
  const baseLoadout = initialSnapshot ? initialSnapshot.artifactLoadout : initialStateStore.artifactLoadout;
  const baseSets = initialSnapshot ? initialSnapshot.artifactSets : initialStateStore.artifactSets;
  const baseActiveSet = initialSnapshot ? initialSnapshot.activeArtifactSet : initialStateStore.activeArtifactSet;
  const baseSiloCount = initialSnapshot ? initialSnapshot.siloCount : silosStore.siloCount;
  const baseTankLevel = initialSnapshot ? (initialSnapshot.tankLevel ?? fuelTankStore.tankLevel) : fuelTankStore.tankLevel;
  const baseFuelAmounts = initialSnapshot ? initialSnapshot.fuelTankAmounts : fuelTankStore.fuelAmounts;
  const baseEggsDelivered = initialSnapshot ? initialSnapshot.eggsDelivered : truthEggsStore.eggsDelivered;
  const baseTeEarned = initialSnapshot ? initialSnapshot.teEarned : truthEggsStore.teEarned;

  // Redacted backup (virtue artifact inventory only — no username, contracts,
  // missions, or serverId) stored as `initialState.rawBackup`, the same field
  // `initialStateStore.hydrate()` already reads on import. Lets artifact
  // recalculation (optimal set search, beam search) work after reloading a
  // saved plan without re-fetching the player's full backup. TEMPORARY:
  // logged to console so the shape/content can be reviewed before we rely on
  // it long-term.
  const redactedBackup = initialStateStore.rawBackup ? redactBackupForStorage(initialStateStore.rawBackup) : null;

  return {
    version: 1,
    timestamp: Date.now(),
    initialState: {
      playerId: 'EIxxxxxxxxxx',
      nickname: 'Redacted',
      lastBackupTime: 0,
      soulEggs: baseSoulEggs,
      epicResearchLevels: initialStateStore.epicResearchLevels,
      colleggtibleTiers: initialStateStore.colleggtibleTiers,
      artifactLoadout: baseLoadout,
      artifactSets: baseSets,
      activeArtifactSet: baseActiveSet,
      currentFarmState: initialStateStore.currentFarmState,
      assumeDoubleEarnings: initialStateStore.assumeDoubleEarnings,
      initialSiloCount: baseSiloCount,
      initialTankLevel: baseTankLevel,
      initialFuelAmounts: baseFuelAmounts,
      initialEggsDelivered: baseEggsDelivered,
      initialTeEarned: baseTeEarned,
      rawBackup: redactedBackup,
    },
    virtueState: {
      shiftCount: virtueStore.initialShiftCount,
      initialTE: virtueStore.initialTE,
      ascensionDate: virtueStore.ascensionDate,
      ascensionTime: virtueStore.ascensionTime,
      ascensionTimezone: virtueStore.ascensionTimezone,
    },
    fuelTankState: {
      tankLevel: baseTankLevel,
      fuelAmounts: baseFuelAmounts,
    },
    truthEggsState: {
      eggsDelivered: baseEggsDelivered,
      teEarned: baseTeEarned,
    },
    notesState: {
      notes: notesStore.notes,
    },
    actions: actions,
    activePlanId: activePlanId,
  };
}

export function exportPlanLogic(actions: Action[], initialSnapshot?: CalculationsSnapshot) {
  const exportData = exportPlanData(actions, initialSnapshot);

  // Sanitization: Ensure any internal mapping IDs or partitions are NOT in the export
  // (In this case, EIxxxxxxxxxx is already a placeholder, and we don't include storage keys)

  const jsonString = JSON.stringify(exportData, null, 2);
  const now = new Date();
  const filename = `ascension-plan-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.json`;
  downloadFile(filename, jsonString, 'application/json');
}

export function importPlanLogic(jsonString: string) {
  const data = JSON.parse(jsonString);
  if (!data.version || !data.actions || !data.initialState) {
    throw new Error('Invalid plan file format');
  }

  const initialStateStore = useInitialStateStore();
  const virtueStore = useVirtueStore();
  const fuelTankStore = useFuelTankStore();
  const truthEggsStore = useTruthEggsStore();
  const notesStore = useNotesStore();

  initialStateStore.hydrate(data.initialState);

  if (data.virtueState) {
    virtueStore.setInitialState(data.virtueState.shiftCount || 0, data.virtueState.initialTE || 0);
    if (data.virtueState.ascensionDate) virtueStore.setAscensionDate(data.virtueState.ascensionDate);
    if (data.virtueState.ascensionTime) virtueStore.setAscensionTime(data.virtueState.ascensionTime);
    if (data.virtueState.ascensionTimezone) virtueStore.setAscensionTimezone(data.virtueState.ascensionTimezone);
  }

  if (data.fuelTankState) {
    fuelTankStore.setTankLevel(data.fuelTankState.tankLevel || 0);
    for (const [egg, amount] of Object.entries((data.fuelTankState.fuelAmounts || {}) as Record<string, number>)) {
      fuelTankStore.setFuelAmount(egg as VirtueEgg, amount);
    }
  }

  if (data.truthEggsState) {
    for (const [egg, amount] of Object.entries((data.truthEggsState.eggsDelivered || {}) as Record<string, number>)) {
      truthEggsStore.setEggsDelivered(egg as VirtueEgg, amount);
    }
    for (const [egg, count] of Object.entries((data.truthEggsState.teEarned || {}) as Record<string, number>)) {
      truthEggsStore.setTEEarned(egg as VirtueEgg, count);
    }
  }

  if (data.notesState) {
    notesStore.setNotes(data.notesState.notes || []);
  } else {
    notesStore.$reset();
  }

  // Merge simple wait_for_time actions into subsequent purchases to reduce clutter
  if (data.actions && data.actions.length > 0) {
    const mergedActions: any[] = [];
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
      payload: { initialEgg: 'curiosity' },
      cost: 0, elrDelta: 0, offlineEarningsDelta: 0, eggValueDelta: 0,
      habCapacityDelta: 0, layRateDelta: 0, shippingCapacityDelta: 0,
      ihrDelta: 0, bankDelta: 0, populationDelta: 0, totalTimeSeconds: 0,
      endState: {
        ...createEmptySnapshot(),
        currentEgg: 'curiosity',
        eggsDelivered: { ...(data.truthEggsState?.eggsDelivered || {}) },
        teEarned: { ...(data.truthEggsState?.teEarned || {}) },
      },
      dependsOn: [], dependents: []
    };
    data.actions = [startAction, ...data.actions];
  }

  if (data.actions) {
    data.actions.forEach((a: any, i: number) => a.index = i);
  }

  return data;
}
