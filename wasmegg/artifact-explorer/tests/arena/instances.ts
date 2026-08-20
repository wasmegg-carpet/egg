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
  // Seconds of 2x mission capacity remaining. Zero on every generated instance; `withEventWindow`
  // layers the event regimes on top.
  eventWindowSeconds: number;
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
    eventWindowSeconds: 0,
  };
}

const HOUR = 3600;

// The regimes a 2x capacity window can be in relative to the plan. `none` is the null arm and must
// reproduce the pre-window sweep exactly; the rest are named against the horizon, which is what decides
// whether the window constrains anything the horizon does not already.
export const EVENT_REGIMES = {
  // No event: one capacity variant, no window rows.
  none: () => 0,
  // The real event, on a horizon far longer than it.
  inside: () => 48 * HOUR,
  // Shorter than the shortest mission anyone can fly, so nothing fits the window row and every doubled
  // launch has to come through the overhang column.
  sliver: () => HOUR,
  // Just under the whole horizon, and just over it: below, the window still binds; above, it binds on
  // nothing and every launch could in principle be doubled.
  'straddle-under': (inst: ArenaInstance) => Math.max(HOUR, Math.floor(inst.timeCapacityPerSlot * 0.75)),
  'straddle-over': (inst: ArenaInstance) => Math.ceil(inst.timeCapacityPerSlot * 1.25),
} satisfies Record<string, (inst: ArenaInstance) => number>;

export type EventRegime = keyof typeof EVENT_REGIMES;

export const EVENT_REGIME_NAMES = Object.keys(EVENT_REGIMES) as EventRegime[];

export function isEventRegime(x: unknown): x is EventRegime {
  return typeof x === 'string' && (EVENT_REGIME_NAMES as readonly string[]).includes(x);
}

// A copy of `inst` under one regime.
export function withEventWindow(inst: ArenaInstance, regime: EventRegime): ArenaInstance {
  const seconds = EVENT_REGIMES[regime](inst);
  if (seconds <= 0) return inst;
  return { ...inst, label: `${inst.label}/${regime}`, eventWindowSeconds: seconds };
}

export function describeInstance(inst: ArenaInstance): string {
  const window = inst.eventWindowSeconds > 0 ? `, 2x for ${(inst.eventWindowSeconds / HOUR).toFixed(1)}h` : '';
  return (
    `${inst.label}: ${inst.targets.length} target(s) [${inst.targets.join(', ')}], ` +
    `effort=${inst.effort}, ${(inst.timeCapacityPerSlot / 86400).toFixed(0)}d, ` +
    `fuel=${inst.fuelCapacity.toExponential(1)}, craft=${inst.craftingLevel}, prev=${inst.previousCrafts}${window}`
  );
}
