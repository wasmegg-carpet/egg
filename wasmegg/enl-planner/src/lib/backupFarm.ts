/**
 * The enlightenment farm read straight from a backup, with no store involved.
 * `initialState.loadFromBackup` stores this, but the stored copy changes afterwards (the farm is
 * caught up to the plan start by `catchUpFarmState`), so code that needs the save as it is reads
 * the backup with this.
 */
import { ei } from 'lib';
import type { CurrentFarmState, ResearchLevels, VehicleSlot } from '@/types';

/** The enlightenment farm, or null when the save isn't on the Enlightenment egg. */
export function parseEnlightenmentFarm(backup: ei.IBackup): CurrentFarmState | null {
  const farm = backup.farms?.find(f => f.eggType === ei.Egg.ENLIGHTENMENT);
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
