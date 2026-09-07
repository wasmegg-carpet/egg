// The outer approximation: holds each concave g(s_T) under a fixed tangent grid so
// HiGHS sees a MILP, and returns an incumbent only once `./evaluator` certifies it.

import type { MilpLimits, MilpSolve, PlanProblem, PlanResult } from './types';
import { EXACT_PRECISION, STEERING_PRECISION, evaluateCounts } from './evaluator';
import { buildModel, type Model } from './model';
import { buildOaMilp, decodeCounts, effectiveQs, layoutOf, nCol, scaleLps, type Layout } from './milp';

export interface Tuning {
  maxNodes: number;
  // Tangent points per target, in units of theta, each in (0, 1].
  sigmaGrid: readonly number[];
}

const SIGMA_FLOOR = 1e-2;
const SIGMA_CUTS = 50;

function logGrid(floor: number, count: number): number[] {
  const decades = Math.log10(floor);
  return Array.from({ length: count }, (_, i) => 10 ** ((decades * i) / (count - 1)));
}

// Worst-case gap between g and its tangent envelope on such a grid, in nats.
export function envelopeErrorNats(floor: number, count: number): number {
  const decadesPerCut = Math.abs(Math.log10(floor)) / (count - 1);
  return (decadesPerCut * Math.LN10) ** 2 / 8;
}

export const DEFAULT_TUNING: Tuning = { maxNodes: 400, sigmaGrid: logGrid(SIGMA_FLOOR, SIGMA_CUTS) };

const MIP_REL_GAP = 1e-6;

// Fuel is normalized to a budget of 1, so this is a relative slack.
const FUEL_TOL = 1e-9;
// Slack on a slot row, in seconds. Pinned to the tolerance the judge's packer
// works to, and never above it — see `certifies` below.
const SLOT_TOL = 1e-9;

function fuelOf(model: Model, counts: readonly number[]): number {
  let total = 0;
  for (let g = 0; g < counts.length; g++) {
    if (counts[g] > 0) total += counts[g] * model.groups[g].fuelFraction;
  }
  return total;
}

function slotLoads(model: Model, layout: Layout, columnValues: Float64Array): number[] {
  const loads = new Array<number>(model.slots).fill(0);
  for (let g = 0; g < model.groups.length; g++) {
    const seconds = model.groups[g].timeSeconds;
    for (let k = 0; k < model.slots; k++) {
      const v = columnValues[nCol(layout, g, k)];
      if (Number.isFinite(v) && v > 0) loads[k] += Math.round(v) * seconds;
    }
  }
  return loads;
}

function certifies(model: Model, layout: Layout, columnValues: Float64Array, counts: readonly number[]): boolean {
  if (fuelOf(model, counts) > 1 + FUEL_TOL) return false;
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

  const finalEval = evaluateCounts(model, counts, EXACT_PRECISION);
  const scored = finalEval.scores.map(s => (s > 0 ? -Math.expm1(-s) : 0));
  const perTarget = new Array<number>(scored.length);
  for (let t = 0; t < scored.length; t++) perTarget[model.requestedOrder[t]] = scored[t];
  // Folded in the model's own order, not the caller's: float multiplication is not
  // associative, so the caller's order would leak back into the reported joint.
  let jointProbability = 1;
  for (const p of scored) jointProbability *= p;
  return { allocation, reported: { jointProbability, perTarget } };
}

// Returns null when some target cannot be scored at all: the joint probability is
// then zero for every allocation and no plan beats the empty one.
function scales(model: Model, qs: readonly number[], solve: MilpSolve, limits: MilpLimits): number[] | null {
  const layout = layoutOf(model, 'scale');
  const scaleLp = scaleLps(model, qs);
  const theta: number[] = [];
  for (let t = 0; t < model.targets.length; t++) {
    const solution = solve(scaleLp(t), limits);
    if (solution.status === 'infeasible' || solution.status === 'unknown') return null;
    const value = solution.columnValues[layout.sBase + t];
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
  if (model.groups.length === 0 || model.targets.length === 0) return emit(problem, model, empty, report);

  const qs = effectiveQs(model);
  const limits: MilpLimits = { maxNodes: tuning.maxNodes, relGap: MIP_REL_GAP };
  const theta = scales(model, qs, solve, limits);
  if (!theta) return emit(problem, model, empty, report);

  const solution = solve(buildOaMilp(model, qs, theta, tuning.sigmaGrid), limits);
  if (solution.status === 'infeasible' || solution.status === 'unknown') return emit(problem, model, empty, report);

  const layout = layoutOf(model, 'oa');
  const counts = decodeCounts(model, layout, solution.columnValues);
  // `simplexMax` throws on an unbounded column, on a lost basis and on its iteration cap. Every
  // other failure here degrades to the empty plan, so a numerically unjudgeable incumbent does
  // too rather than taking the whole call down with it.
  let keep: boolean;
  try {
    keep =
      certifies(model, layout, solution.columnValues, counts) &&
      evaluateCounts(model, counts, STEERING_PRECISION).logJoint >
        evaluateCounts(model, empty, STEERING_PRECISION).logJoint;
  } catch {
    keep = false;
  }

  return emit(problem, model, keep ? counts : empty, report);
}
