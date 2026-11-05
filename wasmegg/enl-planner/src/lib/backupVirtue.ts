/**
 * The virtue progress and the virtue farm read straight from a backup, with no store involved.
 * `initialState.loadFromBackup` stores these, but the stored copies change afterwards (the farm is
 * caught up to the plan start by `catchUpFarmState`, and pending TE is rolled into earned by
 * `rollUpPendingTE`), so code that needs the save as it is reads the backup with these.
 */
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import type { ei } from 'lib';
import type { CurrentFarmState, ResearchLevels, VehicleSlot, VirtueEgg } from '@/types';

export interface VirtueProgress {
  teEarned: Record<VirtueEgg, number>;
  eggsDelivered: Record<VirtueEgg, number>;
  /** TE the eggs delivered have passed but that has not been claimed yet. */
  tePending: Record<VirtueEgg, number>;
}

/** Claimed TE (`eovEarned`), eggs delivered and pending TE per egg. Backup indices 0-4 map to:
 *  Curiosity, Integrity, Humility, Resilience, Kindness. */
export function parseVirtueProgress(backup: ei.IBackup): VirtueProgress {
  const eovEarned = backup.virtue?.eovEarned ?? [];
  const teEarned: Record<VirtueEgg, number> = {
    curiosity: eovEarned[0] ?? 0,
    integrity: eovEarned[1] ?? 0,
    humility: eovEarned[2] ?? 0,
    resilience: eovEarned[3] ?? 0,
    kindness: eovEarned[4] ?? 0,
  };
  const eggsDeliveredArray = backup.virtue?.eggsDelivered ?? [];
  const eggsDelivered: Record<VirtueEgg, number> = {
    curiosity: eggsDeliveredArray[0] ?? 0,
    integrity: eggsDeliveredArray[1] ?? 0,
    humility: eggsDeliveredArray[2] ?? 0,
    resilience: eggsDeliveredArray[3] ?? 0,
    kindness: eggsDeliveredArray[4] ?? 0,
  };
  // Pending = (Theoretical TE from delivered) - (Actual Earned TE)
  const tePending = Object.fromEntries(
    (Object.keys(eggsDelivered) as VirtueEgg[]).map(egg => [
      egg,
      Math.max(0, countTEThresholdsPassed(eggsDelivered[egg]) - teEarned[egg]),
    ])
  ) as Record<VirtueEgg, number>;
  return { teEarned, eggsDelivered, tePending };
}

/** The active virtue farm (egg types 50-54), or null when the save has none. */
export function parseVirtueFarm(backup: ei.IBackup): CurrentFarmState | null {
  const farm = backup.farms?.find(f => f.eggType && f.eggType >= 50 && f.eggType <= 54);
  if (!farm) return null;

  const commonResearches: ResearchLevels = {};
  for (const r of farm.commonResearch || []) {
    if (r.id && r.level !== null && r.level !== undefined) commonResearches[r.id] = r.level;
  }

  // Parse habs (can be numbers or objects with type field)
  const habs: (number | null)[] = (farm.habs || []).map(h => ((h as number) === 19 ? null : (h as number)));
  // Ensure at least 4 slots for consistency
  while (habs.length < 4) habs.push(null);

  // Parse vehicles (can be numbers with farm.trainLength or objects)
  const trainLength = farm.trainLength || [];
  const vehicles: VehicleSlot[] = (farm.vehicles || []).map((v, idx: number) => ({
    vehicleId: v as number | null,
    trainLength: trainLength[idx] || 1,
  }));

  // Calculate population from hab populations if available, otherwise use numChickens
  let population = farm.numChickens || 0;
  if (farm.habPopulation && Array.isArray(farm.habPopulation)) {
    population = farm.habPopulation.reduce((sum: number, p: number) => sum + (p || 0), 0);
  }

  return {
    eggType: farm.eggType as number,
    cash: farm.unclaimedCash || Math.max(0, (farm.cashEarned || 0) - (farm.cashSpent || 0)),
    numSilos: farm.silosOwned || 1,
    commonResearches,
    habs,
    vehicles,
    population,
    deliveredEggs: farm.eggsLaid || 0,
    lastStepTime: farm.lastStepTime || 0,
    cashEarned: farm.cashEarned || 0,
    cashSpent: farm.cashSpent || 0,
  };
}
