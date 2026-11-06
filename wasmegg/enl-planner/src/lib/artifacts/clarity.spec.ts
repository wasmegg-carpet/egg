import { describe, expect, test } from 'vitest';
import { Artifact, ArtifactSet, newItem } from 'lib/artifacts';
import { ei } from 'lib';
import { allPossibleTiers } from 'lib/artifacts/data';
import { artifactOptions, calculateArtifactModifiers, clarityMultiplier, stoneOptions } from '@/lib/artifacts';

import Name = ei.ArtifactSpec.Name;

const artifactId = (familyId: string, tier: number, rarity: number) => {
  const option = artifactOptions.find(a => a.familyId === familyId && a.tier === tier && a.rarity === rarity);
  if (!option) throw new Error(`no artifact ${familyId} T${tier} rarity ${rarity}`);
  return option.id;
};
const stoneId = (familyId: string, tier: number) => {
  const option = stoneOptions.find(s => s.familyId === familyId && s.tier === tier);
  if (!option) throw new Error(`no stone ${familyId} T${tier}`);
  return option.id;
};

/** The same slot through lib/artifacts/effects.ts, the rule artifact-sandbox's checkbox shows. */
function libSet(afxId: Name, level: number, rarity: number, stones: { afxId: Name; level: number }[]) {
  const spec = { name: afxId, level, rarity };
  const stoneSpecs = stones.map(s => ({ name: s.afxId, level: s.level, rarity: 0 }));
  return new ArtifactSet([{ spec, stones: stoneSpecs }], true);
}

describe('artifacts on an enlightenment farm', () => {
  const necklace = artifactId('demeters-necklace', 4, 3);
  const t4Clarity = stoneId('clarity-stone', 4);
  const t4Shell = stoneId('shell-stone', 4);

  test('an artifact without clarity stones does nothing, nor do its other stones', () => {
    const mods = calculateArtifactModifiers([{ artifactId: necklace, stones: [t4Shell, t4Shell, null] }]);
    expect(mods.eggValue.totalMultiplier).toBe(1);
    expect(mods.eggValue.effects).toEqual([]);
  });

  test('clarity stones stack, and scale the artifact and its other stones', () => {
    const slot = { artifactId: necklace, stones: [t4Clarity, t4Clarity, t4Shell] };
    const clarity = clarityMultiplier(slot);
    const artifact = artifactOptions.find(a => a.id === necklace)!;
    const shell = stoneOptions.find(s => s.id === t4Shell)!;
    const clarityStone = stoneOptions.find(s => s.id === t4Clarity)!;
    expect(clarity).toBeCloseTo(clarityStone.effectDelta * 2, 10);
    expect(calculateArtifactModifiers([slot]).eggValue.totalMultiplier).toBeCloseTo(
      (1 + artifact.effectDelta * clarity) * (1 + shell.effectDelta * clarity),
      10
    );
  });

  test('Light of Eggendil works in full without a clarity stone', () => {
    const light = artifactOptions.find(a => a.id === artifactId('light-of-eggendil', 4, 3))!;
    const mods = calculateArtifactModifiers([{ artifactId: light.id, stones: [] }]);
    expect(mods.eggValue.totalMultiplier).toBeCloseTo(1 + light.effectDelta, 10);
  });

  test('soul and prophecy effects add to the per-egg bonuses', () => {
    const book = artifactOptions.find(a => a.id === artifactId('book-of-basan', 4, 3))!;
    const soul = stoneOptions.find(s => s.id === stoneId('soul-stone', 4))!;
    const clarityStone = stoneOptions.find(s => s.id === t4Clarity)!;
    const mods = calculateArtifactModifiers([{ artifactId: book.id, stones: [t4Clarity, soul.id] }]);
    expect(mods.prophecyEggBonus.totalMultiplier).toBeCloseTo(book.effectDelta * clarityStone.effectDelta, 10);
    expect(mods.soulEggBonus.totalMultiplier).toBeCloseTo(soul.effectDelta * clarityStone.effectDelta, 10);
  });

  test('matches the library artifact-sandbox is built on', () => {
    const tier = allPossibleTiers.find(t => t.family.id === 'demeters-necklace' && t.tier_number === 4)!;
    const clarityTier = allPossibleTiers.find(t => t.family.id === 'clarity-stone' && t.tier_number === 4)!;
    const shellTier = allPossibleTiers.find(t => t.family.id === 'shell-stone' && t.tier_number === 4)!;
    const set = libSet(tier.afx_id, tier.afx_level, 3, [
      { afxId: clarityTier.afx_id, level: clarityTier.afx_level },
      { afxId: clarityTier.afx_id, level: clarityTier.afx_level },
      { afxId: shellTier.afx_id, level: shellTier.afx_level },
    ]);
    const mods = calculateArtifactModifiers([{ artifactId: necklace, stones: [t4Clarity, t4Clarity, t4Shell] }]);
    expect(mods.eggValue.totalMultiplier).toBeCloseTo(set.eggValueMultiplier, 8);
  });
});
