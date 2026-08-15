// Recipe-tree builders for the inventory and craft-chain panels. Only a node's shallowest occurrence is
// expanded; the rest render inline as duplicates, which is what keeps the tree finite over a cyclic DAG.

import type { Inventory } from 'lib';
import { getArtifactTierPropsFromId, iconURL } from 'lib';
import type { OptimizerSolution, RecipeDAG } from './types';

export interface RecipeTreeNode<M> {
  nodeId: string;
  name: string;
  iconUrl: string;
  depth: number;
  qtyPerParentCraft: number;
  isLeaf: boolean;
  isDuplicate: boolean; // true = not the canonical (shallowest) occurrence
  metrics: M;
  children: RecipeTreeNode<M>[]; // empty for leaves AND duplicate occurrences
}

export interface CanonicalOccurrence {
  // shallowest depth at which each nodeId is reached from the root
  minDepth: Map<string, number>;
  // the parent nodeId (null for the root) via which that shallowest depth was reached
  canonicalParent: Map<string, string | null>;
}

// BFS: first dequeue of a nodeId is its shallowest occurrence, ties broken by
// enqueue order.
export function computeCanonicalOccurrence(rootId: string, dag: RecipeDAG): CanonicalOccurrence {
  const minDepth = new Map<string, number>();
  const canonicalParent = new Map<string, string | null>();
  const visited = new Set<string>();
  const queue: { nodeId: string; depth: number; parentId: string | null }[] = [
    { nodeId: rootId, depth: 0, parentId: null },
  ];

  while (queue.length > 0) {
    const { nodeId, depth, parentId } = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = dag.get(nodeId);
    if (!node) continue; // matches buildRecipeTree's skip of unresolved refs

    minDepth.set(nodeId, depth);
    canonicalParent.set(nodeId, parentId);

    for (const child of node.children) {
      queue.push({ nodeId: child.nodeId, depth: depth + 1, parentId: nodeId });
    }
  }

  return { minDepth, canonicalParent };
}

// The `expanded` set, not just the canonical check, is what prevents infinite
// recursion over a cyclic DAG.
export function buildRecipeTree<M>(
  rootId: string,
  dag: RecipeDAG,
  canonical: CanonicalOccurrence,
  metricsFor: (nodeId: string) => M
): RecipeTreeNode<M> | null {
  if (!dag.has(rootId)) return null;

  const expanded = new Set<string>();

  function build(nodeId: string, depth: number, qtyPerParentCraft: number, parentId: string | null): RecipeTreeNode<M> {
    const node = dag.get(nodeId)!;
    const props = getArtifactTierPropsFromId(nodeId);
    const isCanonical =
      depth === canonical.minDepth.get(nodeId) && parentId === (canonical.canonicalParent.get(nodeId) ?? null);
    const isDuplicate = !isCanonical;

    const shouldExpand = !isDuplicate && !expanded.has(nodeId);
    if (shouldExpand) expanded.add(nodeId);

    const children: RecipeTreeNode<M>[] = shouldExpand
      ? node.children
          .filter(child => dag.has(child.nodeId))
          .map(child => build(child.nodeId, depth + 1, child.quantity, nodeId))
      : [];

    return {
      nodeId,
      name: props.name,
      iconUrl: iconURL('egginc/' + props.icon_filename, 64),
      depth,
      qtyPerParentCraft,
      isLeaf: node.isLeaf,
      isDuplicate,
      metrics: metricsFor(nodeId),
      children,
    };
  }

  return build(rootId, 0, 1, null);
}

// Owned-inventory (all rarities) tree. A null inventory still builds the tree,
// with zero-valued metrics.
export function computeInventoryTree(
  rootId: string,
  dag: RecipeDAG,
  playerInventory: Inventory | null
): RecipeTreeNode<{ have: number }> | null {
  const canonical = computeCanonicalOccurrence(rootId, dag);
  const metricsFor = (nodeId: string): { have: number } => {
    if (!playerInventory) return { have: 0 };
    const props = getArtifactTierPropsFromId(nodeId);
    const item = playerInventory.getItem({ name: props.afx_id, level: props.afx_level });
    return { have: item.haveRarity[0] + item.haveRarity[1] + item.haveRarity[2] + item.haveRarity[3] };
  };
  return buildRecipeTree(rootId, dag, canonical, metricsFor);
}

export interface CraftChainMetrics {
  owned: number;
  dropped: number;
  crafted: number;
  consumed: number;
}

