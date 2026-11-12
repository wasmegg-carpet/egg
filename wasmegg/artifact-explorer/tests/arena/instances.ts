// Instance generation for the arena. An instance is whatever a player could actually configure in the UI,
// sampled uniformly on purpose: hand-shaped instances only ever catch bugs someone already thought of.

import { ei, fuelTankSizes, newShipsConfig, shipMaxLevel, spaceshipList, type ShipsConfig } from 'lib';
import { EFFORT_LEVELS, type EffortLevel } from '@/store/schema';
import { candidateTargets, mulberry32, pick, randInt } from '../oracle/generate';
import { assertSleepSeconds } from './sleep';

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
  // Seconds of sleep a day; 0 is today's problem. See `ARENA_SLEEP` below and ARENA.md.
  sleepSeconds: number;
}

// The windows `generateInstance` draws from, in hours. 0 is in the draw so `draw` mixes sleep-free instances in.
const SLEEP_HOURS = [0, 4, 6, 8, 10, 12];

// `ARENA_SLEEP`: unset, every instance sleeps 0 (today's arena, every recorded figure unchanged); a number of
// hours, that window on every instance; `draw`, the window each seed drew. Read per call, not at import, so
// a spec can set it.
function sleepOverride(drawn: number): number {
  const raw = process.env.ARENA_SLEEP;
  if (raw === undefined || raw === '') return 0;
  if (raw === 'draw') return drawn;
  const hours = Number(raw);
  const seconds = hours * 3600;
  if (!Number.isFinite(hours) || hours < 0 || hours >= 24) {
    throw new Error(`ARENA_SLEEP must be "draw" or a number of hours in [0, 24), got ${JSON.stringify(raw)}`);
  }
  assertSleepSeconds(seconds);
  return seconds;
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

  // Drawn in this order, one statement each, because the order is the seed's meaning.
  const craftingLevel = randInt(rng, 1, 30);
  const previousCrafts = pick(rng, [0, 10, 50, 100, 300]);
  const fuelCapacity = fuelTankSizes[randInt(rng, 2, fuelTankSizes.length - 1)];
  const timeCapacityPerSlot = randInt(rng, 1, 30) * 86400;
  const effort = pick(rng, [...EFFORT_LEVELS]);
  // Drawn last, so every field above keeps the value it had for every seed before sleep existed.
  const drawnSleep = pick(rng, SLEEP_HOURS) * 3600;

  return {
    label: `arena:${seed}`,
    seed,
    targets,
    config,
    craftingLevel,
    previousCrafts,
    fuelCapacity,
    timeCapacityPerSlot,
    effort,
    sleepSeconds: sleepOverride(drawnSleep),
  };
}

export function describeInstance(inst: ArenaInstance): string {
  return (
    `${inst.label}: ${inst.targets.length} target(s) [${inst.targets.join(', ')}], ` +
    `effort=${inst.effort}, ${(inst.timeCapacityPerSlot / 86400).toFixed(0)}d, ` +
    `fuel=${inst.fuelCapacity.toExponential(1)}, craft=${inst.craftingLevel}, prev=${inst.previousCrafts}` +
    (inst.sleepSeconds > 0 ? `, sleep=${+(inst.sleepSeconds / 3600).toFixed(2)}h` : '')
  );
}
