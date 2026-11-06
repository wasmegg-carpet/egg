/**
 * Hab helpers shared by the planners. Prices live in each planner's lib/habs.ts.
 */

import { calculateCostMultiplier } from './utils/pricing';
import type { Hab as LibHab } from '../farm/hab_space';
import { habTypes as libHabTypes } from '../farm/hab_space';

export type HabId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18;

export function isPortalHab(hab: { id: number }): boolean {
  return hab.id >= 17;
}

/**
 * Cost modifiers for hab purchases.
 */
export interface HabCostModifiers {
  cheaperContractorsLevel: number; // Epic research: -5% per level (max 10)
  habCostMultiplier: number; // Colleggtible: 0.75-1.0
}

/**
 * Calculate the total cost multiplier from all sources.
 */
export function getHabCostMultiplier(modifiers: HabCostModifiers, isActiveSale: boolean = false): number {
  const multiplier = calculateCostMultiplier(modifiers.cheaperContractorsLevel, 0.05, modifiers.habCostMultiplier);
  return isActiveSale ? multiplier * 0.2 : multiplier;
}

/**
 * Count how many of a specific hab type are in the current slots.
 * @param habIds Current hab configuration
 * @param targetHabId The hab type to count
 * @returns Count of that hab type
 */
export function countHabsOfType(habIds: (number | null)[], targetHabId: number): number {
  return habIds.filter(id => id === targetHabId).length;
}

export interface Hab extends Omit<LibHab, 'normalCost' | 'virtueCost'> {
  // Alias for baseHabSpace to maintain compatibility
  baseCapacity: number;
  // Enforce both price lists: the ascension planner pays virtue prices, the enlightenment planner
  // regular prices (see each planner's getDiscountedHabPrice).
  normalCost: [number, number, number, number];
  virtueCost: [number, number, number, number];
}

export const habTypes: Hab[] = libHabTypes.map(h => ({
  ...h,
  baseCapacity: h.baseHabSpace,
  normalCost: (h.normalCost as [number, number, number, number]) || [0, 0, 0, 0],
  virtueCost: (h.virtueCost as [number, number, number, number]) || [0, 0, 0, 0],
}));

/**
 * Get a hab by its ID.
 */
export function getHabById(id: HabId): Hab {
  return habTypes[id];
}
