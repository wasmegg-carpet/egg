// What a player's existing stock does to a multi-target plan: which of the items they already own change
// the plan, and which cannot.

import { describe, it, expect } from 'vitest';
import { ei, Inventory } from 'lib';
import { optimizeFull } from '@/lib/optimizer-core';
import { computeBaseYield } from '@/lib';
import { lt1, lt2, lt4, makeNode, makeOpt, totemDag } from './spec-helpers';
import type { RecipeDAG } from '@/lib/types';

const Name = ei.ArtifactSpec.Name;
const Level = ei.ArtifactSpec.Level;
const Rarity = ei.ArtifactSpec.Rarity;

function totemInventory(): Inventory {
  return new Inventory({
    inventoryItems: [
      { artifact: { spec: { name: Name.LUNAR_TOTEM, level: Level.INFERIOR, rarity: Rarity.COMMON } }, quantity: 4 },
      { artifact: { spec: { name: Name.LUNAR_TOTEM, level: Level.INFERIOR, rarity: Rarity.LEGENDARY } }, quantity: 1 },
      { artifact: { spec: { name: Name.LUNAR_TOTEM, level: Level.LESSER, rarity: Rarity.RARE } }, quantity: 2 },
      { artifact: { spec: { name: Name.LUNAR_TOTEM, level: Level.GREATER, rarity: Rarity.COMMON } }, quantity: 3 },
    ],
  });
}

describe('computeBaseYield', () => {
  it('keeps a target that another target consumes, and counts every rarity of it', () => {
    const base = computeBaseYield(totemInventory(), [lt4, lt2], totemDag());
    // lt2 is an ingredient of lt4, so the owned copies are spendable there. All 2 count even though they are
    // rare: rarity is irrelevant to crafting, and this stock never feeds the legendary side of the objective.
    expect(base.get(lt2)).toBe(2);
    expect(base.get(lt1)).toBe(5);
  });

  it('drops a target nothing consumes, whose stock the LP could never spend', () => {
    const base = computeBaseYield(totemInventory(), [lt4, lt2], totemDag());
    expect(base.has(lt4)).toBe(false);
  });

  it('is unchanged from the single-target rule when there is one target', () => {
    // The lone target of a tier chain is never its own descendant, so "skip
    // every target" and "skip unconsumed targets" agree exactly at n=1.
    const base = computeBaseYield(totemInventory(), [lt4], totemDag());
    expect(Object.fromEntries(base)).toEqual({ [lt1]: 5, [lt2]: 2 });
  });
});

// A needs 2x B, B needs 2x C, C is the only thing missions drop. Both A and B
// are search targets, so B is a nested target: a target in its own right and an
// ingredient of A.
function nestedDag(): RecipeDAG {
  return new Map([
    ['A', makeNode('A', false, [['B', 2]], 0.5)],
    ['B', makeNode('B', false, [['C', 2]], 0.5)],
    ['C', makeNode('C', true)],
  ]);
}

async function runNested(baseYield: Map<string, number>, targets = ['A', 'B']) {
  return await optimizeFull({
    options: [makeOpt(1, 10, [['C', 1]], [], Name.TUNGSTEN_ANKH)],
    recipeDag: nestedDag(),
    desiredArtifactNodeIds: targets,
    fuelCapacity: 1000,
    timeCapacityPerSlot: 100, // per slot, so C arrives at a fixed rate the tests read back
    baseYield,
    maximumCost: Infinity,
  });
}

describe('owned copies of a target', () => {
  it('leave a top-level target untouched', async () => {
    // Nothing consumes A, so its stock has no conservation row to relax and
    // dropping it loses nothing.
    const without = await runNested(new Map());
    const with10A = await runNested(new Map([['A', 10]]));
    expect(with10A.bestProbability).toBeCloseTo(without.bestProbability, 12);
    expect(with10A.craftProbability).toBeCloseTo(without.craftProbability, 12);
    expect(with10A.dropProbability).toBeCloseTo(without.dropProbability, 12);
    expect(with10A.jointProbability).toBeCloseTo(without.jointProbability, 12);
  });

  it('raise the joint probability through the nested target, without inflating its own crafts', async () => {
    const without = await runNested(new Map());
    const with4B = await runNested(new Map([['B', 4]]));
    expect(with4B.jointProbability).toBeGreaterThan(without.jointProbability);

    // Owned B enters its row only on the consumption side: it lets A craft
    // more without raising B's own craft count.
    const nested = with4B.perTarget.find(t => t.nodeId === 'B')!;
    const baseline = without.perTarget.find(t => t.nodeId === 'B')!;
    expect(nested.expectedCrafts).toBeLessThanOrEqual(with4B.finalYieldVector.get('C')! / 2 + 1e-9);
    expect(nested.expectedCrafts).toBeCloseTo(baseline.expectedCrafts, 9);
    expect(nested.craftProbability).toBeLessThanOrEqual(baseline.craftProbability + 1e-9);

    // The gain lands entirely on the parent, one extra A per 2 owned B.
    const parent = with4B.perTarget.find(t => t.nodeId === 'A')!;
    expect(parent.expectedCrafts).toBeCloseTo(without.perTarget.find(t => t.nodeId === 'A')!.expectedCrafts + 2, 9);
  });

  it('never reads as an owned legendary: dropProbability ignores baseYield', async () => {
    // dropProbability is built from the mission legendary vectors alone, and
    // this option drops none, so stocking every node still leaves it at 0.
    const stocked = await runNested(
      new Map([
        ['A', 10],
        ['B', 10],
        ['C', 10],
      ])
    );
    expect(stocked.dropProbability).toBe(0);
    for (const t of stocked.perTarget) expect(t.dropProbability).toBe(0);
  });
});

describe('joint probability with no targets', () => {
  it('is 0, not the empty product', async () => {
    const solution = await runNested(new Map(), []);
    expect(solution.jointProbability).toBe(0);
    expect(solution.perTarget).toEqual([]);
  });
});
