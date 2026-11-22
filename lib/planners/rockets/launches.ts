/** Shared launch costs and scheduling for the mission grid and imported plans. */

import { createEmptyFuelAmounts, type FuelEgg } from '@planner/types';
import {
  type Spaceship,
  type DurationType,
  SHIP_INFO,
  FUEL_REQUIREMENTS,
  getEffectiveDuration,
} from '@planner/lib/missions';
import type { MissionEntry } from './scheduler';

/** `count` copies of one ship at one duration. */
export interface Launch {
  ship: Spaceship;
  duration: DurationType;
  count: number;
}

/** All five figures, including Humility, which is free on the Path of Virtue but still deducted. */
export function fuelForLaunches(launches: readonly Launch[]): Record<FuelEgg, number> {
  const costs = createEmptyFuelAmounts();
  for (const { ship, duration, count } of launches) {
    for (const req of FUEL_REQUIREMENTS[ship][duration]) {
      costs[req.egg] += req.amount * count;
    }
  }
  return costs;
}

/** One entry per individual mission, at the durations `ftlLevel` gives them. */
export function launchEntries(launches: readonly Launch[], ftlLevel: number): MissionEntry[] {
  const entries: MissionEntry[] = [];
  for (const { ship, duration, count } of launches) {
    const durationSeconds = getEffectiveDuration(ship, duration, ftlLevel);
    for (let i = 0; i < count; i++) entries.push({ ship, duration, durationSeconds });
  }
  return entries;
}

/** Gems, at this app's ship prices. */
export function launchCost(launches: readonly Launch[]): number {
  return launches.reduce((cost, { ship, count }) => cost + SHIP_INFO[ship].price * count, 0);
}
