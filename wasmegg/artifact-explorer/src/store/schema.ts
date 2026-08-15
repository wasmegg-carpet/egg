// Persisted config shapes, defaults, and the type guards that validate localStorage values.
// Free of side effects at import time, so it can be unit tested under node.

import { virtueShipGemCosts, ei } from 'lib';

type Spaceship = ei.MissionInfo.Spaceship;

// Per-field flags: true means use the manual config value instead of the
// value from player data.
export interface OverrideFlags {
  craftingLevel: boolean;
  previousCrafts: boolean;
  epicResearchFTLLevel: boolean;
  epicResearchZerogLevel: boolean;
  shipLevels: Partial<Record<Spaceship, boolean>>;
  shipVisibility: Partial<Record<Spaceship, boolean>>;
  tankLevel: boolean;
}

export function newOverrides(): OverrideFlags {
  return {
    craftingLevel: false,
    previousCrafts: false,
    epicResearchFTLLevel: false,
    epicResearchZerogLevel: false,
    shipLevels: {},
    shipVisibility: {},
    tankLevel: false,
  };
}

export function isOverrideFlags(x: unknown): x is OverrideFlags {
  if (!x || typeof x !== 'object') return false;
  const o = x as OverrideFlags;
  return (
    typeof o.previousCrafts === 'boolean' &&
    typeof o.craftingLevel === 'boolean' &&
    typeof o.epicResearchFTLLevel === 'boolean' &&
    typeof o.epicResearchZerogLevel === 'boolean' &&
    typeof o.shipLevels === 'object' &&
    o.shipLevels !== null &&
    typeof o.shipVisibility === 'object' &&
    o.shipVisibility !== null &&
    (o.tankLevel === undefined || typeof o.tankLevel === 'boolean')
  );
}

// Manual values that aren't part of ShipsConfig, persisted alongside config
// and overrides.
export interface ExtrasConfig {
  craftingLevel: number;
  previousCrafts: number;
  tankLevel: number;
}

export function newExtras(maxTankLevel: number): ExtrasConfig {
  return { craftingLevel: 30, previousCrafts: 0, tankLevel: maxTankLevel };
}

export function isExtrasConfig(x: unknown): x is ExtrasConfig {
  if (!x || typeof x !== 'object') return false;
  const e = x as ExtrasConfig;
  return (
    typeof e.craftingLevel === 'number' &&
    typeof e.previousCrafts === 'number' &&
    (e.tankLevel === undefined || typeof e.tankLevel === 'number')
  );
}

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

// Launch period per effort level: a floor on each mission's effective
// duration, so a slot runs at most one launch per period.
export const EFFORT_LAUNCH_PERIOD_SECONDS: Record<EffortLevel, number> = {
  low: 86400, // 1 launch / slot / day
  medium: 43200, // 2 launches / slot / day
  high: 3600, // 1 launch / slot / hour
  max: 0, // as often as the optimizer wants (raw durations)
};

export function isEffortLevel(x: unknown): x is EffortLevel {
  return (EFFORT_LEVELS as readonly unknown[]).includes(x);
}

export const DEFAULT_WAIT_TIME_DAYS = '30';

export interface MissionFilters {
  effort: EffortLevel;
  // Maximum gem cost of a mission's ship on the Egg of Humility.
  maxGemCostEnabled: boolean;
  maxGemCost: number;
  // Time budget, stored as typed (e.g. '30', '12d12h') and parsed at use.
  waitTimeDays: string;
}

export function newMissionFilters(): MissionFilters {
  return {
    effort: 'medium',
    maxGemCostEnabled: false,
    maxGemCost: virtueShipGemCosts[ei.MissionInfo.Spaceship.ATREGGIES],
    waitTimeDays: DEFAULT_WAIT_TIME_DAYS,
  };
}

export function isMissionFilters(x: unknown): x is MissionFilters {
  if (!x || typeof x !== 'object') return false;
  const m = x as MissionFilters;
  return (
    (m.effort === undefined || isEffortLevel(m.effort)) &&
    (m.maxGemCostEnabled === undefined || typeof m.maxGemCostEnabled === 'boolean') &&
    (m.maxGemCost === undefined || typeof m.maxGemCost === 'number') &&
    (m.waitTimeDays === undefined || typeof m.waitTimeDays === 'string')
  );
}
