/**
 * Mission data for rocket missions launched from a non-virtue farm.
 * Launches there cost fuel only: the per-launch price some ships have is an Egg of Humility rule.
 */

import { ei, eggIconPath, MissionType } from 'lib';
import { eiEggToFuelEgg, fuelEggToEiEgg, type FuelEgg } from '@/types/actions/eggs';

// ============================================================================
// Enums
// ============================================================================

export enum Spaceship {
  CHICKEN_ONE = 0,
  CHICKEN_NINE = 1,
  CHICKEN_HEAVY = 2,
  BCR = 3,
  MILLENIUM_CHICKEN = 4,
  CORELLIHEN_CORVETTE = 5,
  GALEGGTICA = 6,
  CHICKFIANT = 7,
  VOYEGGER = 8,
  HENERPRISE = 9,
  ATREGGIES = 10,
}

export enum DurationType {
  SHORT = 1,
  LONG = 2,
  EPIC = 3,
}

// ============================================================================
// Ship metadata
// ============================================================================

export interface ShipInfo {
  name: string;
  displayName: string;
  iconPath: string;
  isFTL: boolean;
}

export const SHIP_INFO: Record<Spaceship, ShipInfo> = {
  [Spaceship.CHICKEN_ONE]: {
    name: 'Chicken One',
    displayName: 'Chicken One',
    iconPath: 'egginc/afx_ship_chicken_1.png',
    isFTL: false,
  },
  [Spaceship.CHICKEN_NINE]: {
    name: 'Chicken Nine',
    displayName: 'Chicken Nine',
    iconPath: 'egginc/afx_ship_chicken_9.png',
    isFTL: false,
  },
  [Spaceship.CHICKEN_HEAVY]: {
    name: 'Chicken Heavy',
    displayName: 'Chicken Heavy',
    iconPath: 'egginc/afx_ship_chicken_heavy.png',
    isFTL: false,
  },
  [Spaceship.BCR]: { name: 'BCR', displayName: 'BCR', iconPath: 'egginc/afx_ship_bcr.png', isFTL: false },
  [Spaceship.MILLENIUM_CHICKEN]: {
    name: 'Quintillion',
    displayName: 'Quintillion',
    iconPath: 'egginc/afx_ship_millenium_chicken.png',
    isFTL: true,
  },
  [Spaceship.CORELLIHEN_CORVETTE]: {
    name: 'Corvette',
    displayName: 'Corvette',
    iconPath: 'egginc/afx_ship_corellihen_corvette.png',
    isFTL: true,
  },
  [Spaceship.GALEGGTICA]: {
    name: 'Galeggtica',
    displayName: 'Galeggtica',
    iconPath: 'egginc/afx_ship_galeggtica.png',
    isFTL: true,
  },
  [Spaceship.CHICKFIANT]: {
    name: 'Defihent',
    displayName: 'Defihent',
    iconPath: 'egginc/afx_ship_defihent.png',
    isFTL: true,
  },
  [Spaceship.VOYEGGER]: {
    name: 'Voyegger',
    displayName: 'Voyegger',
    iconPath: 'egginc/afx_ship_voyegger.png',
    isFTL: true,
  },
  [Spaceship.HENERPRISE]: {
    name: 'Henerprise',
    displayName: 'Henerprise',
    iconPath: 'egginc/afx_ship_henerprise.png',
    isFTL: true,
  },
  [Spaceship.ATREGGIES]: {
    name: 'Henliner',
    displayName: 'Henliner',
    iconPath: 'egginc/afx_ship_atreggies.png',
    isFTL: true,
  },
};

/** All ships, newest first (for grid display). */
export const ALL_SHIPS: Spaceship[] = [
  Spaceship.ATREGGIES,
  Spaceship.HENERPRISE,
  Spaceship.VOYEGGER,
  Spaceship.CHICKFIANT,
  Spaceship.GALEGGTICA,
  Spaceship.CORELLIHEN_CORVETTE,
  Spaceship.MILLENIUM_CHICKEN,
  Spaceship.BCR,
  Spaceship.CHICKEN_HEAVY,
  Spaceship.CHICKEN_NINE,
  Spaceship.CHICKEN_ONE,
];

export const ALL_DURATIONS: DurationType[] = [DurationType.SHORT, DurationType.LONG, DurationType.EPIC];

export const DURATION_NAMES: Record<DurationType, string> = {
  [DurationType.SHORT]: 'Short',
  [DurationType.LONG]: 'Standard',
  [DurationType.EPIC]: 'Extended',
};

// ============================================================================
// Fuel requirements
// ============================================================================

