// The outer approximation: holds each concave g(s_T) under a fixed tangent grid so
// HiGHS sees a MILP, and returns an incumbent only once `./evaluator` certifies it.

import type {
  CalendarLaunch,
  CraftSplitReport,
  LayoutStats,
  MilpLimits,
  MilpModel,
  MilpSolution,
  MilpSolve,
  PlanProblem,
  PlanResult,
} from './types';
import { padSecondsOf } from './types';
import { EXACT_PRECISION, STEERING_PRECISION, evaluateCounts, type EvalResult } from './evaluator';
import { buildModel, type Model } from './model';
import { buildOaMilp, decodeCounts, effectiveQs, layoutOf, nCol, scaleLps, type Layout } from './milp';
import { layOutPlan, timelineOf } from './layout';
import { doubledCopiesOnMenu, padFault, slotFault, startChain } from './verify';

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

// Per slot, `perLaunch` summed over the MILP's own rounded class columns: seconds for the slot rows, nights
// for the night rows, `event` seconds and `overhang` launches for the window rows.
function slotLoads(model: Model, layout: Layout, columnValues: Float64Array, perLaunch: readonly number[]): number[] {
  const loads = new Array<number>(model.slots).fill(0);
  for (let c = 0; c < layout.classes; c++) {
    const unit = perLaunch[c];
    for (let k = 0; k < model.slots; k++) {
      const v = columnValues[nCol(layout, c, k)];
      if (Number.isFinite(v) && v > 0) loads[k] += Math.round(v) * unit;
    }
  }
  return loads;
}

// The craft budget is not re-checked here because no allocation can breach it: it binds on the craft
// split, which the judge re-solves for itself over a polytope carrying the same row (`evaluator.ts`,
// `craftLpOf`). See `tests/arena/ARENA.md`, "Feasibility".
function fitsBudgets(model: Model, layout: Layout, columnValues: Float64Array, counts: readonly number[]): boolean {
  if (fuelExceeded(model, counts)) return false;
  // What `slot_k` charges, which is a launch's seconds except for a doubled launch under a sleep window (SPEC.md
  // section 14).
  const capacity = model.timeCapacitySeconds;
  for (const load of slotLoads(model, layout, columnValues, layout.classCharge)) {
    if (load > capacity + SLOT_TOL) return false;
  }
  // Whole nights summed from whole counts: exact, so no tolerance. Without a sleep window every load is 0
  // against a budget of 0. See SPEC.md section 9.
  for (const nights of slotLoads(model, layout, columnValues, layout.classNights)) {
    if (nights > model.nightsPerSlot) return false;
  }
  // The window rows, read the same way: `event` seconds against the window's waking seconds with the slot row's
  // tolerance, `event` nights against its whole nights and `overhang` launches against one exactly (SPEC.md
  // sections 11 and 14). Without a window no class is doubled, so every load is 0, and a doubled launch that
  // somehow appeared there anyway fails the last test. See SPEC.md section 11.
  const window = model.eventWindowSeconds;
  const isEvent = (c: number) => layout.classVariant[c] === 'event';
  const eventSeconds = layout.classSeconds.map((s, c) => (isEvent(c) ? s : 0));
  for (const load of slotLoads(model, layout, columnValues, eventSeconds)) {
    if (load > model.eventWindowBudget + SLOT_TOL) return false;
  }
  const eventNights = layout.classNights.map((n, c) => (isEvent(c) ? n : 0));
  for (const nights of slotLoads(model, layout, columnValues, eventNights)) {
    if (nights > model.eventWindowNights) return false;
  }
  const doubled = layout.classVariant.map(v => (v === 'normal' ? 0 : 1));
  const overhangs = layout.classVariant.map(v => (v === 'overhang' ? 1 : 0));
  const doubledLoads = slotLoads(model, layout, columnValues, doubled);
  const overhangLoads = slotLoads(model, layout, columnValues, overhangs);
  // And the start row: one launch at T+0 a slot (SPEC.md section 17).
  const startLoads = slotLoads(
    model,
    layout,
    columnValues,
    layout.classAtStart.map(t => (t ? 1 : 0))
  );
  for (let k = 0; k < model.slots; k++) {
    if (overhangLoads[k] > 1) return false;
    if (startLoads[k] > 1) return false;
    if (!(window > 0) && doubledLoads[k] > 0) return false;
  }
  return true;
}

