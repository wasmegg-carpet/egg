// DAGs are hand-built over the real lunar totem tier chain, since the
// builders resolve names and icons through getArtifactTierPropsFromId.

import { describe, expect, it } from 'vitest';
import { ei, getArtifactTierPropsFromId, Inventory, singleCraftCost } from 'lib';

import {
  buildRecipeTree,
  computeCanonicalOccurrence,
  computeCraftChainTree,
  computeInventoryTree,
} from '@/lib/optimizer-tree';
import { lt1, lt2, lt3, lt4, makeNode, makeSolution, totemDag } from './spec-helpers';
import type { RecipeDAG } from '@/lib/types';

const Name = ei.ArtifactSpec.Name;
const Level = ei.ArtifactSpec.Level;
const Rarity = ei.ArtifactSpec.Rarity;

// 4 common + 1 legendary T1 totems, 2 rare T2 totems.
function totemInventory(): Inventory {
  return new Inventory({
    inventoryItems: [
      { artifact: { spec: { name: Name.LUNAR_TOTEM, level: Level.INFERIOR, rarity: Rarity.COMMON } }, quantity: 4 },
      { artifact: { spec: { name: Name.LUNAR_TOTEM, level: Level.INFERIOR, rarity: Rarity.LEGENDARY } }, quantity: 1 },
      { artifact: { spec: { name: Name.LUNAR_TOTEM, level: Level.LESSER, rarity: Rarity.RARE } }, quantity: 2 },
    ],
  });
}

// The unit price straight from lib, so the tree's cost metric is never checked against a number this file
// made up: every craft at the player's next craft price, matching the golden egg cap's own pricing.
function libCost(nodeId: string, previousCrafts: number, crafts: number): number {
  const params = getArtifactTierPropsFromId(nodeId).recipe!.crafting_price;
  return crafts * singleCraftCost(params, previousCrafts);
}

describe('computeCanonicalOccurrence', () => {
  it('records the shallowest depth and the parent it was first reached through', () => {
    const { minDepth, canonicalParent } = computeCanonicalOccurrence(lt4, totemDag());
    expect(Object.fromEntries(minDepth)).toEqual({ [lt4]: 0, [lt3]: 1, [lt2]: 1, [lt1]: 2 });
    expect(Object.fromEntries(canonicalParent)).toEqual({ [lt4]: null, [lt3]: lt4, [lt2]: lt4, [lt1]: lt3 });
  });

  it('breaks depth ties deterministically by BFS dequeue order (first parent wins)', () => {
    const { canonicalParent } = computeCanonicalOccurrence(lt4, totemDag());
    expect(canonicalParent.get(lt1)).toBe(lt3);
  });
});

describe('buildRecipeTree', () => {
  it('expands the canonical occurrence of a shared leaf and dims the duplicate, without recursing into it', () => {
    const dag = totemDag();
    const canonical = computeCanonicalOccurrence(lt4, dag);
    const tree = buildRecipeTree(lt4, dag, canonical, nodeId => ({ id: nodeId }))!;

    expect(tree.nodeId).toBe(lt4);
    expect(tree.depth).toBe(0);
    expect(tree.qtyPerParentCraft).toBe(1);
    expect(tree.isLeaf).toBe(false);
    expect(tree.isDuplicate).toBe(false);
    expect(tree.children).toHaveLength(2);

    const [lt3Node, lt2Node] = tree.children;
    expect(lt3Node.nodeId).toBe(lt3);
    expect(lt3Node.qtyPerParentCraft).toBe(2);
    expect(lt3Node.isDuplicate).toBe(false);
    expect(lt3Node.children).toHaveLength(1);
    const lt1ViaLt3 = lt3Node.children[0];
    expect(lt1ViaLt3.nodeId).toBe(lt1);
    expect(lt1ViaLt3.depth).toBe(2);
    expect(lt1ViaLt3.isLeaf).toBe(true);
    expect(lt1ViaLt3.isDuplicate).toBe(false);
    expect(lt1ViaLt3.children).toEqual([]);

    expect(lt2Node.nodeId).toBe(lt2);
    expect(lt2Node.qtyPerParentCraft).toBe(1);
    expect(lt2Node.isDuplicate).toBe(false);
    expect(lt2Node.children).toHaveLength(1);
    const lt1ViaLt2 = lt2Node.children[0];
    expect(lt1ViaLt2.nodeId).toBe(lt1);
    expect(lt1ViaLt2.depth).toBe(2);
    expect(lt1ViaLt2.isDuplicate).toBe(true);
    expect(lt1ViaLt2.children).toEqual([]);
    expect(lt1ViaLt2.metrics).toEqual(lt1ViaLt3.metrics);
  });
});

