/**
 * Research logic.
 */

import { clamp } from './math';
import { allResearches } from 'lib';
import type { Research, BaseCalculationResearch } from '@/types';

/**
 * Select specific researches by ID from the global list and map them to a base format.
 * @param ids List of research IDs to select
 * @param mapper Optional function to transform the selected research into a specific type.
 *               If not provided, returns BaseCalculationResearch.
 */
export function selectResearches<T extends BaseCalculationResearch = BaseCalculationResearch>(
  ids: string[],
  mapper?: (r: Research) => T
): T[] {
  return (allResearches as Research[])
    .filter(r => ids.includes(r.id))
    .map(r => {
      if (mapper) {
        return mapper(r);
      }
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        maxLevel: r.levels,
        perLevel: r.per_level,
      } as unknown as T;
    });
}

/**
 * Calculate the linear effect of a research item.
 * @param level The current level of the research
 * @param maxLevel The maximum level of the research
 * @param perLevel The effect per level
 * @param base The base value (default 1)
 * @returns The calculated effect
 */
export function calculateLinearEffect(level: number, maxLevel: number, perLevel: number, base: number = 1): number {
  if (level <= 0) return base;
  const clampedLevel = clamp(level, 0, maxLevel);
  return base + perLevel * clampedLevel;
}

/**
 * Clamp a level to be within 0 and maxLevel.
 * @param level The current level
 * @param maxLevel The maximum level
 * @returns The clamped level
 */
export function clampLevel(level: number, maxLevel: number): number {
  return clamp(level, 0, maxLevel);
}
