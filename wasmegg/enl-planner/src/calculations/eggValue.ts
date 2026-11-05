/**
 * Pure calculation functions for egg value.
 * These have no Vue dependencies and are fully testable.
 */

import type { Research, ResearchLevels, EggValueInput, EggValueOutput } from '@/types';
import { allResearches } from 'lib';

// Filter to only egg value researches
const eggValueResearches = (allResearches as Research[]).filter(r => r.categories.split(',').includes('egg_value'));

/**
 * Calculate the multiplier from a single research at a given level.
 *
 * For additive compounding: multiplier = 1 + (per_level * level)
 * For multiplicative compounding: multiplier = per_level ^ level
 */
export function calculateResearchMultiplier(research: Research, level: number): number {
  if (level <= 0) return 1;

  const clampedLevel = Math.min(level, research.levels);

  if (research.levels_compound === 'additive') {
    // Each level adds per_level to the bonus
    // e.g., 25% per level at level 10 = 1 + (0.25 * 10) = 3.5x
    return 1 + research.per_level * clampedLevel;
  } else {
    // Each level multiplies by per_level
    // e.g., 2x per level at level 3 = 2^3 = 8x
    return Math.pow(research.per_level, clampedLevel);
  }
}

/**
 * Calculate the combined multiplier from all egg value researches.
 * All research multipliers are multiplied together.
 */
export function calculateTotalResearchMultiplier(researchLevels: ResearchLevels): number {
  let total = 1;

  for (const research of eggValueResearches) {
    const level = researchLevels[research.id] || 0;
    total *= calculateResearchMultiplier(research, level);
  }

  return total;
}

/**
 * Main calculation: compute final egg value with full breakdown.
 */
export function calculateEggValue(input: EggValueInput): EggValueOutput {
  const { baseValue, researchLevels, artifactMultiplier, artifactEffects } = input;

  // Calculate research multiplier
  const researchMultiplier = calculateTotalResearchMultiplier(researchLevels);

  // Final value: base * research * artifacts
  const finalValue = baseValue * researchMultiplier * artifactMultiplier;

  // Build research breakdown for display
  const researchBreakdown = eggValueResearches.map(research => ({
    researchId: research.id,
    name: research.name,
    description: research.description,
    level: researchLevels[research.id] || 0,
    maxLevel: research.levels,
    multiplier: calculateResearchMultiplier(research, researchLevels[research.id] || 0),
  }));

  return {
    baseValue,
    researchMultiplier,
    artifactMultiplier,
    finalValue,
    researchBreakdown,
    artifactBreakdown: artifactEffects,
  };
}