describe('computeInventoryTree', () => {
  it('still builds the tree with zero-valued metrics when there is no player inventory', () => {
    const tree = computeInventoryTree(lt4, totemDag(), null)!;
    expect(tree).not.toBeNull();
    expect(tree.metrics).toEqual({ have: 0 });
    expect(tree.children.every(c => c.metrics.have === 0)).toBe(true);
  });

  it('walks the DAG, summing owned counts across rarities, root included', () => {
    const tree = computeInventoryTree(lt4, totemDag(), totemInventory())!;
    const flat = new Map<string, { depth: number; qty: number; dup: boolean; have: number }>();
    const walk = (n: typeof tree, key: string) => {
      flat.set(key, {
        depth: n.depth,
        qty: n.qtyPerParentCraft,
        dup: n.isDuplicate,
        have: n.metrics.have,
      });
      for (const c of n.children) walk(c, `${key}>${c.nodeId}`);
    };
    walk(tree, lt4);

    // 4 common + 1 legendary T1 -> 5; 2 rare T2 -> 2; nothing at T3 or T4.
    expect([...flat.keys()]).toEqual([
      lt4,
      `${lt4}>${lt3}`,
      `${lt4}>${lt3}>${lt1}`,
      `${lt4}>${lt2}`,
      `${lt4}>${lt2}>${lt1}`,
    ]);
    expect(flat.get(lt4)).toEqual({ depth: 0, qty: 1, dup: false, have: 0 });
    expect(flat.get(`${lt4}>${lt3}`)).toEqual({ depth: 1, qty: 2, dup: false, have: 0 });
    expect(flat.get(`${lt4}>${lt2}`)).toEqual({ depth: 1, qty: 1, dup: false, have: 2 });
    expect(flat.get(`${lt4}>${lt3}>${lt1}`)).toEqual({ depth: 2, qty: 3, dup: false, have: 5 });
    // canonical occurrence is via lt3, so this one is dimmed
    expect(flat.get(`${lt4}>${lt2}>${lt1}`)).toEqual({ depth: 2, qty: 2, dup: true, have: 5 });
  });
});

