/**
 * Common research calculations including tier unlock logic and cost discounts.
 */

import type { ResearchLevels } from '@/types';

import { applyDiscountCeil } from 'lib/planners/utils/pricing';
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
export function getBaseVirtuePrice(research: CommonResearch, currentLevel: number): number {
  if (currentLevel >= research.levels) return Infinity;
  if (currentLevel < 0) return research.virtue_prices[0] || 0;
  return research.virtue_prices[currentLevel] || 0;
}

/**
 * Get the discounted virtue price for a research at a specific level.
 */
export function getDiscountedVirtuePrice(
  research: CommonResearch,
  currentLevel: number,
  modifiers: ResearchCostModifiers,
  isActiveSale: boolean = false
): number {
  const basePrice = getBaseVirtuePrice(research, currentLevel);
  if (!isFinite(basePrice)) return Infinity;
  return applyDiscountCeil(basePrice, calculateCostMultiplier(modifiers, isActiveSale));
}

/**
 * Calculate total virtue cost to max out a research from current level.
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
    const basePrice = research.virtue_prices[level] || 0;
    total += applyDiscountCeil(basePrice, multiplier);
  }

  return total;
}

/**
 * Calculate total virtue cost to max out an entire tier.
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
