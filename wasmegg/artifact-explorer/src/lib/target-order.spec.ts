// The pipeline must not depend on the order targets were selected in: each target's legendary craft
// probability comes from its own crafted count, not from whichever target happened to be first.

import { describe, it, expect } from 'vitest';
import { ei, Inventory } from 'lib';
import { buildRecipeDag } from '@/lib';

const Name = ei.ArtifactSpec.Name;
const Level = ei.ArtifactSpec.Level;

const FEATHER = 'phoenix-feather-4';
const CHALICE = 'the-chalice-4';

// A save with very different craft histories for the two targets.
function savedInventory(): Inventory {
  return new Inventory({
    artifactStatus: [
      { spec: { name: Name.PHOENIX_FEATHER, level: Level.GREATER }, count: 20 },
      { spec: { name: Name.THE_CHALICE, level: Level.GREATER }, count: 0 },
    ],
  });
}

function craftProbabilities(ids: string[], previousCraftsOverride?: number): Map<string, number> {
  const dag = buildRecipeDag(ids, 30, savedInventory(), previousCraftsOverride);
  return new Map(ids.map(id => [id, dag.get(id)!.legendaryCraftProbability]));
}

describe('buildRecipeDag with a save loaded', () => {
  it('gives each target its own crafted count', () => {
    const p = craftProbabilities([FEATHER, CHALICE]);
    expect(p.get(FEATHER)!).toBeGreaterThan(p.get(CHALICE)!);
  });

  it('is unaffected by the order the targets were selected in', () => {
    const forward = craftProbabilities([FEATHER, CHALICE]);
    const reversed = craftProbabilities([CHALICE, FEATHER]);
    expect(reversed.get(FEATHER)).toBe(forward.get(FEATHER));
    expect(reversed.get(CHALICE)).toBe(forward.get(CHALICE));
  });

  it('applies a manual override to every target', () => {
    const p = craftProbabilities([FEATHER, CHALICE], 20);
    expect(p.get(CHALICE)).toBe(p.get(FEATHER));
    expect(p.get(FEATHER)).toBe(craftProbabilities([FEATHER, CHALICE]).get(FEATHER));
  });
});