export interface SolveOptions {
  report?: boolean;
}

// What every result carries besides its allocation: the calendar, and what laying it out took, which is
// reported only with a sleep window (SPEC.md section 12).
interface Laid {
  calendar: CalendarLaunch[][];
  layoutStats: LayoutStats;
}

const NO_LAYOUT: LayoutStats = {
  launchesTrimmed: 0,
  overnightTrimmed: 0,
  layoutSolves: 0,
  marginResolves: 0,
  verifierRetries: 0,
};

// The plan with nothing in it, which every problem admits.
function emptyLaid(model: Model): Laid {
  return {
    calendar: Array.from({ length: model.slots }, () => []),
    layoutStats: {
      ...NO_LAYOUT,
      ...((model.day !== null || model.fuelingRate > 0) &&
        model.eventWindowSeconds > 0 && { launchesDemoted: 0, launchesPromoted: 0 }),
    },
  };
}

// The last gate before a plan leaves the solver, and the one that makes "only verified plans are reported" a
// property of the code rather than of the layout being right: every launch is checked against the option it
// names (not the figures the layout wrote down), every slot against the sleep rule and the event window both ways
// (a doubled launch inside it, and no 1x launch inside it that the menu could have doubled), and the calendar's
// launches against the allocation, count for count. A plan that fails is not returned at all.
export function assertVerified(
  problem: PlanProblem,
  model: Model,
  allocation: readonly number[],
  calendar: CalendarLaunch[][]
): void {
  const sleep = timelineOf(model);
  const fail = (detail: string): never => {
    throw new Error(`solver: refusing to return a plan whose calendar fails verification: ${detail}`);
  };
  if (calendar.length !== model.slots)
    fail(`${calendar.length} slot(s) in the calendar, ${model.slots} in the problem`);
  const flown = new Array<number>(allocation.length).fill(0);
  const copies = doubledCopiesOnMenu(problem.options);
  // With the fueling pad, the plan's rule across its slots, each launch fuelled for its own option's fuel, and the
  // start chain the player stays up for read off the same times (SPEC.md section 18). Without it, neither.
  const rate = model.fuelingRate > 0 ? model.fuelingRate : undefined;
  const pads = calendar.map(launches =>
    launches.map(l => ({
      launchAt: l.launchAt,
      padSeconds: padSecondsOf(problem.options[l.option] ?? { actualFuel: NaN }, rate),
    }))
  );
  const chained = rate === undefined ? null : startChain(pads);
  if (rate !== undefined) {
    const fault = padFault(pads);
    if (fault !== null) fail(fault);
  }
  calendar.forEach((launches, k) => {
    for (const l of launches) {
      const opt = problem.options[l.option];
      if (opt === undefined || opt.id !== l.optionId) fail(`slot ${k} names option ${l.option} as ${l.optionId}`);
      if (opt.actualTime !== l.wakingSeconds || (opt.nights ?? 0) !== l.nights) {
        fail(`slot ${k} times option ${l.option} as ${l.wakingSeconds}s and ${l.nights} night(s)`);
      }
      if (l.doubled !== ((opt.variant ?? 'normal') !== 'normal')) {
        fail(`slot ${k} flies option ${l.option} (${opt.variant ?? 'normal'}) as doubled=${l.doubled}`);
      }
      flown[l.option]++;
    }
    const timed = launches.map((l, i) => ({
      ...l,
      eventCopy: copies[l.option].event,
      overhangCopy: copies[l.option].overhang,
      ...(chained !== null && { startChain: chained[k][i] }),
      ...(problem.options[l.option].atStartSeconds !== undefined && {
        atStartSeconds: problem.options[l.option].atStartSeconds,
      }),
    }));
    const fault = slotFault(timed, sleep, model.eventWindowSeconds);
    if (fault !== null) fail(`slot ${k}: ${fault}`);
  });
  for (let i = 0; i < allocation.length; i++) {
    if (flown[i] !== allocation[i]) fail(`option ${i} is allocated ${allocation[i]} but flown ${flown[i]} time(s)`);
  }
}

