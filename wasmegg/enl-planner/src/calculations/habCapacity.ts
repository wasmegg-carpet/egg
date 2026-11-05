/**
 * Pure calculation functions for hab capacity.
 * These have no Vue dependencies and are fully testable.
 */

import type { Research, ResearchLevels, HabCapacityInput, HabCapacityOutput } from '@/types';
import { habTypes, isPortalHab, type Hab } from '@/lib/habs';
import { calculateLinearEffect, selectResearches } from '@/utils/research';

import { BaseCalculationResearch } from '@/types';

/**
 * Hab capacity research with portal-only flag.
 */
export interface HabCapacityResearch extends BaseCalculationResearch {
  portalOnly: boolean;
}

// Research IDs relevant to hab capacity
const habCapacityResearchIds = [
  'hab_capacity1', // Hen House Remodel
  'microlux', // Microlux™ Chicken Suites
  'grav_plating', // Grav Plating
  'wormhole_dampening', // Wormhole Dampening (portal habs only)
];

// Filter and annotate researches
const habCapacityResearches: HabCapacityResearch[] = selectResearches(habCapacityResearchIds, r => ({
  id: r.id,
  name: r.name,
  description: r.description,
  maxLevel: r.levels,
  perLevel: r.per_level,
  portalOnly: r.id === 'wormhole_dampening',
}));

/**
 * Calculate the multiplier from a single research at a given level.
 * All hab capacity researches use additive compounding.
 */
export function calculateResearchMultiplier(research: HabCapacityResearch, level: number): number {
  return calculateLinearEffect(level, research.maxLevel, research.perLevel);
}

/**
 * Calculate the combined multiplier from all hab capacity researches.
 * Returns separate multipliers for universal and portal-only researches.
 */
export function calculateTotalResearchMultipliers(researchLevels: ResearchLevels): {
  universal: number;
  portalOnly: number;
} {
  let universal = 1;
  let portalOnly = 1;

  for (const research of habCapacityResearches) {
    const level = researchLevels[research.id] || 0;
    const multiplier = calculateResearchMultiplier(research, level);

    if (research.portalOnly) {
      portalOnly *= multiplier;
    } else {
      universal *= multiplier;
    }
  }

  return { universal, portalOnly };
}

/**
 * Calculate capacity for a single hab.
 */
export function calculateHabCapacity(
  hab: Hab,
  universalMultiplier: number,
  portalMultiplier: number,
  habCapMultiplier: number,
  artifactMultiplier: number
): number {
  const baseMultiplier = universalMultiplier * habCapMultiplier * artifactMultiplier;
  const finalMultiplier = isPortalHab(hab) ? baseMultiplier * portalMultiplier : baseMultiplier;

  // Capacity rounds up (ceiling)
  return Math.ceil(hab.baseCapacity * finalMultiplier);
}

/**
 * Main calculation: compute total hab capacity with full breakdown.
 */
export function calculateHabCapacity_Full(input: HabCapacityInput): HabCapacityOutput {
  const { habIds, researchLevels, habCapMultiplier, artifactMultiplier, artifactEffects } = input;

  // Calculate research multipliers
  const { universal, portalOnly } = calculateTotalResearchMultipliers(researchLevels);

  // Calculate per-hab breakdown
  const habBreakdown = habIds.map((habId, slotIndex) => {
    if (habId === null) {
      return {
        slotIndex,
        habId: null,
        habName: null,
        baseCapacity: 0,
        researchMultiplier: 1,
        habCapMultiplier: 1,
        artifactMultiplier: 1,
        finalCapacity: 0,
      };
    }

    const hab = habTypes[habId];
    const isPortal = isPortalHab(hab);
    const researchMult = isPortal ? universal * portalOnly : universal;

    return {
      slotIndex,
      habId: hab.id,
      habName: hab.name,
      baseCapacity: hab.baseCapacity,
      researchMultiplier: researchMult,
      habCapMultiplier,
      artifactMultiplier,
      finalCapacity: calculateHabCapacity(hab, universal, portalOnly, habCapMultiplier, artifactMultiplier),
    };
  });

  // Calculate totals
  const totalBaseCapacity = habBreakdown.reduce((sum, h) => sum + h.baseCapacity, 0);
  const totalFinalCapacity = habBreakdown.reduce((sum, h) => sum + h.finalCapacity, 0);

  // Build research breakdown for display
  const researchBreakdown = habCapacityResearches.map(research => ({
    researchId: research.id,
    name: research.name,
    description: research.description,
    level: researchLevels[research.id] || 0,
    maxLevel: research.maxLevel,
    multiplier: calculateResearchMultiplier(research, researchLevels[research.id] || 0),
    portalOnly: research.portalOnly,
  }));

  return {
    habBreakdown,
    totalBaseCapacity,
    researchMultiplier: universal,
    portalResearchMultiplier: portalOnly,
    habCapMultiplier,
    artifactMultiplier,
    totalFinalCapacity,
    researchBreakdown,
    artifactBreakdown: artifactEffects,
  };
}

/**
 * Get all hab capacity researches for display/iteration.
 */
export function getHabCapacityResearches(): HabCapacityResearch[] {
  return habCapacityResearches;
}
