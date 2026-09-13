// `cmpArtifactTiers` and `cmpArtifacts` both run at import time, to build `artifactTiers` and
// `artifacts`. Anything that imports this module therefore executes every line of both comparators
// before a single test runs, which makes the coverage report say they are covered while nothing has
// ever looked at the order that came out. Every branch in them can be inverted, or made to return
// zero, without another spec in the suite noticing.

import { describe, expect, it } from 'vitest';
import { ei } from 'lib';

import { artifacts, artifactTiers, cmpArtifacts, cmpArtifactTiers, newArtifact } from '@/lib/artifacts';

const Rarity = ei.ArtifactSpec.Rarity;

const familyKeys = [...new Set(artifactTiers.map(t => t.family.sort_key))].sort((a, b) => a - b);
const inFamily = (sortKey: number) => artifactTiers.filter(t => t.family.sort_key === sortKey);

describe('cmpArtifactTiers', () => {
  it('ranks the family ahead of the tier number', () => {
    // The last tier of the first family against the first tier of the second. A comparator that
    // consulted `tier_number` before `family.sort_key` would order exactly this pair the other way,
    // and any pair drawn from the same tier position would not tell the two apart.
    const lateInEarlyFamily = inFamily(familyKeys[0]).at(-1)!;
    const earlyInLateFamily = inFamily(familyKeys[1])[0];
    expect(lateInEarlyFamily.tier_number).toBeGreaterThan(earlyInLateFamily.tier_number);

    expect(cmpArtifactTiers(lateInEarlyFamily, earlyInLateFamily)).toBe(-1);
    expect(cmpArtifactTiers(earlyInLateFamily, lateInEarlyFamily)).toBe(1);
  });

  it('ranks by tier number within one family', () => {
    const tiers = inFamily(familyKeys[0]);
    const low = tiers[0];
    const high = tiers.at(-1)!;
    expect(low.tier_number).toBeLessThan(high.tier_number);

    expect(cmpArtifactTiers(low, high)).toBe(-1);
    expect(cmpArtifactTiers(high, low)).toBe(1);
  });

  it('calls a tier equal to itself', () => {
    // A comparator that never returns zero makes `sort` order-dependent and `cmpArtifacts` skip
    // rarity entirely, since it only consults rarity on a tier tie.
    for (const tier of artifactTiers) {
      expect(cmpArtifactTiers(tier, tier)).toBe(0);
    }
  });

  it('is antisymmetric over every pair of tiers that exists', () => {
    // 133 tiers, so 8778 pairs: cheap enough to check exhaustively rather than sample. A
    // comparator that answers "greater" in both directions still sorts to *something*, which is
    // why the sorted arrays below cannot catch this on their own.
    const violations: string[] = [];
    for (let i = 0; i < artifactTiers.length; i++) {
      for (let j = i + 1; j < artifactTiers.length; j++) {
        const forward = cmpArtifactTiers(artifactTiers[i], artifactTiers[j]);
        const backward = cmpArtifactTiers(artifactTiers[j], artifactTiers[i]);
        if (forward + backward !== 0 || forward === 0) {
          violations.push(`${artifactTiers[i].name} vs ${artifactTiers[j].name}: ${forward} / ${backward}`);
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
  });
});

describe('cmpArtifacts', () => {
  const tiers = inFamily(familyKeys[0]);

  it('breaks a tier tie on rarity, commonest first', () => {
    const common = newArtifact(tiers[0], Rarity.COMMON);
    const epic = newArtifact(tiers[0], Rarity.EPIC);

    expect(cmpArtifacts(common, epic)).toBeLessThan(0);
    expect(cmpArtifacts(epic, common)).toBeGreaterThan(0);
    expect(cmpArtifacts(common, common)).toBe(0);
  });

  it('never lets rarity outrank the tier order', () => {
    // A legendary of the lowest tier still sorts before a common of the highest: rarity is the
    // last key, not a bonus added to the others.
    const legendaryLow = newArtifact(tiers[0], Rarity.LEGENDARY);
    const commonHigh = newArtifact(tiers.at(-1)!, Rarity.COMMON);

    expect(cmpArtifacts(legendaryLow, commonHigh)).toBe(-1);
    expect(cmpArtifacts(commonHigh, legendaryLow)).toBe(1);
  });
});

describe('the catalogues sorted at import time', () => {
  // Both checks restate the ordering rule rather than calling the comparator: asking the
  // comparator whether its own output is sorted passes for any consistent comparator, including
  // one sorting backwards.
  it('leaves artifactTiers in (family, tier) order', () => {
    const outOfOrder: string[] = [];
    for (let i = 1; i < artifactTiers.length; i++) {
      const prev = artifactTiers[i - 1];
      const next = artifactTiers[i];
      const ordered =
        prev.family.sort_key < next.family.sort_key ||
        (prev.family.sort_key === next.family.sort_key && prev.tier_number <= next.tier_number);
      if (!ordered) outOfOrder.push(`${prev.name} before ${next.name}`);
    }
    expect(outOfOrder.slice(0, 5)).toEqual([]);
    expect(artifactTiers.map(t => t.name).slice(0, 4)).toEqual([
      'Ancient puzzle cube',
      'Puzzle cube',
      'Mystical puzzle cube',
      'Unsolvable puzzle cube',
    ]);
  });

  it('leaves artifacts in (family, tier, rarity) order', () => {
    const outOfOrder: string[] = [];
    for (let i = 1; i < artifacts.length; i++) {
      const prev = artifacts[i - 1];
      const next = artifacts[i];
      const key = (a: (typeof artifacts)[number]) => [a.family.sort_key, a.tier_number, a.afx_rarity];
      const [pf, pt, pr] = key(prev);
      const [nf, nt, nr] = key(next);
      const ordered = pf < nf || (pf === nf && (pt < nt || (pt === nt && pr <= nr)));
      if (!ordered) outOfOrder.push(`${prev.name}/${prev.rarity} before ${next.name}/${next.rarity}`);
    }
    expect(outOfOrder.slice(0, 5)).toEqual([]);
    // The rarity key has to actually be exercised by the data, or the check above would hold on an
    // ordering that ignored it.
    const tiedTiers = artifacts.filter(
      (a, i) =>
        i > 0 &&
        a.family.sort_key === artifacts[i - 1].family.sort_key &&
        a.tier_number === artifacts[i - 1].tier_number
    );
    expect(tiedTiers.length).toBeGreaterThan(20);
  });
});
