/**
 * Common research tier and cost-multiplier helpers shared by the planners.
 */

import { calculateCostMultiplier as calculateBaseCostMultiplier } from '../utils/pricing';

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
 * Get summary stats for a tier
 */
export interface TierSummary {
  tier: number;
  totalResearches: number;
  totalLevels: number; // Total possible levels across all research in tier
  purchasedLevels: number; // Current purchased levels
  isUnlocked: boolean;
  purchasesNeeded: number; // Purchases still needed to unlock (0 if unlocked)
  costToMax: number; // Discounted cost to max all research in tier
}
