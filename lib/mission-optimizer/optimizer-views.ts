// Flat display helpers derived from an OptimizerSolution; the recipe-tree
// builders live in optimizer-tree.ts.

import type { ei, MissionType } from '../index';
import { formatProbability } from '../index';
import type { CraftChainMetrics, RecipeTreeNode } from './optimizer-tree';
import type { OptimizerSolution, TargetProbability } from './types';

// Below 0.01% lib's formatProbability switches to "1.5×10⁻⁶%", which a player can't act on. Pair
// it with the reading they'd actually use — the same number as odds — rather than ask lib (shared
// with other pages) to grow a second notation for one caller.
export function formatProbabilityForDisplay(p: number): string {
  const text = formatProbability(p);
  if (!Number.isFinite(p) || p <= 0 || p >= 0.0001) return text;
  return `${text} (about 1 in ${Math.round(1 / p).toLocaleString('en-US')})`;
}

export interface MissionLegendaryRow {
  ship: MissionType;
  targetAfxId: ei.ArtifactSpec.Name;
  numShipsLaunched: number;
  legendaryDrops: number;
}

// One target's worth of presentation data, resolved against that target's own
// nodeId rather than the plan's primary target.
export interface TargetView {
  nodeId: string;
  name: string;
  iconUrl: string;
  perTarget: TargetProbability;
  pCraft: number;
  lambda: number;
  craftChainTree: RecipeTreeNode<CraftChainMetrics> | null;
  missionLegendarySources: MissionLegendaryRow[];
  dropDataIsSparse: boolean;
}

// Invert P(drop) = 1 - e^(-lambda); 0 outside (0, 1).
export function lambdaFromDropProbability(p: number): number {
  return p > 0 && p < 1 ? -Math.log(1 - p) : 0;
}

// One row per mission and target. A sleep-aware plan can launch the same mission both by day and overnight,
// as two entries of `choiceHistory`; where a legendary comes from does not depend on when the ship left, so
// those are one source here.
export function computeMissionLegendaryRows(solution: OptimizerSolution, rootId: string): MissionLegendaryRow[] {
  const rows = new Map<string, MissionLegendaryRow>();
  for (const choice of solution.choiceHistory) {
    const key = `${choice.ship.shipType}|${choice.ship.durationType}|${choice.targetAfxId}`;
    const legendaryDrops = choice.numShipsLaunched * (choice.legendarySupplyVector.get(rootId) ?? 0);
    const row = rows.get(key);
    if (row) {
      row.numShipsLaunched += choice.numShipsLaunched;
      row.legendaryDrops += legendaryDrops;
    } else {
      rows.set(key, {
        ship: choice.ship,
        targetAfxId: choice.targetAfxId,
        numShipsLaunched: choice.numShipsLaunched,
        legendaryDrops,
      });
    }
  }
  return [...rows.values()].filter(row => row.legendaryDrops > 0.0001);
}

export function legendaryCraftProbabilityOf(solution: OptimizerSolution, rootId: string): number {
  return solution.recipeDag.get(rootId)?.legendaryCraftProbability ?? 0;
}