describe('computeCraftChainTree', () => {
  it('breaks down owned/dropped/crafted/consumed per node, root included', () => {
    const solution = makeSolution({
      recipeDag: totemDag(),
      // 2 root crafts eat 4x lt3 + 2x lt2; 4 lt3 crafts eat 12x lt1
      craftPrimal: new Map([
        [lt4, 2],
        [lt3, 4],
      ]),
      finalYieldVector: new Map([
        [lt3, 10],
        [lt2, 1],
        [lt1, 12],
      ]),
      baseYield: new Map([
        [lt3, 3],
        [lt2, 5],
      ]),
    });
    const tree = computeCraftChainTree(solution, lt4, totemInventory())!;

    expect(tree.nodeId).toBe(lt4);
    expect(tree.depth).toBe(0);
    expect(tree.isDuplicate).toBe(false);
    // never consumed (it's the final target), never dropped/baseYield-tracked
    expect(tree.metrics).toEqual({
      owned: 0,
      dropped: 0,
      crafted: 2,
      consumed: 0,
      goldenEggCost: libCost(lt4, 0, 2),
    });

    const lt3Node = tree.children.find(c => c.nodeId === lt3)!;
    expect(lt3Node.qtyPerParentCraft).toBe(2);
    expect(lt3Node.isDuplicate).toBe(false);
    expect(lt3Node.metrics).toEqual({
      owned: 0,
      dropped: 7,
      crafted: 4,
      consumed: 4,
      goldenEggCost: libCost(lt3, 0, 4),
    });

    const lt2Node = tree.children.find(c => c.nodeId === lt2)!;
    expect(lt2Node.qtyPerParentCraft).toBe(1);
    expect(lt2Node.isDuplicate).toBe(false);
    // baseYield exceeds finalYield here; dropped clamps to 0
    // nothing crafted, so nothing billed
    expect(lt2Node.metrics).toEqual({ owned: 2, dropped: 0, crafted: 0, consumed: 2, goldenEggCost: 0 });

    const lt1ViaLt3 = lt3Node.children[0];
    expect(lt1ViaLt3.nodeId).toBe(lt1);
    expect(lt1ViaLt3.isDuplicate).toBe(false);
    // lt1 is a leaf: no recipe, no price
    expect(lt1ViaLt3.metrics).toEqual({ owned: 5, dropped: 12, crafted: 0, consumed: 12, goldenEggCost: 0 });

    const lt1ViaLt2 = lt2Node.children[0];
    expect(lt1ViaLt2.nodeId).toBe(lt1);
    expect(lt1ViaLt2.isDuplicate).toBe(true);
    expect(lt1ViaLt2.children).toEqual([]);
    expect(lt1ViaLt2.metrics).toEqual(lt1ViaLt3.metrics);
  });

  it('splits a shared component across targets in proportion to demand (multi-target)', () => {
    // The LP crafts lt1's supply once; each target's breakdown must show only
    // its demand-weighted slice, and the slices must sum back to the pool.
    const dag: RecipeDAG = new Map([
      [lt3, makeNode(lt3, false, [[lt1, 3]])],
      [lt2, makeNode(lt2, false, [[lt1, 2]])],
      [lt1, makeNode(lt1, true)],
    ]);
    const prob = { bestProbability: 0, craftProbability: 0, dropProbability: 0 };
    // demand for lt1: lt3 wants 2*3=6, lt2 wants 5*2=10, total 16.
    const solution = makeSolution({
      recipeDag: dag,
      craftPrimal: new Map([
        [lt3, 2],
        [lt2, 5],
      ]),
      finalYieldVector: new Map([[lt1, 16]]),
      perTarget: [
        { nodeId: lt3, expectedCrafts: 2, ...prob },
        { nodeId: lt2, expectedCrafts: 5, ...prob },
      ],
    });

    const lt3Tree = computeCraftChainTree(solution, lt3, null)!;
    expect(lt3Tree.metrics.crafted).toBe(2); // root target: full, never scaled
    const lt1ViaLt3 = lt3Tree.children.find(c => c.nodeId === lt1)!;
    // lt3's share of lt1 is 6/16 = 0.375
    expect(lt1ViaLt3.metrics.consumed).toBeCloseTo(6, 9);
    expect(lt1ViaLt3.metrics.dropped).toBeCloseTo(6, 9);

    const lt2Tree = computeCraftChainTree(solution, lt2, null)!;
    expect(lt2Tree.metrics.crafted).toBe(5);
    const lt1ViaLt2 = lt2Tree.children.find(c => c.nodeId === lt1)!;
    // lt2's share of lt1 is 10/16 = 0.625
    expect(lt1ViaLt2.metrics.consumed).toBeCloseTo(10, 9);
    expect(lt1ViaLt2.metrics.dropped).toBeCloseTo(10, 9);

    // The per-target slices reconstitute the pooled totals.
    expect(lt1ViaLt3.metrics.consumed + lt1ViaLt2.metrics.consumed).toBeCloseTo(16, 9);
    expect(lt1ViaLt3.metrics.dropped + lt1ViaLt2.metrics.dropped).toBeCloseTo(16, 9);
  });

  it('splits owned stock by the same share, so the coverage check stays consistent', () => {
    // Owned stock is scaled too: leaving it whole would let both targets claim
    // all 5 lt1 and read as covered under each.
    const dag: RecipeDAG = new Map([
      [lt3, makeNode(lt3, false, [[lt1, 3]])],
      [lt2, makeNode(lt2, false, [[lt1, 2]])],
      [lt1, makeNode(lt1, true)],
    ]);
    const prob = { bestProbability: 0, craftProbability: 0, dropProbability: 0 };
    const solution = makeSolution({
      recipeDag: dag,
      craftPrimal: new Map([
        [lt3, 2],
        [lt2, 5],
      ]),
      perTarget: [
        { nodeId: lt3, expectedCrafts: 2, ...prob },
        { nodeId: lt2, expectedCrafts: 5, ...prob },
      ],
    });

    const ownedViaLt3 = computeCraftChainTree(solution, lt3, totemInventory())!.children.find(c => c.nodeId === lt1)!
      .metrics.owned;
    const ownedViaLt2 = computeCraftChainTree(solution, lt2, totemInventory())!.children.find(c => c.nodeId === lt1)!
      .metrics.owned;

    expect(ownedViaLt3).toBeCloseTo(5 * (6 / 16), 9);
    expect(ownedViaLt2).toBeCloseTo(5 * (10 / 16), 9);
    expect(ownedViaLt3 + ownedViaLt2).toBeCloseTo(5, 9);
  });

  it('partitions a target that is also an ingredient of another target', () => {
    // lt3 is selected *and* consumed by lt4. Its pooled crafts and its bill have to split
    // between the two trees: giving lt3's own tree the whole pool and lt4's tree a demand
    // share of it again put the craft-chain subtotals past the plan's real crafting cost.
    const dag: RecipeDAG = new Map([
      [lt4, makeNode(lt4, false, [[lt3, 2]])],
      [lt3, makeNode(lt3, false, [[lt1, 3]])],
      [lt1, makeNode(lt1, true)],
    ]);
    const prob = { bestProbability: 0, craftProbability: 0, dropProbability: 0 };
    // Demand for lt3: lt4 wants 3*2 = 6, lt3 wants 2 for itself, total 8.
    const solution = makeSolution({
      recipeDag: dag,
      craftPrimal: new Map([
        [lt4, 3],
        [lt3, 8],
      ]),
      perTarget: [
        { nodeId: lt4, expectedCrafts: 3, ...prob },
        { nodeId: lt3, expectedCrafts: 2, ...prob },
      ],
    });

    const lt3ViaLt4 = computeCraftChainTree(solution, lt4, null)!.children.find(c => c.nodeId === lt3)!;
    const lt3Root = computeCraftChainTree(solution, lt3, null)!;
    expect(lt3ViaLt4.metrics.crafted).toBeCloseTo(8 * (6 / 8), 9);
    expect(lt3Root.metrics.crafted).toBeCloseTo(8 * (2 / 8), 9);

    // The whole point: the two slices reconstitute the pool instead of over-drawing it, so the
    // per-tree bills sum to what the plan actually spends on lt3.
    expect(lt3ViaLt4.metrics.crafted + lt3Root.metrics.crafted).toBeCloseTo(8, 9);
    expect(lt3ViaLt4.metrics.goldenEggCost + lt3Root.metrics.goldenEggCost).toBeCloseTo(libCost(lt3, 0, 8), 9);

    // An uncontested target still keeps its own pool whole.
    expect(computeCraftChainTree(solution, lt4, null)!.metrics.crafted).toBe(3);
  });

  it('falls back to an even split when no target demands the node', () => {
    // No demand at all: attribution has no signal, so it splits evenly rather
    // than hand each tree the full pool.
    const dag: RecipeDAG = new Map([
      [lt3, makeNode(lt3, false, [[lt1, 3]])],
      [lt2, makeNode(lt2, false, [[lt1, 2]])],
      [lt1, makeNode(lt1, true)],
    ]);
    const prob = { bestProbability: 0, craftProbability: 0, dropProbability: 0 };
    const solution = makeSolution({
      recipeDag: dag,
      finalYieldVector: new Map([[lt1, 8]]),
      perTarget: [
        { nodeId: lt3, expectedCrafts: 0, ...prob },
        { nodeId: lt2, expectedCrafts: 0, ...prob },
      ],
    });

    const lt1ViaLt3 = computeCraftChainTree(solution, lt3, null)!.children.find(c => c.nodeId === lt1)!;
    const lt1ViaLt2 = computeCraftChainTree(solution, lt2, null)!.children.find(c => c.nodeId === lt1)!;
    expect(lt1ViaLt3.metrics.dropped).toBeCloseTo(4, 9);
    expect(lt1ViaLt2.metrics.dropped).toBeCloseTo(4, 9);
    expect(lt1ViaLt3.metrics.dropped + lt1ViaLt2.metrics.dropped).toBeCloseTo(8, 9);
  });

  it('reports owned as 0 without a player inventory', () => {
    const solution = makeSolution({ recipeDag: totemDag() });
    const tree = computeCraftChainTree(solution, lt4, null)!;
    expect(tree.metrics.owned).toBe(0);
    for (const child of tree.children) {
      expect(child.metrics.owned).toBe(0);
    }
  });
});

