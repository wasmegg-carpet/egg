/**
 * Artifact and stone types for the planner.
 */

export const RARITY_CODES = ['C', 'R', 'E', 'L'] as const;
export type RarityCode = (typeof RARITY_CODES)[number];

export interface ArtifactOption {
  id: string; // Unique ID: "{familyId}-{tier}-{rarity}"
  afxId: number; // AFX numeric ID
  familyId: string; // e.g., "puzzle-cube"
  familyName: string; // e.g., "Puzzle cube" (lowest tier name)
  tier: number; // 1-4
  rarity: number; // 0-3 (C, R, E, L)
  rarityCode: RarityCode;
  label: string; // e.g., "T4L Puzzle cube"
  effect: string; // e.g., "-50% research cost"
  effectDelta: number; // e.g., -0.5
  effectTarget: string; // e.g., "research cost"
  slots: number; // Number of stone slots (0-3)
  iconPath: string; // e.g., "egginc/afx_puzzle_cube_4.png"
}

export interface StoneOption {
  id: string; // Unique ID: "{familyId}-{tier}"
  familyId: string; // e.g., "lunar-stone"
  familyName: string; // e.g., "Lunar stone"
  tier: number; // 2-4 (T1 is ingredient, not usable)
  label: string; // e.g., "T4 Lunar stone"
  effect: string; // e.g., "+40% away earnings"
  effectDelta: number; // e.g., 0.4
  effectTarget: string; // e.g., "away earnings"
  iconPath: string; // e.g., "egginc/afx_lunar_stone_4.png"
}

export interface EquippedArtifact {
  artifactId: string | null; // ArtifactOption.id or null if empty
  stones: (string | null)[]; // StoneOption.id for each slot, or null if empty
}

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
