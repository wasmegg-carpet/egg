// Instance generation for the arena. An instance is whatever a player could actually configure in the UI,
// sampled uniformly on purpose: hand-shaped instances only ever catch bugs someone already thought of.

import { ei, fuelTankSizes, newShipsConfig, shipMaxLevel, spaceshipList, type ShipsConfig } from 'lib';
import { EFFORT_LEVELS, type EffortLevel } from '@/store/schema';
import { candidateTargets, mulberry32, pick, randInt } from '../oracle/generate';

export interface ArenaInstance {
  label: string;
  seed: number;
  targets: string[];
  config: ShipsConfig;
  craftingLevel: number;
  previousCrafts: number;
  fuelCapacity: number;
  timeCapacityPerSlot: number;
  effort: EffortLevel;
}

export function generateInstance(seed: number): ArenaInstance {
  const rng = mulberry32(seed * 7919 + 13);

  const pool = candidateTargets();
  const targetCount = randInt(rng, 1, 4);
  const targets: string[] = [];
  while (targets.length < targetCount) {
    const t = pick(rng, pool);
    if (!targets.includes(t)) targets.push(t);
  }

  const config = newShipsConfig();
  config.epicResearchFTLLevel = randInt(rng, 0, 60);
  config.epicResearchZerogLevel = randInt(rng, 0, 10);
  config.showNodata = false;
  // At least one FTL ship stays visible, or there is nothing to target with.
  let anyFtl = false;
  for (const s of spaceshipList) {
    config.shipLevels[s] = randInt(rng, 0, shipMaxLevel(s));
    config.shipVisibility[s] = rng() < 0.75;
    if (config.shipVisibility[s] && s >= ei.MissionInfo.Spaceship.MILLENIUM_CHICKEN) anyFtl = true;
  }
  if (!anyFtl) {
    config.shipVisibility[ei.MissionInfo.Spaceship.HENERPRISE] = true;
    config.shipLevels[ei.MissionInfo.Spaceship.HENERPRISE] = shipMaxLevel(ei.MissionInfo.Spaceship.HENERPRISE);
  }

  return {
    label: `arena:${seed}`,
    seed,
    targets,
    config,
    craftingLevel: randInt(rng, 1, 30),
    previousCrafts: pick(rng, [0, 10, 50, 100, 300]),
    fuelCapacity: fuelTankSizes[randInt(rng, 2, fuelTankSizes.length - 1)],
    timeCapacityPerSlot: randInt(rng, 1, 30) * 86400,
    effort: pick(rng, [...EFFORT_LEVELS]),
  };
}

export function describeInstance(inst: ArenaInstance): string {
  return (
    `${inst.label}: ${inst.targets.length} target(s) [${inst.targets.join(', ')}], ` +
    `effort=${inst.effort}, ${(inst.timeCapacityPerSlot / 86400).toFixed(0)}d, ` +
    `fuel=${inst.fuelCapacity.toExponential(1)}, craft=${inst.craftingLevel}, prev=${inst.previousCrafts}`
  );
}
