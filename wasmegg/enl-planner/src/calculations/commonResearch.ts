/**
 * Common research calculations including tier unlock logic and cost discounts.
 */

import type { ResearchLevels } from '@/types';

import type { ResearchCostModifiers, TierSummary, CommonResearch } from 'lib/planners/calculations/commonResearch';
import {
  TIER_UNLOCK_THRESHOLDS,
  calculateCostMultiplier,
  researchByTier,
  isTierUnlocked,
  purchasesNeededForTier,
} from 'lib/planners/calculations/commonResearch';
export type { CommonResearch, ResearchCostModifiers, TierSummary } from 'lib/planners/calculations/commonResearch';
export {
  getCommonResearches,
  getResearchByTier,
  getTiers,
  getResearchById,
  calculatePurchasesBeforeTier,
  calculatePurchasesUpToTier,
  calculatePurchasesByTierMap,
  isTierUnlocked,
  purchasesNeededForTier,
  TIER_UNLOCK_THRESHOLDS,
  calculateCostMultiplier,
} from 'lib/planners/calculations/commonResearch';

/**
 * Get the base virtue price for a research at a specific level (0-indexed).
 * Returns the price to buy level (currentLevel + 1).
 */
export function getBaseResearchPrice(research: CommonResearch, currentLevel: number): number {
  if (currentLevel >= research.levels) return Infinity;
  if (currentLevel < 0) return research.prices[0] || 0;
  return research.prices[currentLevel] || 0;
}

/**
 * Get the discounted virtue price for a research at a specific level.
 */
export function getDiscountedResearchPrice(
  research: CommonResearch,
  currentLevel: number,
  modifiers: ResearchCostModifiers,
  isActiveSale: boolean = false
): number {
  const basePrice = getBaseResearchPrice(research, currentLevel);
  if (!isFinite(basePrice)) return Infinity;
  // Regular prices aren't whole numbers (the first level of Comfortable Nests costs 0.5), so no rounding.
  return basePrice * calculateCostMultiplier(modifiers, isActiveSale);
}

/**
 * Calculate total cost to max out a research from current level.
 */
export function getTotalCostToMax(
  research: CommonResearch,
  currentLevel: number,
  modifiers: ResearchCostModifiers,
  isActiveSale: boolean = false
): number {
  let total = 0;
  const multiplier = calculateCostMultiplier(modifiers, isActiveSale);

  for (let level = currentLevel; level < research.levels; level++) {
    const basePrice = research.prices[level] || 0;
    total += basePrice * multiplier;
  }

  return total;
}

/**
 * Calculate total cost to max out an entire tier.
 */
export function getTotalCostToMaxTier(
  tier: number,
  researchLevels: ResearchLevels,
  modifiers: ResearchCostModifiers,
  isActiveSale: boolean = false
): number {
  const tierResearches = researchByTier.get(tier) || [];
  let total = 0;

  for (const research of tierResearches) {
    const currentLevel = researchLevels[research.id] || 0;
    total += getTotalCostToMax(research, currentLevel, modifiers, isActiveSale);
  }

  return total;
}

export function getTierSummary(
  tier: number,
  researchLevels: ResearchLevels,
  modifiers: ResearchCostModifiers,
  isActiveSale: boolean = false
): TierSummary {
  const tierResearches = researchByTier.get(tier) || [];

  let totalLevels = 0;
  let purchasedLevels = 0;

  for (const research of tierResearches) {
    totalLevels += research.levels;
    purchasedLevels += researchLevels[research.id] || 0;
  }

  return {
    tier,
    totalResearches: tierResearches.length,
    totalLevels,
    purchasedLevels,
    isUnlocked: isTierUnlocked(researchLevels, tier),
    purchasesNeeded: purchasesNeededForTier(researchLevels, tier),
    costToMax: getTotalCostToMaxTier(tier, researchLevels, modifiers, isActiveSale),
  };
}
