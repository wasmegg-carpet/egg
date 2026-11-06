import { habTypes as libHabTypes, type Hab as LibHab, isHabId } from 'lib/farm/hab_space';
import { applyDiscount } from 'lib/planners/utils/pricing';
import type { HabId, HabCostModifiers } from 'lib/planners/habs';
import { getHabCostMultiplier } from 'lib/planners/habs';
export type { HabId, HabCostModifiers } from 'lib/planners/habs';
export { isPortalHab, getHabCostMultiplier, countHabsOfType } from 'lib/planners/habs';
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
