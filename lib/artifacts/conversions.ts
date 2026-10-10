import { Artifact, newItem } from './effects';
import { allPossibleTiers } from './data';
import { getArtifact, getStone } from './options';
import { EquippedArtifact } from './types';
import { ei } from '../proto';

/**
 * Convert a lib Artifact to the option-ID `EquippedArtifact` format.
 */
export function libArtifactToEquippedArtifact(afx: Artifact): EquippedArtifact {
  const tier = allPossibleTiers.find(t => t.afx_id === afx.afxId && t.afx_level === afx.afxLevel);
  if (!tier) {
    return { artifactId: null, stones: [] };
  }

  const artifactId = `${tier.family.id}-${tier.tier_number}-${afx.afxRarity}`;
  const stones = afx.stones.map(s => {
    const stoneTier = allPossibleTiers.find(t => t.afx_id === s.afxId && t.afx_level === s.afxLevel);
    return stoneTier ? `${stoneTier.family.id}-${stoneTier.tier_number}` : null;
  });

  return { artifactId, stones };
}

/**
 * Convert an option-ID `EquippedArtifact` loadout (with stones) into lib `Artifact[]`,
 * the format consumed by the shared Clothed TE formulas (`cteFromArtifacts`, etc).
 * Inverse of {@link libArtifactToEquippedArtifact}.
 */
export function equippedArtifactsToLibArtifacts(loadout: EquippedArtifact[]): Artifact[] {
  const result: Artifact[] = [];
  for (const slot of loadout) {
    const option = getArtifact(slot.artifactId);
    if (!option) continue;
    const tier = allPossibleTiers.find(t => t.family.id === option.familyId && t.tier_number === option.tier);
    if (!tier) continue;

    const host = newItem({ name: option.afxId, level: tier.afx_level, rarity: option.rarity });
    const stones = slot.stones
      .map(id => getStone(id))
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map(stone => allPossibleTiers.find(t => t.family.id === stone.familyId && t.tier_number === stone.tier))
      .filter((t): t is NonNullable<typeof t> => t !== undefined)
      .map(t => newItem({ name: t.afx_id, level: t.afx_level, rarity: ei.ArtifactSpec.Rarity.COMMON }));

    result.push(new Artifact(host, stones));
  }
  return result;
}
