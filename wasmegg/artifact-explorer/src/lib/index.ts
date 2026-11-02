export * from './artifacts';
export * from './missions';
export * from './loot';
export * from './optimizer-views';
export * from './optimizer-tree';
export * from './optimizer-cost';
export * from './tank-ids';

import type { DAGNode, LaunchSolution, OptimizerSolution, DropRow, RecipeDAG } from './types';
import { generateRecipeDag } from './problem-inputs';
import { ei, getArtifactTierPropsFromId, getCraftingInfoFromLevel, iconURL, Inventory, InventoryItem } from 'lib';

// An undefined previousCraftsOverride means "read each target's own crafted
// count from the save"; a defined one applies to every target.
export function buildRecipeDag(
  desiredArtifactNodeIds: string[],
  playerLevel: number,
  playerInventory?: Inventory | null,
  previousCraftsOverride?: number
): Map<string, DAGNode> {
  const recipeDag = new Map<string, DAGNode>();

  for (const artifact of desiredArtifactNodeIds) {
    generateRecipeDag(artifact, recipeDag);
    const artifactProps = getArtifactTierPropsFromId(artifact);
    const artifactItem = new InventoryItem(artifactProps.afx_id, artifactProps.afx_level);
    const artifactDagNode = recipeDag.get(artifact)!;
    const previousCrafts =
      previousCraftsOverride !== undefined
        ? previousCraftsOverride
        : playerInventory
          ? playerInventory.getItem({ name: artifactProps.afx_id, level: artifactProps.afx_level }).crafted
          : 0;

    // craftChance returns a percentage value, not a raw probability
    artifactDagNode.legendaryCraftProbability =
      artifactItem.craftChance(
        getCraftingInfoFromLevel(playerLevel).rarityMult,
        ei.ArtifactSpec.Rarity.LEGENDARY,
        previousCrafts
      ) / 100.0;
  }

  return recipeDag;
}

// Counted across all rarities: this is "copies you can feed a recipe", never
// "you already own a legendary". See OPTIMIZER.md.
export function computeOwnedStock(
  playerInventory: Inventory | null | undefined,
  desiredArtifactNodeIds: string[],
  recipeDag: Map<string, DAGNode>
) {
  const ownedStock = new Map<string, number>();

  if (playerInventory) {
    // Must match `solver/model.ts`'s item relation exactly: the same nodes get a conservation row.
    const hasParent = new Set<string>();
    for (const node of recipeDag.values()) {
      if (node.isLeaf) continue;
      for (const child of node.children) hasParent.add(child.nodeId);
    }
    const unconsumedTargets = new Set(desiredArtifactNodeIds.filter(id => !hasParent.has(id)));

    for (const nodeId of recipeDag.keys()) {
      if (unconsumedTargets.has(nodeId)) continue;
      const props = getArtifactTierPropsFromId(nodeId);
      const item = playerInventory.getItem({ name: props.afx_id, level: props.afx_level });
      const total = item.have;
      if (total > 0) ownedStock.set(nodeId, total);
    }
  }

  return ownedStock;
}

function computeExpectedDrops(solution: OptimizerSolution, dag: Map<string, DAGNode>): DropRow[] {
  const totals = new Map<string, number>();

  for (const choice of solution.choiceHistory) {
    for (const [item, rate] of choice.supplyVector) {
      totals.set(item, (totals.get(item) ?? 0) + rate * choice.numShipsLaunched);
    }
  }

  const rows: DropRow[] = [];
  for (const [itemId, expected] of totals) {
    if (expected < 0.05) continue;
    const props = getArtifactTierPropsFromId(itemId);
    rows.push({
      itemId,
      name: props.name,
      iconUrl: iconURL('egginc/' + props.icon_filename, 64),
      expected,
      relevant: dag.has(itemId),
    });
  }
  rows.sort((a, b) => {
    if (a.relevant !== b.relevant) return a.relevant ? -1 : 1;
    return b.expected - a.expected;
  });
  return rows;
}

function computeFuelByEgg(solution: OptimizerSolution): Map<ei.Egg, number> {
  const totals = new Map();

  for (const choice of solution.choiceHistory) {
    for (const [egg, rate] of choice.actualFuelByEgg) {
      totals.set(egg, (totals.get(egg) ?? 0) + rate * choice.numShipsLaunched);
    }
  }

  return totals;
}

// Presentation-only fields, applied on the main thread after the worker returns. `optimize` in
// `tests/unit/spec-helpers.ts` calls this too, so the in-process path and the worker path produce
// identical solutions.
export function finalizeSolutions(solutions: OptimizerSolution[], dag: RecipeDAG): OptimizerSolution[] {
  for (const solution of solutions) {
    solution.choiceHistory.sort((a: LaunchSolution, b: LaunchSolution) => a.ship.shipType - b.ship.shipType);
    solution.expectedDrops = computeExpectedDrops(solution, dag);
    solution.fuelByEgg = computeFuelByEgg(solution);
  }
  return solutions;
}

export type {
  CraftBudget,
  OptimizerConfig,
  OptimizerSolution,
  LaunchOption,
  LaunchSolution,
  DropRow,
  DAGNode,
  DAGChildRef,
  RecipeDAG,
} from './types';
