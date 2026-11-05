/**
 * Mission data for virtue rocket missions.
 * Self-contained module with all ship, fuel, duration, and pricing data.
 */

import type { VirtueEgg } from '@/types';

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
  price: number;
  isFTL: boolean;
}

export const SHIP_INFO: Record<Spaceship, ShipInfo> = {
  [Spaceship.CHICKEN_ONE]: {
    name: 'Chicken One',
    displayName: 'Chicken One',
    iconPath: 'egginc/afx_ship_chicken_1.png',
    price: 9.7e9,
    isFTL: false,
  },
  [Spaceship.CHICKEN_NINE]: {
    name: 'Chicken Nine',
    displayName: 'Chicken Nine',
    iconPath: 'egginc/afx_ship_chicken_9.png',
    price: 19e12,
    isFTL: false,
  },
  [Spaceship.CHICKEN_HEAVY]: {
    name: 'Chicken Heavy',
    displayName: 'Chicken Heavy',
    iconPath: 'egginc/afx_ship_chicken_heavy.png',
    price: 35e15,
    isFTL: false,
  },
  [Spaceship.BCR]: { name: 'BCR', displayName: 'BCR', iconPath: 'egginc/afx_ship_bcr.png', price: 60e18, isFTL: false },
  [Spaceship.MILLENIUM_CHICKEN]: {
    name: 'Quintillion',
    displayName: 'Quintillion',
    iconPath: 'egginc/afx_ship_millenium_chicken.png',
    price: 2.4e21,
    isFTL: true,
  },
  [Spaceship.CORELLIHEN_CORVETTE]: {
    name: 'Corvette',
    displayName: 'Corvette',
    iconPath: 'egginc/afx_ship_corellihen_corvette.png',
    price: 600e21,
    isFTL: true,
  },
  [Spaceship.GALEGGTICA]: {
    name: 'Galeggtica',
    displayName: 'Galeggtica',
    iconPath: 'egginc/afx_ship_galeggtica.png',
    price: 129e24,
    isFTL: true,
  },
  [Spaceship.CHICKFIANT]: {
    name: 'Defihent',
    displayName: 'Defihent',
    iconPath: 'egginc/afx_ship_defihent.png',
    price: 29e27,
    isFTL: true,
  },
  [Spaceship.VOYEGGER]: {
    name: 'Voyegger',
    displayName: 'Voyegger',
    iconPath: 'egginc/afx_ship_voyegger.png',
    price: 39e30,
    isFTL: true,
  },
  [Spaceship.HENERPRISE]: {
    name: 'Henerprise',
    displayName: 'Henerprise',
    iconPath: 'egginc/afx_ship_henerprise.png',
    price: 310e33,
    isFTL: true,
  },
  [Spaceship.ATREGGIES]: {
    name: 'Henliner',
    displayName: 'Henliner',
    iconPath: 'egginc/afx_ship_atreggies.png',
    price: 419e36,
    isFTL: true,
  },
};

/** All ships ordered most expensive first (for grid display). */
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
  egg: VirtueEgg;
  amount: number;
}

type FuelMap = Record<Spaceship, Record<DurationType, FuelRequirement[]>>;

