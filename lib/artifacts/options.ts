import { allPossibleTiers } from './data';
import { ei } from '../proto';
import { ArtifactOption, StoneOption, RARITY_CODES } from './types';

// Stones to exclude (not useful for ascension planning or artifact-set optimization)
const EXCLUDED_STONES = ['prophecy-stone', 'clarity-stone', 'dilithium-stone', 'soul-stone'];

/**
 * Parse artifact families and generate all artifact options.
 */
function parseArtifacts(): ArtifactOption[] {
  const options: ArtifactOption[] = [];

  for (const tier of allPossibleTiers) {
    if (tier.afx_type !== ei.ArtifactSpec.Type.ARTIFACT) continue;
    if (!tier.effects) continue;

    for (const effect of tier.effects) {
      const rarityCode = RARITY_CODES[effect.afx_rarity];
      if (!rarityCode) continue;

      options.push({
        id: `${tier.family.id}-${tier.tier_number}-${effect.afx_rarity}`,
        afxId: tier.afx_id,
        familyId: tier.family.id,
        familyName: tier.family.name,
        tier: tier.tier_number,
        rarity: effect.afx_rarity,
        rarityCode,
        label: `T${tier.tier_number}${rarityCode} ${tier.family.name}`,
        effect: effect.effect,
        effectDelta: effect.effect_delta,
        effectTarget: effect.effect_target,
        slots: effect.slots || 0,
        iconPath: `egginc/${tier.icon_filename}`,
      });
    }
  }

  options.sort((a, b) => {
    if (a.familyName !== b.familyName) return a.familyName.localeCompare(b.familyName);
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.rarity - b.rarity;
  });

  return options;
}

/**
 * Parse stone families and generate all stone options.
 */
function parseStones(): StoneOption[] {
  const options: StoneOption[] = [];

  for (const tier of allPossibleTiers) {
    if (tier.afx_type !== ei.ArtifactSpec.Type.STONE) continue;
    if (EXCLUDED_STONES.includes(tier.family.id)) continue;

    if (tier.tier_number === 1) continue;
    if (!tier.effects || tier.effects.length === 0) continue;

    const effect = tier.effects[0];

    options.push({
      id: `${tier.family.id}-${tier.tier_number}`,
      familyId: tier.family.id,
      familyName: tier.family.name,
      tier: tier.tier_number,
      label: `T${tier.tier_number} ${tier.family.name}`,
      effect: effect.effect,
      effectDelta: effect.effect_delta,
      effectTarget: effect.effect_target,
      iconPath: `egginc/${tier.icon_filename}`,
    });
  }

  options.sort((a, b) => {
    if (a.familyName !== b.familyName) return a.familyName.localeCompare(b.familyName);
    return a.tier - b.tier;
  });

  return options;
}

export const artifactOptions = parseArtifacts();
export const stoneOptions = parseStones();

const artifactMap = new Map(artifactOptions.map(a => [a.id, a]));
const stoneMap = new Map(stoneOptions.map(s => [s.id, s]));

export function getArtifact(id: string | null): ArtifactOption | null {
  if (!id) return null;
  return artifactMap.get(id) || null;
}

export function getStone(id: string | null): StoneOption | null {
  if (!id) return null;
  return stoneMap.get(id) || null;
}

export function getArtifactFamilies(): { id: string; name: string }[] {
  const seen = new Set<string>();
  const families: { id: string; name: string }[] = [];
  for (const opt of artifactOptions) {
    if (!seen.has(opt.familyId)) {
      seen.add(opt.familyId);
      families.push({ id: opt.familyId, name: opt.familyName });
    }
  }
  return families;
}

export function getArtifactsByFamily(familyId: string): ArtifactOption[] {
  return artifactOptions.filter(a => a.familyId === familyId);
}

export function getStoneFamilies(): { id: string; name: string }[] {
  const seen = new Set<string>();
  const families: { id: string; name: string }[] = [];
  for (const opt of stoneOptions) {
    if (!seen.has(opt.familyId)) {
      seen.add(opt.familyId);
      families.push({ id: opt.familyId, name: opt.familyName });
    }
  }
  return families;
}

export function getStonesByFamily(familyId: string): StoneOption[] {
  return stoneOptions.filter(s => s.familyId === familyId);
}
