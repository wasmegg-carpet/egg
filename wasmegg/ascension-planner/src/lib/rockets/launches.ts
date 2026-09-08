/**
 * The arithmetic a set of launches implies — fuel, gems, scheduling entries — over the one shape
 * both producers of launches already have: the mission grid's queue and an imported Humility plan.
 *
 * It lives here rather than in either of them because both were computing it, identically, from
 * the same tables in `@/lib/missions`.
 */

import type { VirtueEgg } from '@/types';
import {
  type Spaceship,
  type DurationType,
  SHIP_INFO,
  VIRTUE_FUEL_REQUIREMENTS,
  getEffectiveDuration,
} from '@/lib/missions';
import type { MissionEntry } from '@/lib/rockets/scheduler';

/** `count` copies of one ship at one duration. */
export interface Launch {
  ship: Spaceship;
  duration: DurationType;
  count: number;
}

/** All five figures, including Humility — which is free on the Path of Virtue but still deducted. */
export function fuelForLaunches(launches: readonly Launch[]): Record<VirtueEgg, number> {
  const costs: Record<VirtueEgg, number> = {
    curiosity: 0,
    integrity: 0,
    humility: 0,
    resilience: 0,
    kindness: 0,
  };
  for (const { ship, duration, count } of launches) {
    for (const req of VIRTUE_FUEL_REQUIREMENTS[ship][duration]) {
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