export const VIRTUE_FUEL_REQUIREMENTS: FuelMap = {
  [Spaceship.CHICKEN_ONE]: {
    [DurationType.SHORT]: [{ egg: 'humility', amount: 5e6 }],
    [DurationType.LONG]: [{ egg: 'humility', amount: 10e6 }],
    [DurationType.EPIC]: [{ egg: 'humility', amount: 20e6 }],
  },
  [Spaceship.CHICKEN_NINE]: {
    [DurationType.SHORT]: [{ egg: 'humility', amount: 10e6 }],
    [DurationType.LONG]: [{ egg: 'humility', amount: 20e6 }],
    [DurationType.EPIC]: [{ egg: 'humility', amount: 50e6 }],
  },
  [Spaceship.CHICKEN_HEAVY]: {
    [DurationType.SHORT]: [{ egg: 'humility', amount: 50e6 }],
    [DurationType.LONG]: [{ egg: 'humility', amount: 100e6 }],
    [DurationType.EPIC]: [{ egg: 'humility', amount: 150e6 }],
  },
  [Spaceship.BCR]: {
    [DurationType.SHORT]: [
      { egg: 'humility', amount: 100e6 },
      { egg: 'integrity', amount: 10e6 },
    ],
    [DurationType.LONG]: [
      { egg: 'humility', amount: 150e6 },
      { egg: 'integrity', amount: 20e6 },
    ],
    [DurationType.EPIC]: [
      { egg: 'humility', amount: 200e6 },
      { egg: 'integrity', amount: 30e6 },
    ],
  },
  [Spaceship.MILLENIUM_CHICKEN]: {
    [DurationType.SHORT]: [
      { egg: 'humility', amount: 10e9 },
      { egg: 'integrity', amount: 10e9 },
    ],
    [DurationType.LONG]: [
      { egg: 'humility', amount: 20e9 },
      { egg: 'integrity', amount: 20e9 },
    ],
    [DurationType.EPIC]: [
      { egg: 'humility', amount: 50e9 },
      { egg: 'integrity', amount: 50e9 },
    ],
  },
  [Spaceship.CORELLIHEN_CORVETTE]: {
    [DurationType.SHORT]: [
      { egg: 'humility', amount: 20e9 },
      { egg: 'integrity', amount: 5e9 },
    ],
    [DurationType.LONG]: [
      { egg: 'humility', amount: 40e9 },
      { egg: 'integrity', amount: 8e9 },
    ],
    [DurationType.EPIC]: [
      { egg: 'humility', amount: 70e9 },
      { egg: 'integrity', amount: 10e9 },
    ],
  },
  [Spaceship.GALEGGTICA]: {
    [DurationType.SHORT]: [
      { egg: 'humility', amount: 200e9 },
      { egg: 'integrity', amount: 200e9 },
      { egg: 'curiosity', amount: 200e9 },
    ],
    [DurationType.LONG]: [
      { egg: 'humility', amount: 400e9 },
      { egg: 'integrity', amount: 400e9 },
      { egg: 'curiosity', amount: 400e9 },
    ],
    [DurationType.EPIC]: [
      { egg: 'humility', amount: 600e9 },
      { egg: 'integrity', amount: 600e9 },
      { egg: 'curiosity', amount: 600e9 },
    ],
  },
  [Spaceship.CHICKFIANT]: {
    [DurationType.SHORT]: [
      { egg: 'humility', amount: 1e12 },
      { egg: 'curiosity', amount: 1e12 },
      { egg: 'kindness', amount: 1e12 },
    ],
    [DurationType.LONG]: [
      { egg: 'humility', amount: 2e12 },
      { egg: 'curiosity', amount: 2e12 },
      { egg: 'kindness', amount: 2e12 },
    ],
    [DurationType.EPIC]: [
      { egg: 'humility', amount: 3e12 },
      { egg: 'curiosity', amount: 3e12 },
      { egg: 'kindness', amount: 3e12 },
    ],
  },
  [Spaceship.VOYEGGER]: {
    [DurationType.SHORT]: [
      { egg: 'humility', amount: 5e12 },
      { egg: 'curiosity', amount: 10e12 },
      { egg: 'kindness', amount: 5e12 },
    ],
    [DurationType.LONG]: [
      { egg: 'humility', amount: 10e12 },
      { egg: 'curiosity', amount: 20e12 },
      { egg: 'kindness', amount: 10e12 },
    ],
    [DurationType.EPIC]: [
      { egg: 'humility', amount: 15e12 },
      { egg: 'curiosity', amount: 25e12 },
      { egg: 'kindness', amount: 15e12 },
    ],
  },
  [Spaceship.HENERPRISE]: {
    [DurationType.SHORT]: [
      { egg: 'humility', amount: 10e12 },
      { egg: 'curiosity', amount: 15e12 },
      { egg: 'kindness', amount: 10e12 },
    ],
    [DurationType.LONG]: [
      { egg: 'humility', amount: 15e12 },
      { egg: 'curiosity', amount: 20e12 },
      { egg: 'kindness', amount: 15e12 },
      { egg: 'resilience', amount: 10e12 },
    ],
    [DurationType.EPIC]: [
      { egg: 'humility', amount: 25e12 },
      { egg: 'curiosity', amount: 25e12 },
      { egg: 'kindness', amount: 25e12 },
      { egg: 'resilience', amount: 20e12 },
    ],
  },
  [Spaceship.ATREGGIES]: {
    [DurationType.SHORT]: [
      { egg: 'humility', amount: 20e12 },
      { egg: 'curiosity', amount: 25e12 },
      { egg: 'kindness', amount: 20e12 },
    ],
    [DurationType.LONG]: [
      { egg: 'humility', amount: 30e12 },
      { egg: 'curiosity', amount: 40e12 },
      { egg: 'kindness', amount: 30e12 },
      { egg: 'resilience', amount: 20e12 },
    ],
    [DurationType.EPIC]: [
      { egg: 'humility', amount: 75e12 },
      { egg: 'curiosity', amount: 50e12 },
      { egg: 'kindness', amount: 75e12 },
      { egg: 'resilience', amount: 40e12 },
    ],
  },
};

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
 * Get fuel requirements for a mission, as a Record<VirtueEgg, number>.
 * Only includes eggs that are required (amount > 0).
 */
export function getFuelCosts(ship: Spaceship, duration: DurationType): Partial<Record<VirtueEgg, number>> {
  const costs: Partial<Record<VirtueEgg, number>> = {};
  for (const req of VIRTUE_FUEL_REQUIREMENTS[ship][duration]) {
    costs[req.egg] = req.amount;
  }
  return costs;
}

/**
 * Get the egg icon path for a virtue egg.
 */
export function virtueEggIconPath(egg: VirtueEgg): string {
  return `egginc/egg_${egg}.png`;
}
