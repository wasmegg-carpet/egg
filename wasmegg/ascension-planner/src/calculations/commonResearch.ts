/**
 * Common research calculations, priced from this planner's gems table.
 */

import { createResearchPricing } from 'lib/planners/calculations/commonResearch';

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

export const {
  getBaseResearchPrice,
  getDiscountedResearchPrice,
  getTotalCostToMax,
  getTotalCostToMaxTier,
  getTierSummary,
} = createResearchPricing('virtue_prices');
