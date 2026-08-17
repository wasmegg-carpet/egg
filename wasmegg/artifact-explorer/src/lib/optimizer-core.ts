// The mission-plan pipeline: option filtering, objective evaluation, and the assembly of a renderable
// solution around whatever plan the planner (`./solver/`) returned. See OPTIMIZER.md for the objective.

import type { CraftBudget, LaunchOption, LaunchSolution, OptimizerSolution, RecipeDAG, SlotSummary } from './types';
import { ei } from 'lib';
import { alphaToProb, compileJointInnerLp, JointInnerLp, refineJointCraftSplit } from './value-function';
import { loadHighs } from './solver/highs';
import { Q_CERTAIN_PROXY } from './solver/milp';
import { solveWith } from './solver/oa';
import { fuelCostOnAxis, type FuelAxis, type PlanProblem, type ScheduleRun } from './solver/types';

// Anything under this is zero: durations, fuel, score differences.
const ZERO_TOL = 1e-9;

const NUM_SLOTS = 3;

export interface OptimizeArgs {
  options: LaunchOption[];
  recipeDag: RecipeDAG;
  desiredArtifactNodeIds: string[];
  fuelCapacity: number;
  // Per-egg budgets from the player's tank. When present these replace `fuelCapacity`:
  // the plan is limited by the fuel actually stocked, egg by egg, rather than by how
  // much the tank could hold.
  fuelByEggCapacity?: Map<ei.Egg, number>;
  timeCapacityPerSlot: number;
  maximumCost: number | undefined;
  baseYield: Map<string, number>;
  // Golden egg cap on the plan's crafts, or absent for no cap. It has to reach both the MILP and the inner
  // LPs, or the cap does not bind on the craft counts the card actually prints.
  craftBudget?: CraftBudget;
  // Seconds of 2x mission capacity remaining. The caller must have enumerated `options` against this
  // same number; the window rows constrain the doubled options on the menu and cannot invent them.
  eventWindowSeconds?: number;
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

function launchOf(opt: LaunchOption, count: number): LaunchSolution {
  return {
    ship: opt.ship,
    variant: opt.variant,
    actualFuel: opt.actualFuel,
    actualFuelByEgg: opt.fuelByEgg,
    actualTime: opt.actualTime,
    target: opt.target ?? '',
    targetAfxId: opt.targetAfxId,
    numShipsLaunched: count,
    supplyVector: opt.supplyVector,
    legendarySupplyVector: opt.legendaryYieldVector,
  };
}

function slotsOfSchedule(options: LaunchOption[], schedule: readonly ScheduleRun[][]): SlotSummary[] {
  return schedule.map(runs => {
    let loadSeconds = 0;
    let rawLoadSeconds = 0;
    let missionCount = 0;
    const launches: LaunchSolution[] = [];
    for (const run of runs) {
      const opt = options[run.option];
      if (opt === undefined || !(run.count > 0)) continue;
      loadSeconds += run.count * opt.actualTime;
      rawLoadSeconds += run.count * opt.rawTime;
      missionCount += run.count;
      launches.push(launchOf(opt, run.count));
    }
    return { loadSeconds, rawLoadSeconds, missionCount, runs: launches };
  });
}

// Plan-wide counts per option, folded in ascending option order so no total depends on which slot the
// solver happened to put a launch in.
function totalsOfSchedule(schedule: readonly ScheduleRun[][], optionCount: number): Map<number, number> {
  const byOption = new Array<number>(optionCount).fill(0);
  for (const runs of schedule) {
    for (const run of runs) {
      if (run.option >= 0 && run.option < optionCount && run.count > 0) byOption[run.option] += run.count;
    }
  }
  const totals = new Map<number, number>();
  for (let i = 0; i < optionCount; i++) if (byOption[i] > 0) totals.set(i, byOption[i]);
  return totals;
}

// The whole plan, start to finish. Async because the solver is a WebAssembly module instantiated once;
// every call after the first resolves off a cached promise.
export async function optimizeFull(args: OptimizeArgs): Promise<OptimizerSolution> {
  const {
    options,
    recipeDag,
    desiredArtifactNodeIds,
    fuelCapacity: rawR,
    fuelByEggCapacity,
    timeCapacityPerSlot: rawS,
    maximumCost,
    baseYield,
    craftBudget,
    eventWindowSeconds,
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

  // A per-egg budget replaces the tank entirely: the egg amounts already sum to no more
  // than the tank holds, so an aggregate row on top of them would be redundant.
  const axes: FuelAxis[] =
    fuelByEggCapacity === undefined
      ? [{ egg: null, capacity: R }]
      : [...fuelByEggCapacity].map(([egg, capacity]) => ({
          egg,
          capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : 0,
        }));

  // Dropped before indices are assigned, so an allocation index means the same thing here and inside the solver.
  // Fuel is bounded from above only — a zero-fuel mission is legitimate — and the per-axis bound is what still
  // holds a NaN fuel budget to the zero-fuel missions. It is also what keeps an egg the player has *none* of
  // from reading as free downstream, where a zero capacity means "ignore this axis".
  const feasibleOptions = options.filter(
    o =>
      ZERO_TOL < o.actualTime &&
      o.actualTime <= S &&
      axes.every(ax => fuelCostOnAxis(o, ax) <= ax.capacity) &&
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
    fuelAxes: axes,
    timeCapacityPerSlot: S,
    slots: NUM_SLOTS,
    baseYield,
    craftBudget,
    eventWindowSeconds,
  };

  const solve = await loadHighs();
  const { schedule } = solveWith(problem, solve);

  return assembleFullSolution(
    assembly,
    totalsOfSchedule(schedule, feasibleOptions.length),
    slotsOfSchedule(feasibleOptions, schedule),
    eventWindowSeconds ?? 0
  );
}

function assembleFullSolution(
  a: Assembly,
  bestAlloc: Map<number, number>,
  bestSlots: SlotSummary[],
  eventWindowSeconds: number
): OptimizerSolution {
  const { recipeDag, baseYield, targets } = a;
  const { finalYieldVector, totalLegendary, fuelUsed, fuelByEgg } = assembleSolution(baseYield, bestAlloc, a.options);

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
    slots: bestSlots,
    eventWindowSeconds,
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
  }
  return { finalYieldVector, totalLegendary, fuelUsed, fuelByEgg };
}
