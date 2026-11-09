/**
 * Artifact and stone types for the planner.
 */

export type { RarityCode, ArtifactOption, StoneOption, EquippedArtifact } from 'lib/planners/artifacts/types';
export { RARITY_CODES } from 'lib/planners/artifacts/types';

export interface ArtifactEffect {
  source: 'artifact' | 'stone';
  label: string;
  effect: string;
  effectDelta: number;
  effectTarget: string;
  /** How much of the listed effect counts on an enlightenment farm: 1 for Light of Eggendil, otherwise
   *  the host's clarity stones added up. `effectDelta` is already scaled by it. */
  clarity: number;
}

export interface ArtifactModifier {
  effectTarget: string;
  effects: ArtifactEffect[];
  totalMultiplier: number;
  isMultiplicative: boolean;
}

export interface ArtifactModifiers {
  eggValue: ArtifactModifier;
  habCapacity: ArtifactModifier;
  shippingRate: ArtifactModifier;
  awayEarnings: ArtifactModifier;
  eggLayingRate: ArtifactModifier;
  internalHatcheryRate: ArtifactModifier;
  researchCost: ArtifactModifier;
  soulEggBonus: ArtifactModifier;
  prophecyEggBonus: ArtifactModifier;
}
