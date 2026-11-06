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
}
