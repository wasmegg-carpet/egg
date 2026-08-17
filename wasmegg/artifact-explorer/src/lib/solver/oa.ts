// The outer approximation: holds each concave g(s_T) under a fixed tangent grid so
// HiGHS sees a MILP, and returns an incumbent only once `./evaluator` certifies it.

import type { MilpLimits, MilpSolve, PlanProblem, PlanResult, ScheduleRun } from './types';
import { EXACT_PRECISION, STEERING_PRECISION, evaluateCounts } from './evaluator';
import { buildModel, type Model } from './model';
import { buildOaMilp, countsOfSlots, decodeSlotCounts, effectiveQs, layoutOf, scaleLps } from './milp';

export interface Tuning {
  // Node budget for a menu of one capacity variant; `nodeBudget` scales it by the mission column count,
  // so this is a base rather than the number handed to HiGHS.
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
// Same, on the event window row. Seconds, like the row.
const WINDOW_TOL = 1e-9;

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

// The schedule this plan will be emitted as, checked against every budget it claims to respect.
function certifies(model: Model, perSlot: readonly (readonly number[])[], counts: readonly number[]): boolean {
  if (fuelExceeded(model, counts)) return false;
  const window = model.eventWindowSeconds;
  for (const slot of perSlot) {
    let load = 0;
    let eventLoad = 0;
    let overhangs = 0;
    for (let g = 0; g < model.groups.length; g++) {
      const n = slot[g];
      if (!(n > 0)) continue;
      const grp = model.groups[g];
      load += n * grp.timeSeconds;
      if (grp.variant === 'event') eventLoad += n * grp.timeSeconds;
      else if (grp.variant === 'overhang') overhangs += n;
    }
    if (load > model.timeCapacitySeconds + SLOT_TOL) return false;
    // The `event` missions fly first, so their total bounds the offset of every one of them and of the
    // single `overhang` that follows them.
    if (window > 0 && eventLoad > window + WINDOW_TOL) return false;
    if (overhangs > 1) return false;
    if (window === 0 && eventLoad + overhangs > 0) return false;
  }
  return true;
}

// Section order within a slot: doubled launches first, so the boundary between them and the rest is
// where the window closes, and `overhang` last within them, since nothing may follow it inside the
// window. Downstream depends on this order — `certifies` bounds one prefix per slot, and the panel
// draws the boundary as a single cut.
const SECTION_RANK: Record<string, number> = { event: 0, overhang: 1, normal: 2 };

// One slot's launch order: sections in the order above, groups in model order within each.
function runsOf(model: Model, slot: readonly number[]): ScheduleRun[] {
  const held: number[] = [];
  for (let g = 0; g < model.groups.length; g++) if (slot[g] > 0) held.push(g);
  held.sort((a, b) => SECTION_RANK[model.groups[a].variant] - SECTION_RANK[model.groups[b].variant] || a - b);
  return held.map(g => ({ option: model.groups[g].members[0], count: slot[g] }));
}

// Nodes to spend, scaled by how many mission columns the menu produced against what a single-variant
// menu would have given — so exactly the base with no event in progress. Under-tuning here shows up as
// no plan rather than a worse one: the root heuristics find no incumbent and `solveWith` degrades
// silently to the empty plan.
function nodeBudget(base: number, model: Model): number {
  const total = model.groups.length;
  let single = 0;
  for (const grp of model.groups) if (grp.variant === 'normal') single++;
  if (single <= 0 || total <= single) return base;
  return Math.round((base * total) / single);
}

export interface SolveOptions {
  report?: boolean;
}

function emit(
  problem: PlanProblem,
  model: Model,
  perSlot: readonly (readonly number[])[],
  report: boolean
): PlanResult {
  const schedule = perSlot.map(slot => runsOf(model, slot));
  if (!report) return { schedule };

  const counts = countsOfSlots(perSlot, model.groups.length);
  const finalEval = evaluateCounts(model, counts, EXACT_PRECISION);
  const scored = finalEval.scores.map(s => (s > 0 ? -Math.expm1(-s) : 0));
  const perTarget = new Array<number>(scored.length);
  for (let t = 0; t < scored.length; t++) perTarget[model.requestedOrder[t]] = scored[t];
  // Folded in the model's own order, not the caller's: float multiplication is not
  // associative, so the caller's order would leak back into the reported joint.
  let jointProbability = 1;
  for (const p of scored) jointProbability *= p;
  return { schedule, reported: { jointProbability, perTarget } };
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
  const empty = Array.from({ length: model.slots }, () => new Array<number>(model.groups.length).fill(0));
  const emptyCounts = new Array<number>(model.groups.length).fill(0);
  if (model.groups.length === 0 || model.targets.length === 0) return emit(problem, model, empty, report);

  const qs = effectiveQs(model);
  const limits: MilpLimits = { maxNodes: nodeBudget(tuning.maxNodes, model), relGap: MIP_REL_GAP };
  const theta = scales(model, qs, solve, limits);
  if (!theta) return emit(problem, model, empty, report);

  const solution = solve(buildOaMilp(model, qs, theta, tuning.sigmaGrid), limits);
  if (solution.status === 'infeasible' || solution.status === 'unknown') return emit(problem, model, empty, report);

  const layout = layoutOf(model, 'oa');
  const perSlot = decodeSlotCounts(model, layout, solution.columnValues);
  const counts = countsOfSlots(perSlot, model.groups.length);
  // `simplexMax` throws on an unbounded column, on a lost basis and on its iteration cap. Every
  // other failure here degrades to the empty plan, so a numerically unjudgeable incumbent does
  // too rather than taking the whole call down with it.
  let keep: boolean;
  try {
    keep =
      certifies(model, perSlot, counts) &&
      evaluateCounts(model, counts, STEERING_PRECISION).logJoint >
        evaluateCounts(model, emptyCounts, STEERING_PRECISION).logJoint;
  } catch {
    keep = false;
  }

  return emit(problem, model, keep ? perSlot : empty, report);
}
