// The mission-plan pipeline: option filtering, objective evaluation, and the assembly of a renderable
// solution around whatever plan the planner (`./solver/`) returned. See OPTIMIZER.md for the objective.

import type { CraftBudget, LaunchOption, LaunchSolution, OptimizerSolution, RecipeDAG, SlotSummary } from './types';
import { ei } from 'lib';
import { alphaToProb, compileJointInnerLp, JointInnerLp, refineJointCraftSplit } from './value-function';
import { NUM_SLOTS, packWitness } from './packing';
import { loadHighs } from './solver/highs';
import { Q_CERTAIN_PROXY } from './solver/milp';
import { solveWith } from './solver/oa';
import type { PlanProblem } from './solver/types';

// Anything under this is zero: durations, fuel, score differences.
const ZERO_TOL = 1e-9;

export interface OptimizeArgs {
  options: LaunchOption[];
  recipeDag: RecipeDAG;
  desiredArtifactNodeIds: string[];
  fuelCapacity: number;
  timeCapacityPerSlot: number;
  maximumCost: number | undefined;
  baseYield: Map<string, number>;
  // Golden egg cap on the plan's crafts, or absent for no cap. It has to reach both the MILP and the inner
  // LPs, or the cap does not bind on the craft counts the card actually prints.
  craftBudget?: CraftBudget;
}

interface Assembly {
  options: LaunchOption[];
  recipeDag: RecipeDAG;
  targets: string[];
  baseYield: Map<string, number>;
  QByTarget: Map<string, number>;
  innerLp: JointInnerLp;
  craftBudget?: CraftBudget;
}

function qByTarget(recipeDag: RecipeDAG, targets: string[]): Map<string, number> {
  const QByTarget = new Map<string, number>();
  for (const t of targets) {
    const pCraft = recipeDag.get(t)?.legendaryCraftProbability ?? 0;
    // Q = -log(1 - p) is +Infinity at certainty, which no LP matrix can carry. Same proxy the MILP steers by,
    // so the two matrices agree on what a certain craft is worth; see SPEC.md section 4.
    QByTarget.set(t, pCraft <= 0 ? 0 : pCraft >= 1 ? Q_CERTAIN_PROXY : -Math.log(1 - pCraft));
  }
  return QByTarget;
}

// Per-slot occupancy of a chosen allocation. Repacked here because the seam the MILP returns through carries
// only totals; if the exact packer cannot place the plan, the makespan shown is a best-fit estimate, not a claim.
function slotsOfAllocation(options: LaunchOption[], alloc: Map<number, number>, capacity: number): SlotSummary[] {
  const idx = [...alloc.keys()].filter(i => (alloc.get(i) ?? 0) > 0);
  if (idx.length === 0) return [];

  const durations = idx.map(i => options[i].actualTime);
  const counts = idx.map(i => alloc.get(i) ?? 0);
  const witness = packWitness(durations, counts, capacity);

  const load = new Array<number>(NUM_SLOTS).fill(0);
  const rawLoad = new Array<number>(NUM_SLOTS).fill(0);
  const count = new Array<number>(NUM_SLOTS).fill(0);

  const place = (j: number, slot: number) => {
    load[slot] += durations[j];
    rawLoad[slot] += options[idx[j]].rawTime;
    count[slot] += 1;
  };

  if (witness) {
    for (let j = 0; j < idx.length; j++) for (const slot of witness[j]) place(j, slot);
  } else {
    // No witness (provably unpackable, or the node budget ran out). Longest first into the emptiest slot, so
    // the summary still describes a real arrangement of these missions even where it overfills.
    const order = idx.map((_, j) => j).sort((a, b) => durations[b] - durations[a]);
    for (const j of order) {
      for (let k = 0; k < counts[j]; k++) {
        let slot = 0;
        for (let b = 1; b < NUM_SLOTS; b++) if (load[b] < load[slot]) slot = b;
        place(j, slot);
      }
    }
  }

  return load.map((seconds, b) => ({
    loadSeconds: seconds,
    rawLoadSeconds: rawLoad[b],
    missionCount: count[b],
  }));
}

// The whole plan, start to finish. Async because the solver is a WebAssembly module instantiated once;
// every call after the first resolves off a cached promise.
export async function optimizeFull(args: OptimizeArgs): Promise<OptimizerSolution> {
  const {
    options,
    recipeDag,
    desiredArtifactNodeIds,
    fuelCapacity: rawR,
    timeCapacityPerSlot: rawS,
    maximumCost,
    baseYield,
    craftBudget,
  } = args;

  // Rejected here rather than downstream: `model.ts` and `value-function.ts` both drop a budget
  // they cannot turn into a row, so a negative or NaN capacity would silently become *no* cap —
  // the one reading a caller who asked for a cap can least afford. `capacity === 0` is a valid
  // binding cap and passes. A caller wanting no cap omits `craftBudget`.
  if (craftBudget && (!Number.isFinite(craftBudget.capacity) || craftBudget.capacity < 0)) {
    throw new Error(`craft budget capacity must be finite and non-negative, got ${craftBudget.capacity}`);
  }

  // An empty input field upstream arrives as NaN; clamp before it reaches the
  // model, where a NaN budget would make every row unsatisfiable.
  const R = Number.isFinite(rawR) && rawR > 0 ? rawR : 0;
  const S = Number.isFinite(rawS) && rawS > 0 ? rawS : 0;

  // Dropped before indices are assigned, so an allocation index means the same thing here and inside the solver.
  // Fuel is bounded from above only — a zero-fuel mission is legitimate — and `actualFuel <= R` is what still
  // holds a NaN fuel budget to the zero-fuel missions.
  const feasibleOptions = options.filter(
    o =>
      ZERO_TOL < o.actualTime &&
      o.actualTime <= S &&
      o.actualFuel <= R &&
      (maximumCost === undefined || o.cost <= maximumCost)
  );

  const QByTarget = qByTarget(recipeDag, desiredArtifactNodeIds);
  const assembly: Assembly = {
    options: feasibleOptions,
    recipeDag,
    targets: desiredArtifactNodeIds,
    baseYield,
    QByTarget,
    innerLp: compileJointInnerLp(recipeDag, desiredArtifactNodeIds, QByTarget, craftBudget),
    craftBudget,
  };

  const problem: PlanProblem = {
    options: feasibleOptions,
    dag: recipeDag,
    targets: desiredArtifactNodeIds,
    fuelCapacity: R,
    timeCapacityPerSlot: S,
    slots: NUM_SLOTS,
    baseYield,
    craftBudget,
  };

  const solve = await loadHighs();
  const { allocation } = solveWith(problem, solve);

  const alloc = new Map<number, number>();
  for (let i = 0; i < allocation.length; i++) {
    if (allocation[i] > 0) alloc.set(i, allocation[i]);
  }

  return assembleFullSolution(assembly, alloc, slotsOfAllocation(feasibleOptions, alloc, S));
}

