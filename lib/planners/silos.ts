/**
 * Silo constants and helpers shared by the planners.
 */

// Constants
export const MIN_SILOS = 1;

export const MAX_SILOS = 10;

export const MAX_SILOS_STANDARD_PERMIT = 2;

export const BASE_MINUTES_PER_SILO = 60;

export const MINUTES_PER_SILO_CAPACITY_LEVEL = 6;

export const MAX_SILO_CAPACITY_LEVEL = 20;

/**
 * Most silos a farm can hold. `proPermit` undefined means Pro (plans and snapshots from before
 * Standard was supported).
 */
export function maxSilos(proPermit?: boolean): number {
  return proPermit === false ? MAX_SILOS_STANDARD_PERMIT : MAX_SILOS;
}

export interface SilosState {
  // Current number of silos owned during this ascension plan
  siloCount: number;
}

// ============================================================================
// Calculation Functions
// ============================================================================

/**
 * Calculate cost of the next silo.
 * Formula: 100M * n^(3*n+15) where n = current silos owned
 * @param silosOwned Current number of silos owned
 * @param proPermit false for Standard permit, which caps silos at 2
 * @returns Cost of next silo in the planner's currency (cash)
 */
export function nextSiloCost(silosOwned: number, proPermit?: boolean): number {
  if (silosOwned <= 0) {
    return 0; // First silo is free
  }
  if (silosOwned >= maxSilos(proPermit)) {
    return Infinity; // Can't buy more
  }
  return 100_000_000 * Math.pow(silosOwned, 3 * silosOwned + 15);
}

/**
 * Calculate away time per silo in minutes.
 * @param siloCapacityLevel Epic research level of Silo Capacity
 * @returns Minutes of away time per silo
 */
export function awayTimePerSilo(siloCapacityLevel: number): number {
  const clampedLevel = Math.max(0, Math.min(MAX_SILO_CAPACITY_LEVEL, siloCapacityLevel));
  return BASE_MINUTES_PER_SILO + clampedLevel * MINUTES_PER_SILO_CAPACITY_LEVEL;
}

/**
 * Calculate total away time in minutes.
 * @param silosOwned Number of silos owned
 * @param siloCapacityLevel Epic research level of Silo Capacity
 * @returns Total away time in minutes
 */
export function totalAwayTime(silosOwned: number, siloCapacityLevel: number): number {
  return silosOwned * awayTimePerSilo(siloCapacityLevel);
}

/**
 * Format away time in minutes to hours and minutes string.
 * @param minutes Duration in minutes
 * @returns Formatted string like "12h 30m" or "5h"
 */
export function formatSiloTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
