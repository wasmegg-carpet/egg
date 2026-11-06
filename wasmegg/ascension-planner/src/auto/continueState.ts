/**
 * The engine state "Continue Current" runs from: the farm in the save as it is (its egg, habs,
 * vehicles, research, silos and population), wearing the save's own artifact loadout, on top of the
 * base state's permanent progress and egg counts. Shared by the auto planner's first ascension
 * (useAscensionGenerator.ts) and Chain Finder's current ascension (lib/instantSearch/currentAscension.ts).
 */
import { getArtifactLoadoutFromBackup, activeSlots } from '@/lib/artifacts';
import type { EngineState } from '@/engine/types';
import type { CurrentFarmState, VirtueEgg } from '@/types';
import type { ei } from 'lib';

/** The farm's egg type (backup `eggType`) for each virtue egg. */
export const VIRTUE_EGGS_MAP: Record<number, VirtueEgg> = {
  50: 'curiosity',
  51: 'integrity',
  52: 'humility',
  53: 'resilience',
  54: 'kindness',
};

export function makeContinueState(
  base: EngineState,
  farmState: CurrentFarmState,
  rawBackup: ei.IBackup | null,
  earnings: EngineState['artifactSets']['earnings']
): EngineState {
  const rawLoadout = rawBackup ? getArtifactLoadoutFromBackup(rawBackup) : base.artifactLoadout;
  return {
    currentEgg: (VIRTUE_EGGS_MAP[farmState.eggType] || 'curiosity') as VirtueEgg,
    shiftCount: base.shiftCount,
    te: base.te,
    soulEggs: base.soulEggs,
    vehicles: farmState.vehicles || [{ vehicleId: 0, trainLength: 1 }],
    habIds: farmState.habs || [0, null, null, null],
    researchLevels: { ...farmState.commonResearches },
    siloCount: farmState.numSilos || 1,
    tankLevel: base.tankLevel,
    proPermit: base.proPermit,
    artifactLoadout: activeSlots(
      rawLoadout.map(slot => ({
        artifactId: slot.artifactId,
        stones: [...slot.stones],
      })),
      base.proPermit
    ),
    activeArtifactSet: 'elr',
    artifactSets: {
      earnings: earnings ? JSON.parse(JSON.stringify(earnings)) : null,
      elr: JSON.parse(JSON.stringify(rawLoadout)),
    },
    fuelTankAmounts: { ...base.fuelTankAmounts },
    eggsDelivered: { ...base.eggsDelivered },
    teEarned: { ...base.teEarned },
    population: farmState.population || 0,
    lastStepTime: farmState.lastStepTime || 0,
    bankValue: farmState.cash || 0,
    activeSales: { research: false, hab: false, vehicle: false },
    earningsBoost: { active: false, multiplier: 1 },
  };
}
