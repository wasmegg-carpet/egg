/**
 * Pricing utilities.
 */

/**
 * Calculate the cost multiplier.
 * @param epicLevel The epic research level (e.g., epic discount research)
 * @param discountPerLevel The discount per level of the epic research (default 0.05)
 * @param otherMultipliers Any other multipliers to apply (e.g., artifact discounts)
 * @returns The total cost multiplier
 */
export function calculateCostMultiplier(
  epicLevel: number,
  discountPerLevel: number = 0.05,
  ...otherMultipliers: number[]
): number {
  const epicMultiplier = 1 - discountPerLevel * Math.max(0, Math.min(epicLevel, 10)); // Assuming max 10 levels for epic discount
  const combinedOtherMultipliers = otherMultipliers.reduce((acc, curr) => acc * curr, 1);
  return epicMultiplier * combinedOtherMultipliers;
}

/**
 * Calculate the discounted price.
 * @param basePrice The base price of the item
 * @param multiplier The total cost multiplier
 * @returns The discounted price (floored)
 */
export function applyDiscount(basePrice: number, multiplier: number): number {
  return Math.floor(basePrice * multiplier);
}

/**
 * Calculate the discounted price, rounding up.
 * @param basePrice The base price of the item
 * @param multiplier The total cost multiplier
 * @returns The discounted price (ceiled)
 */
export function applyDiscountCeil(basePrice: number, multiplier: number): number {
  return Math.ceil(basePrice * multiplier);
}
