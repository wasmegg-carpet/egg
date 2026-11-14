/**
 * How much earnings research is left in the unlocked tiers, and how far off the next tier is. Shown
 * above the research lists, since the ROI-driven views (Earnings ROI, Milestones, Hab Space) only
 * ever buy earnings research and can run out of it with the next tier still locked.
 */
import {
  getCommonResearches,
  getTiers,
  isTierUnlocked,
  purchasesNeededForTier,
} from '@planner/calculations/commonResearch';
import { isEarningsResearch } from './researchRanking';

export interface TierUnlockStatus {
  /** Earnings research levels not yet bought in the unlocked tiers. */
  earningsLevelsLeft: number;
  /** The highest unlocked tier. */
  highestUnlockedTier: number;
  /** The first locked tier, or null once every tier is unlocked. */
  nextTier: number | null;
  /** Purchases still needed to unlock `nextTier` (0 when there is none). */
  purchasesNeeded: number;
}

export function computeTierUnlockStatus(researchLevels: Record<string, number>): TierUnlockStatus {
  const tiers = getTiers();
  const nextTier = tiers.find(tier => !isTierUnlocked(researchLevels, tier)) ?? null;
  const highestUnlockedTier = [...tiers].reverse().find(tier => isTierUnlocked(researchLevels, tier)) ?? 1;

  let earningsLevelsLeft = 0;
  for (const research of getCommonResearches()) {
    if (!isTierUnlocked(researchLevels, research.tier) || !isEarningsResearch(research)) continue;
    earningsLevelsLeft += Math.max(0, research.levels - (researchLevels[research.id] || 0));
  }

  return {
    earningsLevelsLeft,
    highestUnlockedTier,
    nextTier,
    purchasesNeeded: nextTier === null ? 0 : purchasesNeededForTier(researchLevels, nextTier),
  };
}