function assembleFullSolution(
  a: Assembly,
  bestAlloc: Map<number, number>,
  bestSlots: SlotSummary[]
): OptimizerSolution {
  const { recipeDag, baseYield, targets } = a;
  const { finalYieldVector, totalLegendary, fuelUsed, fuelByEgg, choiceHistory } = assembleSolution(
    baseYield,
    bestAlloc,
    a.options
  );

  // wall-clock is the busiest slot's makespan; running time its raw flight time
  const busiest = bestSlots.reduce<SlotSummary | null>(
    (best, s) => (best === null || s.loadSeconds > best.loadSeconds ? s : best),
    null
  );
  const makespan = busiest?.loadSeconds ?? 0;
  const running = busiest?.rawLoadSeconds ?? 0;

  // The tangent-LP split is only a seed: reported numbers must come off the
  // exact objective, never the search's envelope. See OPTIMIZER.md.
  const seedSolve = a.innerLp.solve(finalYieldVector, totalLegendary);
  const finalSolve = refineJointCraftSplit(
    recipeDag,
    targets,
    a.QByTarget,
    finalYieldVector,
    totalLegendary,
    seedSolve,
    a.craftBudget
  );
  const perTarget = targets.map(t => {
    const craftCount =
      finalSolve.craftByTarget.get(t) ?? (recipeDag.get(t)?.isLeaf ? (finalYieldVector.get(t) ?? 0) : 0);
    const p = alphaToProb(craftCount, totalLegendary, [t], recipeDag);
    return { nodeId: t, expectedCrafts: craftCount, ...p };
  });
  const primary = perTarget[0] ?? {
    bestProbability: 0,
    craftProbability: 0,
    dropProbability: 0,
    expectedCrafts: 0,
  };

  // No targets yields 0, not the empty product's 1: nothing was asked for, so
  // nothing is achieved.
  let jointProbability = perTarget.length > 0 ? 1 : 0;
  for (const t of perTarget) jointProbability *= t.bestProbability;

  return {
    bestProbability: primary.bestProbability,
    craftProbability: primary.craftProbability,
    dropProbability: primary.dropProbability,
    expectedCrafts: primary.expectedCrafts,
    fuelUsed: fuelUsed,
    fuelByEgg: fuelByEgg,
    timeUnitsUsed: Math.round(makespan),
    runningTimeSeconds: Math.round(running),
    slots: bestSlots.length > 0 ? bestSlots : undefined,
    choiceHistory: choiceHistory,
    expectedDrops: [], // populated by index.ts
    finalYieldVector: finalYieldVector,
    baseYield: new Map(baseYield),
    recipeDag: recipeDag,
    craftPrimal: finalSolve.primalByNode,
    perTarget: perTarget,
    jointProbability,
  };
}

function assembleSolution(baseYield: Map<string, number>, bestAlloc: Map<number, number>, options: LaunchOption[]) {
  const choiceHistory: LaunchSolution[] = [];
  let fuelUsed = 0;
  const finalYieldVector = new Map<string, number>(baseYield);
  const totalLegendary = new Map<string, number>();
  const fuelByEgg = new Map<ei.Egg, number>();
  for (const [idx, k] of bestAlloc) {
    if (k <= 0) continue;
    const opt = options[idx];
    fuelUsed += k * opt.actualFuel;
    for (const [n, r] of opt.yieldVector) {
      finalYieldVector.set(n, (finalYieldVector.get(n) ?? 0) + k * r);
    }
    for (const [n, r] of opt.legendaryYieldVector) {
      totalLegendary.set(n, (totalLegendary.get(n) ?? 0) + k * r);
    }
    for (const [egg, rate] of opt.fuelByEgg) {
      fuelByEgg.set(egg, (fuelByEgg.get(egg) ?? 0) + k * rate);
    }
    choiceHistory.push({
      ship: opt.ship,
      actualFuel: opt.actualFuel,
      actualFuelByEgg: opt.fuelByEgg,
      actualTime: opt.actualTime,
      target: opt.target ?? '',
      targetAfxId: opt.targetAfxId,
      numShipsLaunched: k,
      supplyVector: opt.supplyVector,
      legendarySupplyVector: opt.legendaryYieldVector,
    });
  }
  return { finalYieldVector, totalLegendary, fuelUsed, fuelByEgg, choiceHistory };
}