function emit(problem: PlanProblem, model: Model, counts: readonly number[], report: boolean, laid: Laid): PlanResult {
  const allocation = new Array<number>(problem.options.length).fill(0);
  for (let g = 0; g < model.groups.length; g++) {
    if (counts[g] > 0) allocation[model.groups[g].members[0]] += counts[g];
  }
  assertVerified(problem, model, allocation, laid.calendar);
  const extra = {
    calendar: laid.calendar,
    ...((model.day !== null || model.fuelingRate > 0) && { layoutStats: laid.layoutStats }),
  };
  if (!report) return { allocation, ...extra };

  // Inside the guard the rest of the pass works under: `evaluateCounts` runs a simplex that throws on
  // an unbounded column, a lost basis or its iteration cap, and a report is the one part of the result
  // that can be dropped on its own. The allocation stands — `STEERING_PRECISION` already judged it —
  // and omitting `reported` says the figures could not be re-derived rather than inventing them.
  let finalEval: ReturnType<typeof evaluateCounts>;
  try {
    finalEval = evaluateCounts(model, counts, EXACT_PRECISION);
  } catch {
    return { allocation, ...extra };
  }
  const scored = finalEval.scores.map(s => (s > 0 ? -Math.expm1(-s) : 0));
  const craftSplit = splitOf(model, finalEval.crafts);
  const perTarget = new Array<number>(scored.length);
  for (let t = 0; t < scored.length; t++) perTarget[model.requestedOrder[t]] = scored[t];
  // Folded in the model's own order, not the caller's: float multiplication is not
  // associative, so the caller's order would leak back into the reported joint.
  let jointProbability = 1;
  for (const p of scored) jointProbability *= p;
  return { allocation, reported: { jointProbability, perTarget }, craftSplit, ...extra };
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
    const solution = solveOrRetry(solve, scaleLp(t), limits);
    if (solution.status !== 'optimal' && solution.status !== 'feasible') return null;
    const value = solution.columnValues[layout.scoreBase + t];
    if (!(value > 0) || !Number.isFinite(value)) return null;
    theta.push(value);
  }
  return theta;
}

// Only these two carry a point that is a plan rather than a waypoint on a ray or a leftover from an errored solve:
// a whitelist, not a blacklist of the failures known today. `feasible` is an incumbent HiGHS stopped with, which is
// used as it is.
const solved = (solution: MilpSolution) => solution.status === 'optimal' || solution.status === 'feasible';

// One solve, and when HiGHS fails outright (no plan, no incumbent, no verdict on the model) one more with
// `SOLVER_RETRY_OPTIONS`. A model HiGHS calls infeasible or unbounded is not retried: that is an answer.
function solveOrRetry(solve: MilpSolve, model: MilpModel, limits: MilpLimits): MilpSolution {
  const first = solve(model, limits);
  return first.status === 'unknown' ? solve(model, { ...limits, retry: true }) : first;
}

// The last resort when a problem with a 2x window comes back empty for want of a plan from the MILP (SPEC.md section
// 16): the same problem without the window, its calendar flown under the window with every launch that goes up
// inside it promoted. That plan flies only `normal` options, which the window leaves as they were, so it is a plan
// of this problem too, and promotion only raises its joint: the window never does worse than no window would.
function withoutWindow(
  problem: PlanProblem,
  model: Model,
  solve: MilpSolve,
  tuning: Tuning,
  report: boolean,
  none: Laid
): PlanResult {
  const empty = new Array<number>(model.groups.length).fill(0);
  const plain = solveWith({ ...problem, eventWindowSeconds: undefined }, solve, tuning);
  const groupOf = new Map<number, number>();
  model.groups.forEach((grp, g) => grp.members.forEach(option => groupOf.set(option, g)));
  const counts = empty.slice();
  for (let option = 0; option < plain.allocation.length; option++) {
    if (!(plain.allocation[option] > 0)) continue;
    const g = groupOf.get(option);
    if (g === undefined) return emit(problem, model, empty, report, none);
    counts[g] += plain.allocation[option];
  }
  if (!plain.calendar || counts.every(n => n === 0)) return emit(problem, model, empty, report, none);
  const judge = (c: readonly number[]) => evaluateCounts(model, c, STEERING_PRECISION).logJoint;
  const laid = layOutPlan(
    model,
    layoutOf(model, 'oa'),
    new Float64Array(0),
    counts,
    problem.options,
    solve,
    judge,
    slotFault,
    plain.calendar
  );
  // What laying the plan out took is the windowless solve's; promotion is this one's.
  const before = plain.layoutStats;
  const stats: LayoutStats = before
    ? { ...before, launchesDemoted: 0, launchesPromoted: laid.stats.launchesPromoted ?? 0 }
    : laid.stats;
  stats.launchesTrimmed += before ? laid.stats.launchesTrimmed : 0;
  let keep: boolean;
  try {
    keep = judge(laid.counts) > judge(empty);
  } catch {
    keep = false;
  }
  if (!keep) return emit(problem, model, empty, report, none);
  return emit(problem, model, laid.counts, report, { calendar: laid.calendar, layoutStats: stats });
}

