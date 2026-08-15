// Shared fixtures for the optimizer specs, plus the in-process planner entry point the pipeline specs drive.
// `optimize` lives here rather than in `index.ts` to keep the solver and its Emscripten glue out of the main chunk.

import { ei, MissionType, type ShipsConfig } from 'lib';
import type { CraftBudget, DAGNode, LaunchOption, OptimizerConfig, OptimizerSolution, RecipeDAG } from './types';
import { finalizeSolutions } from './index';
import { optimizeFull } from './optimizer-core';
import { enumerateLaunchOptions } from './phases';

export function makeNode(id: string, isLeaf: boolean, children: [string, number][] = [], pCraft = 0): DAGNode {
  return {
    id,
    isLeaf,
    children: children.map(([nodeId, quantity]) => ({ nodeId, quantity })),
    legendaryCraftProbability: pCraft,
  };
}

// Real lunar totem ids, because anything resolving a node through `getArtifactTierPropsFromId` — base yields,
// craft prices, tree icons — needs ids the game actually knows.
export const lt1 = 'lunar-totem-1';
export const lt2 = 'lunar-totem-2';
export const lt3 = 'lunar-totem-3';
export const lt4 = 'lunar-totem-4';

// lt4 = 2x lt3 + 1x lt2, lt3 = 3x lt1, lt2 = 2x lt1; lt1 only drops. Both intermediates share the lt1 leaf,
// which is what makes it a DAG rather than a tree.
export function totemDag(): RecipeDAG {
  return new Map([
    [
      lt4,
      makeNode(lt4, false, [
        [lt3, 2],
        [lt2, 1],
      ]),
    ],
    [lt3, makeNode(lt3, false, [[lt1, 3]])],
    [lt2, makeNode(lt2, false, [[lt1, 2]])],
    [lt1, makeNode(lt1, true)],
  ]);
}

// The smallest DAG with something to decide: craftable root 'A' needing one leaf ingredient 'B'.
// With pCraft > 0, missions yielding B produce positive score, so the optimizer has a reason to launch.
export function craftDag(pCraft = 0.1): RecipeDAG {
  return new Map([
    ['A', makeNode('A', false, [['B', 1]], pCraft)],
    ['B', makeNode('B', true)],
  ]);
}

// The ship is irrelevant to the optimizer core (only the presentation layer
// reads it), so every fixture option flies the same one.
const fixtureShip = new MissionType(ei.MissionInfo.Spaceship.CHICKEN_ONE, ei.MissionInfo.DurationType.SHORT);

let seq = 0;

export function makeOpt(
  actualFuel: number,
  actualTime: number,
  yieldEntries: [string, number][],
  legendaryEntries: [string, number][] = [],
  targetAfxId: ei.ArtifactSpec.Name = ei.ArtifactSpec.Name.UNKNOWN
): LaunchOption {
  return {
    id: `opt-${seq++}`,
    ship: fixtureShip,
    target: null,
    targetAfxId,
    actualFuel,
    fuelByEgg: new Map(),
    actualTime,
    rawTime: actualTime,
    // Free by default, so a fixture menu survives any `maximumCost`; the specs
    // that exercise the gem cap override it per option.
    cost: 0,
    supplyVector: new Map(yieldEntries),
    yieldVector: new Map(yieldEntries),
    legendaryYieldVector: new Map(legendaryEntries),
  };
}

export async function optimize(
  config: OptimizerConfig,
  playerConfig: ShipsConfig,
  dag: RecipeDAG,
  baseYield: Map<string, number>,
  launchPeriodSeconds = 0,
  maxGemCost?: number,
  craftBudget?: CraftBudget
): Promise<OptimizerSolution> {
  const { desiredArtifactNodeIds, fuelTankCapacity, timeBudgetSeconds } = config;
  const solution = await optimizeFull({
    options: enumerateLaunchOptions(playerConfig, dag, launchPeriodSeconds),
    recipeDag: dag,
    desiredArtifactNodeIds,
    fuelCapacity: fuelTankCapacity,
    timeCapacityPerSlot: timeBudgetSeconds,
    maximumCost: maxGemCost,
    baseYield,
    craftBudget,
  });
  return finalizeSolutions([solution], dag)[0];
}

export function makeSolution(overrides: Partial<OptimizerSolution>): OptimizerSolution {
  return {
    bestProbability: 0,
    craftProbability: 0,
    dropProbability: 0,
    expectedCrafts: 0,
    fuelUsed: 0,
    fuelByEgg: new Map(),
    timeUnitsUsed: 0,
    runningTimeSeconds: 0,
    choiceHistory: [],
    expectedDrops: [],
    finalYieldVector: new Map(),
    baseYield: new Map(),
    recipeDag: new Map(),
    craftPrimal: new Map(),
    perTarget: [],
    jointProbability: 0,
    ...overrides,
  };
}
