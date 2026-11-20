// Instance generation for the arena. An instance is whatever a player could actually configure in the UI,
// sampled uniformly on purpose: hand-shaped instances only ever catch bugs someone already thought of.

import { ei, fuelTankSizes, newShipsConfig, shipMaxLevel, spaceshipList, type ShipsConfig } from 'lib';
import { EFFORT_LEVELS, type EffortLevel } from 'lib/mission-optimizer/effort';
import { candidateTargets, mulberry32, pick, randInt } from '../oracle/generate';
import { DAY_SECONDS, assertSleepSeconds } from './sleep';

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
  // Seconds of 2x capacity window left from the plan's start; 0 is today's problem. See `ARENA_WINDOW` below and
  // ARENA.md.
  eventWindowSeconds: number;
  // Seconds since the player last woke up, at the plan's start; absent is 0, a plan starting at wake-up, today's
  // problem. Meaningful only with sleep. See `ARENA_WAKE` below and ARENA.md.
  wakeOffsetSeconds?: number;
  // Eggs a second the one fueling pad moves; absent is instant fueling, today's problem. See `ARENA_PAD` below and
  // ARENA.md, "The fueling pad".
  fuelingRate?: number;
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

const HOUR = 3600;

// `ARENA_WAKE`: unset, every instance starts at wake-up (today's arena, every recorded figure unchanged); a number of
// hours, that long since the player woke on every instance, composing with `ARENA_SLEEP` and `ARENA_WINDOW`. Not
// drawn, so no seed's other fields move. Read per call, like `ARENA_SLEEP`.
function wakeOverride(): number {
  const raw = process.env.ARENA_WAKE;
  if (raw === undefined || raw === '') return 0;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0 || hours * HOUR >= DAY_SECONDS) {
    throw new Error(`ARENA_WAKE must be a number of hours in [0, 24), got ${JSON.stringify(raw)}`);
  }
  return hours * HOUR;
}

// What the game's fueling pad moves a minute at each tank level, parallel to `fuelTankSizes`. Stated here, not
// imported, for the reason the arena keeps its own sleep model: a rate shared with the planner would agree with itself.
export const PAD_EGGS_PER_MINUTE = [3e8, 1.2e10, 1.8e11, 3e12, 4.5e12, 6e12, 7.5e12, 9e12];

// `ARENA_PAD`: unset, no instance has a pad (today's arena, every recorded figure unchanged); `tank`, the pad of each
// instance's own tank level, the level its fuel capacity is the size of; a tank level 0 to 7, that tank on every
// instance, its size as the fuel capacity and its output as the pad. Read per call, like `ARENA_SLEEP`. Nothing is
// drawn, so no seed's other fields move.
function padOverride(drawnTank: number): { fuelCapacity: number; fuelingRate?: number } {
  const raw = process.env.ARENA_PAD;
  if (raw === undefined || raw === '') return { fuelCapacity: drawnTank };
  const level = raw === 'tank' ? fuelTankSizes.indexOf(drawnTank) : Number(raw);
  if (!Number.isInteger(level) || level < 0 || level >= PAD_EGGS_PER_MINUTE.length) {
    throw new Error(`ARENA_PAD must be "tank" or a tank level 0 to 7, got ${JSON.stringify(raw)}`);
  }
  return { fuelCapacity: fuelTankSizes[level], fuelingRate: PAD_EGGS_PER_MINUTE[level] / 60 };
}

// Where a 2x capacity window can sit relative to the plan, named against the horizon, which is what decides
// whether the window constrains anything the horizon does not already.
export const EVENT_REGIMES = {
  // No event: no doubled variant, no window rows. Today's problem.
  none: () => 0,
  // A whole event on a horizon usually far longer than it.
  inside: () => 48 * HOUR,
  // Shorter than nearly every mission, so few or none fit the window row and doubled launches come through the
  // overhang.
  sliver: () => HOUR,
  // Just under the whole horizon, and just over it: under, the window still binds; over, it binds on nothing.
  'straddle-under': (inst: { timeCapacityPerSlot: number }) =>
    Math.max(HOUR, Math.floor(inst.timeCapacityPerSlot * 0.75)),
  'straddle-over': (inst: { timeCapacityPerSlot: number }) => Math.ceil(inst.timeCapacityPerSlot * 1.25),
} satisfies Record<string, (inst: { timeCapacityPerSlot: number }) => number>;

export type EventRegime = keyof typeof EVENT_REGIMES;

export const EVENT_REGIME_NAMES = Object.keys(EVENT_REGIMES) as EventRegime[];

export function isEventRegime(x: unknown): x is EventRegime {
  return typeof x === 'string' && (EVENT_REGIME_NAMES as readonly string[]).includes(x);
}

// `ARENA_WINDOW`: unset, every instance has no window (today's arena, every recorded figure unchanged); a regime
// name, that regime on every instance; `draw`, the regime each seed drew. Read per call, like `ARENA_SLEEP`.
function windowOverride(drawn: EventRegime, horizon: number): number {
  const raw = process.env.ARENA_WINDOW;
  if (raw === undefined || raw === '') return 0;
  const regime = raw === 'draw' ? drawn : raw;
  if (!isEventRegime(regime)) {
    throw new Error(
      `ARENA_WINDOW must be "draw" or one of ${EVENT_REGIME_NAMES.join(', ')}, got ${JSON.stringify(raw)}`
    );
  }
  return EVENT_REGIMES[regime]({ timeCapacityPerSlot: horizon });
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
  // After sleep, for the same reason: every field above, sleep included, keeps its value for every seed.
  const drawnRegime = pick(rng, EVENT_REGIME_NAMES);

  const wakeOffsetSeconds = wakeOverride();
  const pad = padOverride(fuelCapacity);
  return {
    label: `arena:${seed}`,
    seed,
    targets,
    config,
    craftingLevel,
    previousCrafts,
    fuelCapacity: pad.fuelCapacity,
    timeCapacityPerSlot,
    effort,
    sleepSeconds: sleepOverride(drawnSleep),
    eventWindowSeconds: windowOverride(drawnRegime, timeCapacityPerSlot),
    ...(wakeOffsetSeconds > 0 && { wakeOffsetSeconds }),
    ...(pad.fuelingRate !== undefined && { fuelingRate: pad.fuelingRate }),
  };
}

export function describeInstance(inst: ArenaInstance): string {
  return (
    `${inst.label}: ${inst.targets.length} target(s) [${inst.targets.join(', ')}], ` +
    `effort=${inst.effort}, ${(inst.timeCapacityPerSlot / 86400).toFixed(0)}d, ` +
    `fuel=${inst.fuelCapacity.toExponential(1)}, craft=${inst.craftingLevel}, prev=${inst.previousCrafts}` +
    (inst.sleepSeconds > 0 ? `, sleep=${+(inst.sleepSeconds / 3600).toFixed(2)}h` : '') +
    ((inst.wakeOffsetSeconds ?? 0) > 0 ? `, awake ${+(inst.wakeOffsetSeconds! / HOUR).toFixed(2)}h` : '') +
    (inst.eventWindowSeconds > 0 ? `, 2x for ${+(inst.eventWindowSeconds / HOUR).toFixed(2)}h` : '') +
    (inst.fuelingRate !== undefined ? `, pad ${inst.fuelingRate.toExponential(2)} eggs/s` : '')
  );
}