describe('every builder survives a malformed DAG', () => {
  // lt2 names an ingredient the DAG does not contain.
  const missingChild: RecipeDAG = new Map([
    [
      lt2,
      makeNode(lt2, false, [
        [lt1, 2],
        ['puzzle-cube-1', 1],
      ]),
    ],
    [lt1, makeNode(lt1, true)],
  ]);
  // lt3 and lt2 consume each other.
  const cyclic: RecipeDAG = new Map([
    [
      lt4,
      makeNode(lt4, false, [
        [lt3, 1],
        [lt2, 1],
      ]),
    ],
    [lt3, makeNode(lt3, false, [[lt2, 1]])],
    [lt2, makeNode(lt2, false, [[lt3, 1]])],
  ]);

  // Every builder that returns a tree, behind one signature.
  const builders: [string, (root: string, dag: RecipeDAG) => { children: { nodeId: string }[] } | null][] = [
    ['buildRecipeTree', (root, dag) => buildRecipeTree(root, dag, computeCanonicalOccurrence(root, dag), () => ({}))],
    ['computeInventoryTree', (root, dag) => computeInventoryTree(root, dag, totemInventory())],
    ['computeCraftChainTree', (root, dag) => computeCraftChainTree(makeSolution({ recipeDag: dag }), root, null)],
  ];

  it('computeCanonicalOccurrence ignores a missing child and terminates on a cycle', () => {
    expect(computeCanonicalOccurrence(lt2, missingChild).minDepth.has('puzzle-cube-1')).toBe(false);
    expect(Object.fromEntries(computeCanonicalOccurrence(lt4, cyclic).minDepth)).toEqual({
      [lt4]: 0,
      [lt3]: 1,
      [lt2]: 1,
    });
  });

  for (const [name, build] of builders) {
    it(`${name} returns null for a root outside the DAG`, () => {
      expect(build('puzzle-cube-1', totemDag())).toBeNull();
    });

    it(`${name} skips a child reference missing from the DAG`, () => {
      expect(build(lt2, missingChild)!.children.map(c => c.nodeId)).toEqual([lt1]);
    });

    it(`${name} terminates on a cycle between ingredients`, () => {
      expect(build(lt4, cyclic)!.children.map(c => c.nodeId)).toEqual([lt3, lt2]);
    });
  }
});
