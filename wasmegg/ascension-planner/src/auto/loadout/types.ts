import type { EquippedArtifact } from '@/lib/artifacts/types';

export const STONE_TIERS = [2, 3, 4] as const;
export type StoneTier = (typeof STONE_TIERS)[number];

/** Lunar/shell feed the earnings set (C1); quantum/tachyon feed delivery-set stone placement (C3/H1). */
export const STONE_FAMILIES = ['lunar', 'shell', 'quantum', 'tachyon'] as const;
export type StoneFamily = (typeof STONE_FAMILIES)[number];

export type StonePool = Record<StoneFamily, Record<StoneTier, number>>;

/** One owned artifact the delivery (ELR) search may use. */
export interface DeliveryCandidate {
  artifactId: string; // ArtifactOption.id, e.g. 'quantum-metronome-4-1'
  slots: number;
  isTarget: boolean; // metronome / compass / gusset, vs. a stone holder
}

export type DeliveryInputs =
  /** H1 still searches over these candidates for the best structure. */
  | { mode: 'auto'; candidates: DeliveryCandidate[] }
  /** User-picked structure, one artifact id (or null) per slot. Stones are still placed at H1. */
  | { mode: 'fixed'; artifactIds: (string | null)[] };

/**
 * The auto planner's artifact/stone inputs: what C1 equips as the earnings set and what C3/H1
 * search over for the delivery set, in place of reading the player's backup directly.
 */
export interface AutoLoadoutInputs {
  /** Four explicit slots. Stones on these slots are ignored: C1 sockets them from `stones`. */
  earnings: EquippedArtifact[];
  delivery: DeliveryInputs;
  stones: StonePool;
}

export function createEmptyStonePool(): StonePool {
  const pool = {} as StonePool;
  for (const family of STONE_FAMILIES) pool[family] = { 2: 0, 3: 0, 4: 0 };
  return pool;
}

/** `StoneOption.id` for a family/tier, e.g. ('quantum', 4) -> 'quantum-stone-4'. */
export function stoneId(family: StoneFamily, tier: StoneTier): string {
  return `${family}-stone-${tier}`;
}
