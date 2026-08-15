// Golden egg pricing of a plan's craft chain. The price curve comes straight from lib, so this module only
// decides how many crafts of each node to price, and from which starting craft index.

import type { CraftingPriceParams, Inventory } from 'lib';
import { getArtifactTierPropsFromId, singleCraftCost } from 'lib';
import { ts } from '@/utils';
import type { CraftChainMetrics, RecipeTreeNode } from './optimizer-tree';
import type { OptimizerSolution, RecipeDAG } from './types';

export function craftingPriceParamsOf(nodeId: string): CraftingPriceParams | null {
  return getArtifactTierPropsFromId(nodeId).recipe?.crafting_price ?? null;
}

// How many times the player has already crafted this item; the price curve is indexed by that.
export function previousCraftsOf(playerInventory: Inventory | null | undefined, nodeId: string): number {
  if (!playerInventory) return 0;
  const props = getArtifactTierPropsFromId(nodeId);
  return playerInventory.getItem({ name: props.afx_id, level: props.afx_level }).crafted;
}

// Every craft charged at the player's *next* craft price — deliberately the same linear price
// `computeCraftUnitPrices` writes into the golden egg budget row, so the number the card reports is the number
// the plan was chosen under. Linear in `crafts`, which is what makes it meaningful on fractional LP counts.
export function fractionalCraftCost(params: CraftingPriceParams, previousCrafts: number, crafts: number): number {
  if (!Number.isFinite(crafts) || crafts <= 0) return 0;
  return crafts * singleCraftCost(params, previousCrafts);
}

export function craftCostOf(nodeId: string, crafts: number, playerInventory: Inventory | null | undefined): number {
  const params = craftingPriceParamsOf(nodeId);
  if (!params) return 0;
  return fractionalCraftCost(params, previousCraftsOf(playerInventory, nodeId), crafts);
}

// Linear per-craft prices for the golden egg budget row. The curve decreases in the craft index, so charging
// every craft at the player's next (dearest) one can only over-state the bill — the direction a hard cap must err in.
export function computeCraftUnitPrices(
  recipeDag: RecipeDAG,
  playerInventory: Inventory | null | undefined
): Map<string, number> {
  const prices = new Map<string, number>();
  for (const [nodeId, node] of recipeDag) {
    if (node.isLeaf) continue;
    const params = craftingPriceParamsOf(nodeId);
    if (!params) continue;
    // Literally the reported bill's own pricing at one craft, rather than a second spelling of it.
    prices.set(nodeId, fractionalCraftCost(params, previousCraftsOf(playerInventory, nodeId), 1));
  }
  return prices;
}

// Golden eggs are whole in game; fractional crafts are the only reason these
// aren't integers, and a rounded number is what a player can act on.
export function formatGoldenEggs(cost: number): string {
  return ts(Math.round(cost));
}

// A node can occur many times in the rendered tree (duplicates carry the same
// metrics), so dedupe by nodeId or the subtotal double-counts.
export function sumCraftChainCost(tree: RecipeTreeNode<CraftChainMetrics> | null): number {
  const seen = new Map<string, number>();
  const walk = (node: RecipeTreeNode<CraftChainMetrics>) => {
    if (!seen.has(node.nodeId)) seen.set(node.nodeId, node.metrics.goldenEggCost);
    node.children.forEach(walk);
  };
  if (tree) walk(tree);
  let total = 0;
  for (const cost of seen.values()) total += cost;
  return total;
}

export interface PlanCost {
  total: number;
  byNode: Map<string, number>; // priced nodes only
}

// Plan-wide cost, priced off the unscaled `craftPrimal`: the craft pool is shared across targets, so this is
// the single bill for the whole plan, not a sum of per-target shares.
export function computePlanCraftingCost(
  solution: OptimizerSolution,
  playerInventory: Inventory | null | undefined
): PlanCost {
  const byNode = new Map<string, number>();
  let total = 0;
  for (const [nodeId, crafts] of solution.craftPrimal) {
    const cost = craftCostOf(nodeId, crafts, playerInventory);
    if (cost <= 0) continue;
    byNode.set(nodeId, cost);
    total += cost;
  }
  return { total, byNode };
}
