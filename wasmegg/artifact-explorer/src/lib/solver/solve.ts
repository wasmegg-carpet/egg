// The outer approximation: holds each concave g(s_T) under a fixed tangent grid so
// HiGHS sees a MILP, and returns an incumbent only once `./evaluator` certifies it.

import type { CraftSplitReport, MilpLimits, MilpSolve, PlanProblem, PlanResult } from './types';
import { EXACT_PRECISION, STEERING_PRECISION, evaluateCounts, type EvalResult } from './evaluator';
import { buildModel, type Model } from './model';
import { buildOaMilp, decodeCounts, effectiveQs, layoutOf, nCol, scaleLps, type Layout } from './milp';

export interface Tuning {
  maxNodes: number;
  // Tangent points per target, in units of theta, each in (0, 1].
  sigmaGrid: readonly number[];
}

const SIGMA_FLOOR = 1e-2;
const SIGMA_CUTS = 50;

export function logGrid(floor: number, count: number): number[] {
  // Two points is the smallest grid there is: one would divide by zero, and every NaN tangent that
  // produced would be skipped by `buildOaMilp`, leaving the objective with no cuts and every plan
  // scoring the same. `Tuning` is a caller's to set, so this is checked rather than assumed.
  if (!Number.isInteger(count) || count < 2) throw new Error(`tangent grid needs at least 2 points, got ${count}`);
  if (!(floor > 0) || floor >= 1) throw new Error(`tangent grid floor must lie in (0, 1), got ${floor}`);
  const decades = Math.log10(floor);
  return Array.from({ length: count }, (_, i) => 10 ** ((decades * i) / (count - 1)));
}

// Worst-case gap between g and its tangent envelope on such a grid, in nats.
export function envelopeErrorNats(floor: number, count: number): number {
  const decadesPerCut = Math.abs(Math.log10(floor)) / (count - 1);
  return (decadesPerCut * Math.LN10) ** 2 / 8;
}

export const DEFAULT_TUNING: Tuning = { maxNodes: 1200, sigmaGrid: logGrid(SIGMA_FLOOR, SIGMA_CUTS) };

const MIP_REL_GAP = 1e-6;

// Fuel is normalized to a budget of 1, so this is a relative slack.
const FUEL_TOL = 1e-9;
// Slack on a slot row, in seconds. Pinned to the tolerance the arena's packer
// works to, and never above it — see `fitsBudgets` below.
const SLOT_TOL = 1e-9;

function fuelExceeded(model: Model, counts: readonly number[]): boolean {
  for (let a = 0; a < model.fuelAxes.length; a++) {
    let total = 0;
    for (let g = 0; g < counts.length; g++) {
      if (counts[g] > 0) total += counts[g] * model.groups[g].fuelFractions[a];
    }
    if (total > 1 + FUEL_TOL) return true;
  }
  return false;
}

function slotLoads(model: Model, layout: Layout, columnValues: Float64Array): number[] {
  const loads = new Array<number>(model.slots).fill(0);
  for (let c = 0; c < layout.classes; c++) {
    const seconds = layout.classSeconds[c];
    for (let k = 0; k < model.slots; k++) {
      const v = columnValues[nCol(layout, c, k)];
      if (Number.isFinite(v) && v > 0) loads[k] += Math.round(v) * seconds;
    }
  }
  return loads;
}

// The craft budget is not re-checked here because no allocation can breach it: it binds on the craft
// split, which the judge re-solves for itself over a polytope carrying the same row (`evaluator.ts`,
// `craftLpOf`). See `tests/arena/ARENA.md`, "Feasibility".
function fitsBudgets(model: Model, layout: Layout, columnValues: Float64Array, counts: readonly number[]): boolean {
  if (fuelExceeded(model, counts)) return false;
  const capacity = model.timeCapacitySeconds;
  for (const load of slotLoads(model, layout, columnValues)) {
    if (load > capacity + SLOT_TOL) return false;
  }
  return true;
}

export interface SolveOptions {
  report?: boolean;
}

