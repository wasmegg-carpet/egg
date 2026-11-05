import { habTypes as libHabTypes, type Hab as LibHab, isHabId } from 'lib/farm/hab_space';
import { calculateCostMultiplier, applyDiscount } from '@/utils/pricing';

export type HabId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18;
export { isHabId };

export interface Hab extends Omit<LibHab, 'virtueCost'> {
  // Alias for baseHabSpace to maintain compatibility
  baseCapacity: number;
  // Enforce virtueCost presence (ascension planner needs it)
  virtueCost: [number, number, number, number];
}

export const habTypes: Hab[] = libHabTypes.map(h => ({
  ...h,
  baseCapacity: h.baseHabSpace,
  virtueCost: (h.virtueCost as [number, number, number, number]) || [0, 0, 0, 0],
}));

/**
 * Get a hab by its ID.
 */
export function getHabById(id: HabId): Hab {
  return habTypes[id];
}

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
  const multiplier = calculateCostMultiplier(
    modifiers.cheaperContractorsLevel,
    0.05,
    modifiers.habCostMultiplier
  );
  return isActiveSale ? multiplier * 0.2 : multiplier;
}

/**
 * Get the discounted price for a specific hab purchase.
 * @param hab The hab type to purchase
 * @param purchaseIndex Which purchase of this hab type (0-3)
 * @param modifiers Cost modifiers
 * @returns Discounted cost
 */
export function getDiscountedHabPrice(
  hab: Hab,
  purchaseIndex: number,
  modifiers: HabCostModifiers,
  isActiveSale: boolean = false
): number {
  if (purchaseIndex < 0 || purchaseIndex > 3) return 0;
  const basePrice = hab.virtueCost[purchaseIndex];
  return applyDiscount(basePrice, getHabCostMultiplier(modifiers, isActiveSale));
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
