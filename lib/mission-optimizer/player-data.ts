// What the optimizer reads off a player's save: ships, inventory, crafting progress and the virtue
// tank. Pure, so the artifact explorer's store and the ascension planner derive the same figures
// from the same backup.

import {
  ei,
  Inventory,
  newShipsConfig,
  shipLevelLaunchPointThresholds,
  spaceshipList,
  type ShipsConfig,
} from '../index';

import Spaceship = ei.MissionInfo.Spaceship;
import DurationType = ei.MissionInfo.DurationType;

export interface PlayerData {
  // Ship levels and visibility as the save has them. `targets` and `showNodata` are not in a save and
  // are left at `newShipsConfig`'s defaults for the caller to fill in.
  shipsConfig: ShipsConfig;
  inventory: Inventory;
  totalCraftingXp: number;
  tankLevel: number | null;
  // What is stocked in the virtue tank right now, per egg. Null when the save carries no readable
  // tank, which is what makes a per-egg budget unavailable rather than silently four zeroes.
  tankFuels: Map<ei.Egg, number> | null;
  // Golden eggs the player can actually spend: lifetime earned less lifetime spent.
  goldenEggs: number;
}

function computeShipLevelFromPoints(shipType: Spaceship, points: number): number {
  const thresholds = shipLevelLaunchPointThresholds(shipType);
  let level = 0;
  for (; level < thresholds.length; level++) {
    if (points < thresholds[level]) return Math.max(0, level - 1);
  }
  return thresholds.length - 1;
}

// `virtue.afx.tankFuels` is positional, and the virtue eggs sit at indices 20-24 as
// [Curiosity, Integrity, Humility, Resilience, Kindness]. Humility is absent here because
// `makeLaunchOption` in problem-inputs.ts strips it from every mission's cost, so a budget for
// it would constrain nothing.
const VIRTUE_TANK_FUEL_INDICES: ReadonlyArray<readonly [ei.Egg, number]> = [
  [ei.Egg.CURIOSITY, 20],
  [ei.Egg.INTEGRITY, 21],
  [ei.Egg.RESILIENCE, 23],
  [ei.Egg.KINDNESS, 24],
];

function readVirtueTankFuels(backup: ei.IBackup): Map<ei.Egg, number> | null {
  const tankFuels = backup.virtue?.afx?.tankFuels;
  // Too short to hold the virtue eggs at all: an old or partial save, which should fall
  // back to the tank-capacity budget rather than read as an empty tank.
  if (!tankFuels || tankFuels.length <= 24) return null;
  const fuels = new Map<ei.Egg, number>();
  for (const [egg, index] of VIRTUE_TANK_FUEL_INDICES) {
    const amount = tankFuels[index];
    fuels.set(egg, Number.isFinite(amount) && amount > 0 ? amount : 0);
  }
  return fuels;
}

// Null when the backup has no game or artifacts database to read.
export function readPlayerData(backup: ei.IBackup): PlayerData | null {
  if (!backup.game || !backup.artifactsDb) return null;

  const shipsConfig = newShipsConfig(backup.game);

  const launchPoints: Partial<Record<Spaceship, number>> = {};
  const hasLaunched: Partial<Record<Spaceship, boolean>> = {};

  const missions = (backup.artifactsDb.missionArchive ?? [])
    .concat(backup.artifactsDb.missionInfos ?? [])
    .filter(m => (m.status ?? 0) >= ei.MissionInfo.Status.EXPLORING);

  for (const mission of missions) {
    const ship = mission.ship!;
    let pts = 1.0;
    if (mission.durationType === DurationType.LONG) pts = 1.4;
    else if (mission.durationType === DurationType.EPIC) pts = 1.8;
    launchPoints[ship] = (launchPoints[ship] ?? 0) + pts;
    hasLaunched[ship] = true;
  }

  for (const shipType of spaceshipList) {
    shipsConfig.shipLevels[shipType] = computeShipLevelFromPoints(shipType, launchPoints[shipType] ?? 0);
    shipsConfig.shipVisibility[shipType] = shipType === Spaceship.CHICKEN_ONE ? true : (hasLaunched[shipType] ?? false);
  }

  const inventory = new Inventory(backup.artifactsDb, { virtue: true });
  for (const item of backup.artifactsDb.virtueAfxDb?.artifactStatus || []) {
    inventory.getItem(item.spec!).crafted += item.count!;
  }

  return {
    shipsConfig,
    inventory,
    totalCraftingXp: Math.floor(backup.artifacts?.craftingXp ?? 0),
    tankLevel: backup.artifacts?.tankLevel ?? null,
    tankFuels: readVirtueTankFuels(backup),
    goldenEggs: Math.max(0, (backup.game.goldenEggsEarned ?? 0) - (backup.game.goldenEggsSpent ?? 0)),
  };
}
