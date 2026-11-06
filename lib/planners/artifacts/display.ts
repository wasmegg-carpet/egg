import type { RarityCode } from './types';

const RARITY_TINTS: Record<RarityCode, string | null> = {
  C: null,
  R: '#0D6DFD30', // ~19% opacity: visible but subtle
  E: '#FF00FF30',
  L: '#FECD1B40', // slightly higher for yellow visibility
};

/**
 * Background tint for an artifact of this rarity (code 'C'/'R'/'E'/'L' or index 0-3).
 * Commons get `commonFallback` (callers differ: white slots vs. slate chips).
 */
export function rarityTint(rarity: RarityCode | number | string, commonFallback = 'white'): string {
  const code = typeof rarity === 'number' ? (['C', 'R', 'E', 'L'] as const)[rarity] : (rarity as RarityCode);
  return RARITY_TINTS[code] ?? commonFallback;
}