export interface FuelRequirement {
  egg: FuelEgg;
  amount: number;
}

type FuelMap = Record<Spaceship, Record<DurationType, FuelRequirement[]>>;

const LIB_DURATION: Record<DurationType, ei.MissionInfo.DurationType> = {
  [DurationType.SHORT]: ei.MissionInfo.DurationType.SHORT,
  [DurationType.LONG]: ei.MissionInfo.DurationType.LONG,
  [DurationType.EPIC]: ei.MissionInfo.DurationType.EPIC,
};

function fuelRequirements(ship: Spaceship, duration: DurationType): FuelRequirement[] {
  return new MissionType(ship as unknown as ei.MissionInfo.Spaceship, LIB_DURATION[duration]).defaultFuels.flatMap(fuel => {
    const egg = eiEggToFuelEgg(fuel.egg);
    return egg ? [{ egg, amount: fuel.amount }] : [];
  });
}

/** What each mission burns on a non-virtue farm (lib/missions.ts, the table the rockets tracker uses). */
export const FUEL_REQUIREMENTS: FuelMap = Object.fromEntries(
  ALL_SHIPS.map(ship => [
    ship,
    Object.fromEntries(ALL_DURATIONS.map(duration => [duration, fuelRequirements(ship, duration)])),
  ])
) as FuelMap;

// ============================================================================
// Base durations (seconds)
// ============================================================================

type DurationMap = Record<Spaceship, Record<DurationType, number>>;

export const BASE_DURATIONS: DurationMap = {
  [Spaceship.CHICKEN_ONE]: { [DurationType.SHORT]: 1200, [DurationType.LONG]: 3600, [DurationType.EPIC]: 7200 },
  [Spaceship.CHICKEN_NINE]: { [DurationType.SHORT]: 1800, [DurationType.LONG]: 3600, [DurationType.EPIC]: 10800 },
  [Spaceship.CHICKEN_HEAVY]: { [DurationType.SHORT]: 2700, [DurationType.LONG]: 5400, [DurationType.EPIC]: 14400 },
  [Spaceship.BCR]: { [DurationType.SHORT]: 5400, [DurationType.LONG]: 14400, [DurationType.EPIC]: 28800 },
  [Spaceship.MILLENIUM_CHICKEN]: {
    [DurationType.SHORT]: 10800,
    [DurationType.LONG]: 21600,
    [DurationType.EPIC]: 43200,
  },
  [Spaceship.CORELLIHEN_CORVETTE]: {
    [DurationType.SHORT]: 14400,
    [DurationType.LONG]: 43200,
    [DurationType.EPIC]: 86400,
  },
  [Spaceship.GALEGGTICA]: { [DurationType.SHORT]: 21600, [DurationType.LONG]: 57600, [DurationType.EPIC]: 108000 },
  [Spaceship.CHICKFIANT]: { [DurationType.SHORT]: 28800, [DurationType.LONG]: 86400, [DurationType.EPIC]: 172800 },
  [Spaceship.VOYEGGER]: { [DurationType.SHORT]: 43200, [DurationType.LONG]: 129600, [DurationType.EPIC]: 259200 },
  [Spaceship.HENERPRISE]: { [DurationType.SHORT]: 86400, [DurationType.LONG]: 172800, [DurationType.EPIC]: 345600 },
  [Spaceship.ATREGGIES]: { [DurationType.SHORT]: 172800, [DurationType.LONG]: 259200, [DurationType.EPIC]: 345600 },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the effective mission duration after FTL research reduction.
 * FTL research reduces duration by 1% per level (max 60), only for FTL ships.
 */
export function getEffectiveDuration(ship: Spaceship, duration: DurationType, ftlLevel: number): number {
  const base = BASE_DURATIONS[ship][duration];
  if (!SHIP_INFO[ship].isFTL) return base;
  return base * (1 - 0.01 * Math.min(60, ftlLevel));
}

/**
 * Get fuel requirements for a mission, as a Record<FuelEgg, number>.
 * Only includes eggs that are required (amount > 0).
 */
export function getFuelCosts(ship: Spaceship, duration: DurationType): Partial<Record<FuelEgg, number>> {
  const costs: Partial<Record<FuelEgg, number>> = {};
  for (const req of FUEL_REQUIREMENTS[ship][duration]) {
    costs[req.egg] = req.amount;
  }
  return costs;
}

/**
 * Get the egg icon path for a fuel egg.
 */
export function fuelEggIconPath(egg: FuelEgg): string {
  return eggIconPath(fuelEggToEiEgg(egg));
}
