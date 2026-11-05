/**
 * Pure calculation functions for Egg Laying Rate.
 * These have no Vue dependencies and are fully testable.
 */

import type { Research, ResearchLevels, LayRateInput, LayRateOutput } from '@/types';
import { allResearches } from 'lib';
import { calculateLinearEffect, selectResearches } from '@/utils/research';

/**
 * Lay rate research definition.
 */
export interface LayRateResearch {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  perLevel: number;
  isEpic: boolean;
}

// Base egg laying rate: 2 eggs per minute per chicken
const BASE_RATE_PER_SECOND = 2 / 60;

// Common research IDs for lay rate (from researches.json)
const commonLayRateResearchIds = [
  'comfy_nests', // Comfortable Nests
  'hen_house_ac', // Hen House A/C
  'improved_genetics', // Improved Genetics
  'time_compress', // Time Compression
  'timeline_diversion', // Timeline Diversion
  'relativity_optimization', // Relativity Optimization
];

// Build common researches from JSON
const commonLayRateResearches: LayRateResearch[] = selectResearches(commonLayRateResearchIds, r => ({
  id: r.id,
  name: r.name,
  description: r.description,
  maxLevel: r.levels,
  perLevel: r.per_level,
  isEpic: false,
}));

// Epic research (not in researches.json, defined manually)
const epicLayRateResearch: LayRateResearch = {
  id: 'epic_egg_laying',
  name: 'Epic Comfy Nests',
  description: 'Increase egg laying rate by 5% per level',
  maxLevel: 20,
  perLevel: 0.05,
  isEpic: true,
};

// All lay rate researches combined
const allLayRateResearches: LayRateResearch[] = [...commonLayRateResearches, epicLayRateResearch];

/**
 * Calculate multiplier from a single research at a given level.
 * All lay rate researches are multiplicative: (1 + perLevel * level)
 */
export function calculateResearchMultiplier(research: LayRateResearch, level: number): number {
  return calculateLinearEffect(level, research.maxLevel, research.perLevel);
}

/**
 * Main calculation: compute lay rate with full breakdown.
 */
export function calculateLayRate(input: LayRateInput): LayRateOutput {
  const { researchLevels, epicComfyNestsLevel, elrMultiplier, population, artifactMultiplier, artifactEffects } =
    input;

  // Calculate combined research multiplier from common researches
  let researchMultiplier = 1;
  for (const research of commonLayRateResearches) {
    const level = researchLevels[research.id] || 0;
    researchMultiplier *= calculateResearchMultiplier(research, level);
  }

  // Calculate epic multiplier (Epic Comfy Nests)
  const epicMultiplier = calculateResearchMultiplier(epicLayRateResearch, epicComfyNestsLevel);

  // Calculate final rate per chicken (eggs/second)
  const ratePerChickenPerSecond =
    BASE_RATE_PER_SECOND * researchMultiplier * epicMultiplier * elrMultiplier * artifactMultiplier;

  // Calculate total rate (eggs/second)
  const totalRatePerSecond = ratePerChickenPerSecond * Math.max(0, population);

  // Build research breakdown for display
  const researchBreakdown = allLayRateResearches.map(research => {
    const level = research.isEpic ? epicComfyNestsLevel : researchLevels[research.id] || 0;

    return {
      researchId: research.id,
      name: research.name,
      description: research.description,
      level,
      maxLevel: research.maxLevel,
      multiplier: calculateResearchMultiplier(research, level),
      isEpic: research.isEpic,
    };
  });

  return {
    baseRatePerSecond: BASE_RATE_PER_SECOND,
    researchMultiplier,
    epicMultiplier,
    elrMultiplier,
    artifactMultiplier,
    ratePerChickenPerSecond,
    totalRatePerSecond,
    researchBreakdown,
    artifactBreakdown: artifactEffects,
  };
}

/**
 * Get all lay rate researches for display/iteration.
 */
export function getLayRateResearches(): LayRateResearch[] {
  return allLayRateResearches;
}

/**
 * Get only common (non-epic) lay rate researches.
 */
export function getCommonLayRateResearches(): LayRateResearch[] {
  return commonLayRateResearches;
}

/**
 * Get the epic lay rate research.
 */
export function getEpicLayRateResearch(): LayRateResearch {
  return epicLayRateResearch;
}

/**
 * Convert rate from per-second to specified time unit.
 */
export function convertRate(ratePerSecond: number, timeUnit: 'minute' | 'hour' | 'day'): number {
  switch (timeUnit) {
    case 'minute':
      return ratePerSecond * 60;
    case 'hour':
      return ratePerSecond * 3600;
    case 'day':
      return ratePerSecond * 86400;
  }
}
