/**
 * Common research calculations including tier unlock logic and cost discounts.
 */

import type { Research, ResearchLevels } from '@/types';
import { allResearches } from 'lib';
import { calculateCostMultiplier as calculateBaseCostMultiplier, applyDiscountCeil } from '@/utils/pricing';

/**
 * Common research entry with full data
 */
export interface CommonResearch extends Research {
  // Inherited: id, name, description, tier, levels, per_level, prices, virtue_prices, etc.
}

/**
 * Tier unlock thresholds - cumulative purchases required to unlock each tier
 * Index 0 = tier 1 (requires 0 purchases)
 * Index 12 = tier 13 (requires 1655 purchases from tiers 1-12)
 */
export const TIER_UNLOCK_THRESHOLDS = [
  0, // Tier 1
  30, // Tier 2
  80, // Tier 3
  160, // Tier 4
  280, // Tier 5
  400, // Tier 6
  520, // Tier 7
  650, // Tier 8
  800, // Tier 9
  980, // Tier 10
  1185, // Tier 11
  1390, // Tier 12
  1655, // Tier 13
] as const;

// Filter to only common research and sort by tier then serial_id
const commonResearches: CommonResearch[] = (allResearches as Research[])
  .filter(r => r.type === 'common')
  .sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.serial_id - b.serial_id;
  });

// Group by tier for easy access
const researchByTier: Map<number, CommonResearch[]> = new Map();
for (const research of commonResearches) {
  if (!researchByTier.has(research.tier)) {
    researchByTier.set(research.tier, []);
  }
  researchByTier.get(research.tier)!.push(research);
}

/**
 * Get all common researches
 */
export function getCommonResearches(): CommonResearch[] {
  return commonResearches;
}

/**
 * Get common researches grouped by tier
 */
export function getResearchByTier(): Map<number, CommonResearch[]> {
  return researchByTier;
}

/**
 * Get all unique tier numbers
 */
export function getTiers(): number[] {
  return Array.from(researchByTier.keys()).sort((a, b) => a - b);
}

/**
 * Get research by ID
 */
export function getResearchById(id: string): CommonResearch | undefined {
  return commonResearches.find(r => r.id === id);
}

/**
 * Calculate total purchases made across all tiers up to (but not including) a specific tier.
 */
export function calculatePurchasesBeforeTier(researchLevels: ResearchLevels, tier: number): number {
  let total = 0;
  for (const research of commonResearches) {
    if (research.tier < tier) {
      total += researchLevels[research.id] || 0;
    }
  }
  return total;
}

/**
 * Calculate total purchases made in tiers 1 through tierNum (inclusive).
 */
export function calculatePurchasesUpToTier(researchLevels: ResearchLevels, tierNum: number): number {
  let total = 0;
  for (const research of commonResearches) {
    if (research.tier <= tierNum) {
      total += researchLevels[research.id] || 0;
    }
  }
  return total;
}

/**
 * Calculate total purchases made in each tier.
 * Returns a Map where key is tier number and value is total purchases.
 */
export function calculatePurchasesByTierMap(researchLevels: ResearchLevels): Map<number, number> {
  const map = new Map<number, number>();
  for (const research of commonResearches) {
    const current = map.get(research.tier) || 0;
    map.set(research.tier, current + (researchLevels[research.id] || 0));
  }
  return map;
}

/**
 * Check if a tier is unlocked based on total purchases from previous tiers.
 */
export function isTierUnlocked(researchLevels: ResearchLevels, tier: number): boolean {
  if (tier <= 1) return true;
  const tierIndex = tier - 1;
  if (tierIndex >= TIER_UNLOCK_THRESHOLDS.length) return false;

  const requiredPurchases = TIER_UNLOCK_THRESHOLDS[tierIndex];
  const currentPurchases = calculatePurchasesUpToTier(researchLevels, tier - 1);
  return currentPurchases >= requiredPurchases;
}

/**
 * Get the number of purchases still needed to unlock a tier.
 */
export function purchasesNeededForTier(researchLevels: ResearchLevels, tier: number): number {
  if (tier <= 1) return 0;
  const tierIndex = tier - 1;
  if (tierIndex >= TIER_UNLOCK_THRESHOLDS.length) return Infinity;

  const requiredPurchases = TIER_UNLOCK_THRESHOLDS[tierIndex];
  const currentPurchases = calculatePurchasesUpToTier(researchLevels, tier - 1);
  return Math.max(0, requiredPurchases - currentPurchases);
}

/**
 * Cost discount modifiers
 */
export interface ResearchCostModifiers {
  labUpgradeLevel: number; // Epic research: Lab Upgrade (cheaper_research), 0-10
  researchCostMultiplier: number; // Colleggtible multiplier (0.95-1.0)
  puzzleCubeMultiplier: number; // Artifact multiplier (e.g., 0.5 for -50%)
}

/**
 * Calculate the total cost multiplier from all discounts.
 * All discounts are multiplicative.
 */
export function calculateCostMultiplier(modifiers: ResearchCostModifiers, isActiveSale: boolean = false): number {
  const multiplier = calculateBaseCostMultiplier(
    modifiers.labUpgradeLevel,
    0.05,
    modifiers.researchCostMultiplier,
    modifiers.puzzleCubeMultiplier
  );
  return isActiveSale ? multiplier * 0.3 : multiplier;
}

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

/**
 * Get summary stats for a tier
 */
export interface TierSummary {
  tier: number;
  totalResearches: number;
  totalLevels: number; // Total possible levels across all research in tier
  purchasedLevels: number; // Current purchased levels
  isUnlocked: boolean;
  purchasesNeeded: number; // Purchases still needed to unlock (0 if unlocked)
  costToMax: number; // Discounted virtue cost to max all research in tier
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