function emit(problem: PlanProblem, model: Model, counts: readonly number[], report: boolean): PlanResult {
  const allocation = new Array<number>(problem.options.length).fill(0);
  for (let g = 0; g < model.groups.length; g++) {
    if (counts[g] > 0) allocation[model.groups[g].members[0]] += counts[g];
  }
  if (!report) return { allocation };

  // Inside the guard the rest of the pass works under: `evaluateCounts` runs a simplex that throws on
  // an unbounded column, a lost basis or its iteration cap, and a report is the one part of the result
  // that can be dropped on its own. The allocation stands — `STEERING_PRECISION` already judged it —
  // and omitting `reported` says the figures could not be re-derived rather than inventing them.
  let finalEval: ReturnType<typeof evaluateCounts>;
  try {
    finalEval = evaluateCounts(model, counts, EXACT_PRECISION);
  } catch {
    return { allocation };
  }
  const scored = finalEval.scores.map(s => (s > 0 ? -Math.expm1(-s) : 0));
  const craftSplit = splitOf(model, finalEval.crafts);
  const perTarget = new Array<number>(scored.length);
  for (let t = 0; t < scored.length; t++) perTarget[model.requestedOrder[t]] = scored[t];
  // Folded in the model's own order, not the caller's: float multiplication is not
  // associative, so the caller's order would leak back into the reported joint.
  let jointProbability = 1;
  for (const p of scored) jointProbability *= p;
  return { allocation, reported: { jointProbability, perTarget }, craftSplit };
}

// Below this a craft is the LP's way of writing zero, and a node the plan does not craft has no
// place in a breakdown of what it crafts.
const CRAFT_EPS = 1e-9;

function splitOf(model: Model, crafts: EvalResult['crafts']): CraftSplitReport {
  const byNode = new Map<string, number>();
  for (let p = 0; p < model.craftables.length; p++) {
    if (crafts.byCraftable[p] > CRAFT_EPS) byNode.set(model.craftables[p], crafts.byCraftable[p]);
  }
  // Keyed by node id rather than position, so neither side has to know the model sorted the targets.
  // Every craftable target gets an entry, zero included: absent means "no craft column", which is
  // what sends a leaf target to its own reporting path.
  const byTarget = new Map<string, number>();
  for (let t = 0; t < model.sortedTargets.length; t++) {
    if (model.targetCraftIdx[t] >= 0) byTarget.set(model.sortedTargets[t], crafts.byTarget[t]);
  }
  return { byNode, byTarget };
}

// Returns null when no usable scale came back for some target. Two different reasons land here: the
// target cannot be scored at all, so every allocation has joint probability zero and no plan beats the
// empty one; or the LP had no finite optimum, in which case the target has no ceiling to measure sigma
// against and section 4's whole normalization is undefined. Either way there is no MILP to write.
function scales(model: Model, qs: readonly number[], solve: MilpSolve, limits: MilpLimits): number[] | null {
  const layout = layoutOf(model, 'scale');
  const scaleLp = scaleLps(model, qs);
  // Each target's LP-maximal score subject to the budgets, used as the unit for that
  // target's tangent grid.
  const theta: number[] = [];
  for (let t = 0; t < model.sortedTargets.length; t++) {
    const solution = solve(scaleLp(t), limits);
    if (solution.status !== 'optimal' && solution.status !== 'feasible') return null;
    const value = solution.columnValues[layout.scoreBase + t];
    if (!(value > 0) || !Number.isFinite(value)) return null;
    theta.push(value);
  }
  return theta;
}

export function solveWith(
  problem: PlanProblem,
  solve: MilpSolve,
  tuning: Tuning = DEFAULT_TUNING,
  { report = false }: SolveOptions = {}
): PlanResult {
  const model = buildModel(problem);
  const empty = new Array<number>(model.groups.length).fill(0);
  if (model.groups.length === 0 || model.sortedTargets.length === 0) return emit(problem, model, empty, report);

  const qs = effectiveQs(model);
  const limits: MilpLimits = { maxNodes: tuning.maxNodes, relGap: MIP_REL_GAP };
  const theta = scales(model, qs, solve, limits);
  if (!theta) return emit(problem, model, empty, report);

  const solution = solve(buildOaMilp(model, qs, theta, tuning.sigmaGrid), limits);
  // A whitelist, not a blacklist of the failures known today: only these two carry a point that is a
  // plan rather than a waypoint on a ray or a leftover from an errored solve.
  if (solution.status !== 'optimal' && solution.status !== 'feasible') return emit(problem, model, empty, report);

  const layout = layoutOf(model, 'oa');
  const counts = decodeCounts(model, layout, solution.columnValues);
  // `simplexMax` throws on an unbounded column, on a lost basis and on its iteration cap. Every
  // other failure here degrades to the empty plan, so a numerically unjudgeable incumbent does
  // too rather than taking the whole call down with it.
  let keep: boolean;
  try {
    keep =
      fitsBudgets(model, layout, solution.columnValues, counts) &&
      evaluateCounts(model, counts, STEERING_PRECISION).logJoint >
        evaluateCounts(model, empty, STEERING_PRECISION).logJoint;
  } catch {
    keep = false;
  }

  return emit(problem, model, keep ? counts : empty, report);
}
