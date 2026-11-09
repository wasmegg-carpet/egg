import { isHabId } from 'lib/farm/hab_space';

import type { HabId, HabCostModifiers, Hab } from 'lib/planners/habs';
import { getHabCostMultiplier } from 'lib/planners/habs';
export type { Hab, HabId, HabCostModifiers } from 'lib/planners/habs';
export { habTypes, getHabById, isPortalHab, getHabCostMultiplier, countHabsOfType } from 'lib/planners/habs';
export { isHabId };

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
  const basePrice = hab.normalCost[purchaseIndex];
  // Regular prices aren't whole numbers (the second Coop costs 29.12), so no rounding.
  return basePrice * getHabCostMultiplier(modifiers, isActiveSale);
}