export function solveWith(
  problem: PlanProblem,
  solve: MilpSolve,
  tuning: Tuning = DEFAULT_TUNING,
  { report = false }: SolveOptions = {}
): PlanResult {
  const model = buildModel(problem);
  const empty = new Array<number>(model.groups.length).fill(0);
  const none = emptyLaid(model);
  if (model.groups.length === 0 || model.sortedTargets.length === 0) return emit(problem, model, empty, report, none);
  // Every way below of coming back empty for want of a plan. With a 2x window that is not the end: the problem
  // without it is solved and flown under it (`withoutWindow`).
  const nothing = (): PlanResult =>
    model.eventWindowSeconds > 0
      ? withoutWindow(problem, model, solve, tuning, report, none)
      : emit(problem, model, empty, report, none);

  const qs = effectiveQs(model);
  const limits: MilpLimits = { maxNodes: tuning.maxNodes, relGap: MIP_REL_GAP };
  const theta = scales(model, qs, solve, limits);
  if (!theta) return nothing();

  const solution = solveOrRetry(solve, buildOaMilp(model, qs, theta, tuning.sigmaGrid), limits);
  if (!solved(solution)) return nothing();

  const layout = layoutOf(model, 'oa');
  const counts = decodeCounts(model, layout, solution.columnValues);
  // `simplexMax` throws on an unbounded column, on a lost basis and on its iteration cap. Every
  // other failure here degrades to the empty plan, so a numerically unjudgeable incumbent does
  // too rather than taking the whole call down with it.
  let keep: boolean;
  let planned: number | undefined;
  try {
    planned = evaluateCounts(model, counts, STEERING_PRECISION).logJoint;
    keep =
      fitsBudgets(model, layout, solution.columnValues, counts) &&
      planned > evaluateCounts(model, empty, STEERING_PRECISION).logJoint;
  } catch {
    keep = false;
  }
  if (!keep) return nothing();

  // Every plan is laid out into the calendar it is returned with. Without a sleep window that is exact and trims
  // nothing (SPEC.md section 12). With one the MILP's plan is a relaxation of real days (SPEC.md section 9): what
  // does not fit is trimmed, and a doubled launch it cannot start inside the 2x window is flown at 1x (SPEC.md
  // section 13). With or without one, a 1x launch that goes up inside the 2x window is flown doubled (section 16).
  // The plan is then judged again, the way the plan above was, against the empty one. Everything reported from here
  // describes the plan as laid out.
  const judge = (c: readonly number[]) => evaluateCounts(model, c, STEERING_PRECISION).logJoint;
  const laid = layOutPlan(model, layout, solution.columnValues, counts, problem.options, solve, judge);
  laid.stats.plannedLogJoint = planned;
  let keepLaid: boolean;
  try {
    keepLaid =
      (laid.stats.launchesTrimmed === 0 && !laid.stats.launchesDemoted && !laid.stats.launchesPromoted) ||
      judge(laid.counts) > judge(empty);
  } catch {
    keepLaid = false;
  }
  if (!keepLaid)
    return model.eventWindowSeconds > 0
      ? nothing()
      : emit(problem, model, empty, report, { ...none, layoutStats: laid.stats });
  return emit(problem, model, laid.counts, report, { calendar: laid.calendar, layoutStats: laid.stats });
}