// Units of each descendant consumed per craft of `nodeId`, summed over every
// recipe path. No self term.
function recursiveConsumption(
  dag: RecipeDAG,
  nodeId: string,
  memo: Map<string, Map<string, number>>
): Map<string, number> {
  const cached = memo.get(nodeId);
  if (cached) return cached;
  const out = new Map<string, number>();
  memo.set(nodeId, out);
  const node = dag.get(nodeId);
  if (node && !node.isLeaf) {
    for (const child of node.children) {
      out.set(child.nodeId, (out.get(child.nodeId) ?? 0) + child.quantity);
      for (const [x, m] of recursiveConsumption(dag, child.nodeId, memo)) {
        out.set(x, (out.get(x) ?? 0) + child.quantity * m);
      }
    }
  }
  return out;
}

// Craft-chain breakdown tree. `craftPrimal`/`finalYieldVector` are pooled across targets, so every metric
// here is scaled to this target's share of demand — the root included, since a selected target can also be
// an ingredient of another selected target. See OPTIMIZER.md.
export function computeCraftChainTree(
  solution: OptimizerSolution,
  rootId: string,
  playerInventory: Inventory | null
): RecipeTreeNode<CraftChainMetrics> | null {
  const dag = solution.recipeDag;
  if (!dag.has(rootId)) return null;

  const consumed = new Map<string, number>();
  for (const [nodeId, node] of dag) {
    if (node.isLeaf) continue;
    const crafted = solution.craftPrimal.get(nodeId) ?? 0;
    if (crafted <= 0) continue;
    for (const child of node.children) {
      consumed.set(child.nodeId, (consumed.get(child.nodeId) ?? 0) + crafted * child.quantity);
    }
  }

  const consumptionMemo = new Map<string, Map<string, number>>();
  // A target's demand for a node is what its chain consumes plus, when the node *is* that
  // target, the target's own crafts — `recursiveConsumption` has no self term. Counting the
  // self demand is what keeps the shares a partition when one selected target is an
  // ingredient of another: without it the ingredient target claimed the whole pool in its own
  // tree and the parent target claimed it again, so the two craft-chain subtotals summed past
  // `computePlanCraftingCost(...).total`.
  const demandOf = (targetId: string, targetCrafts: number, nodeId: string): number => {
    const chain = recursiveConsumption(dag, targetId, consumptionMemo).get(nodeId) ?? 0;
    return targetCrafts * (chain + (nodeId === targetId ? 1 : 0));
  };
  const totalDemand = new Map<string, number>();
  for (const target of solution.perTarget) {
    const demanded = new Set(recursiveConsumption(dag, target.nodeId, consumptionMemo).keys());
    demanded.add(target.nodeId);
    for (const x of demanded) {
      totalDemand.set(x, (totalDemand.get(x) ?? 0) + demandOf(target.nodeId, target.expectedCrafts, x));
    }
  }
  const rootCrafts = solution.perTarget.find(t => t.nodeId === rootId)?.expectedCrafts ?? 0;
  // Nothing demands the node: hand the root its own pool whole, and split anything else
  // evenly rather than hand each target all of it.
  const evenShare = solution.perTarget.length > 0 ? 1 / solution.perTarget.length : 1;
  const shareOf = (nodeId: string): number => {
    const denom = totalDemand.get(nodeId) ?? 0;
    if (denom <= 0) return nodeId === rootId ? 1 : evenShare;
    return demandOf(rootId, rootCrafts, nodeId) / denom;
  };

  const canonical = computeCanonicalOccurrence(rootId, dag);
  const metricsFor = (nodeId: string): CraftChainMetrics => {
    const props = getArtifactTierPropsFromId(nodeId);
    let ownedCount = 0;
    if (playerInventory) {
      const it = playerInventory.getItem({ name: props.afx_id, level: props.afx_level });
      ownedCount = it.haveRarity[0] + it.haveRarity[1] + it.haveRarity[2] + it.haveRarity[3];
    }
    const share = shareOf(nodeId);
    const dropped = Math.max(0, (solution.finalYieldVector.get(nodeId) ?? 0) - (solution.baseYield.get(nodeId) ?? 0));
    return {
      owned: ownedCount * share,
      dropped: dropped * share,
      crafted: (solution.craftPrimal.get(nodeId) ?? 0) * share,
      consumed: (consumed.get(nodeId) ?? 0) * share,
    };
  };

  return buildRecipeTree(rootId, dag, canonical, metricsFor);
}
