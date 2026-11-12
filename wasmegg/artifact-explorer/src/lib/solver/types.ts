// The solver's type surface: what a plan is, and what the MILP backend behind it
// trades in.

import type { ei } from 'lib';
import type { CraftBudget, LaunchOption, RecipeDAG } from '../types';

// One budget the plan has to fit inside. `egg: null` charges the option's whole
// `actualFuel`; an egg charges only that egg's share, from `fuelByEgg`.
export interface FuelAxis {
  readonly egg: ei.Egg | null;
  readonly capacity: number;
}

// What one launch of `opt` draws from `axis`.
export function fuelCostOnAxis(opt: LaunchOption, axis: FuelAxis): number {
  return axis.egg === null ? opt.actualFuel : (opt.fuelByEgg.get(axis.egg) ?? 0);
}

// One rule governs every budget below, and `normalizeProblem` is the only place it is applied:
// a budget is either **absent**, meaning no limit, or a **finite non-negative number**. No numeric
// value means "unlimited" — an empty input field upstream arrives as NaN, and a capacity read as
// unlimited is the one reading a caller who set a budget can least afford. So a non-finite or
// negative capacity normalizes to 0, which permits nothing, and a `craftBudget` malformed the same
// way throws, since the only path to one is a programming error rather than a keystroke.
export interface PlanProblem {
  // Menu of launches available. `allocation` is indexed against this array, in this
  // order. Options may repeat, may be shuffled, and may include useless entries.
  readonly options: readonly LaunchOption[];
  readonly dag: RecipeDAG;
  // Desired artifact node ids, deduplicated by `normalizeProblem`: the objective is
  // P(a legendary of EVERY one of these), and an id listed twice is one event, not two
  // independent ones whose probabilities multiply.
  readonly targets: readonly string[];
  readonly fuelCapacity: number;
  // Per-egg budgets, replacing `fuelCapacity` when supplied. Absent means the single
  // aggregate axis `[{ egg: null, capacity: fuelCapacity }]`, one tank holding any mix.
  readonly fuelAxes?: readonly FuelAxis[];
  // Seconds. Note the asymmetry with `fuelCapacity` above, which is for the whole plan.
  readonly timeCapacityPerSlot: number;
  readonly slots: number;
  // Copies of each node the player already owns, folded in before crafting.
  readonly ownedStock: ReadonlyMap<string, number>;
  // Optional cap on the plan's craft cost in golden eggs; absent means unconstrained.
  readonly craftBudget?: CraftBudget;
}

// A problem that has been through `normalizeProblem`: its axes are materialized, so nothing
// downstream re-derives them, and every budget obeys the rule above.
export interface NormalizedProblem extends PlanProblem {
  readonly fuelAxes: readonly FuelAxis[];
}

const EMPTY_TANK: FuelAxis = { egg: null, capacity: 0 };

function capacityOf(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// Idempotent, which is what lets both boundaries — `optimizeFull` and `buildModel` — enter through
// it without either having to know whether the other already did.
export function normalizeProblem(problem: PlanProblem): NormalizedProblem {
  const budget = problem.craftBudget;
  if (budget && (!Number.isFinite(budget.capacity) || budget.capacity < 0)) {
    throw new Error(`craft budget capacity must be finite and non-negative, got ${budget.capacity}`);
  }
  // A per-egg list replaces the tank, so an *empty* one is an empty tank rather than an absent budget:
  // zero axes constrain nothing, and unlimited fuel is not what a player holding no eggs asked for.
  // `{ egg: null, capacity: 0 }` says the same thing the list does, and permits the same missions —
  // the ones that burn nothing budgeted.
  const axes = problem.fuelAxes ?? [{ egg: null, capacity: problem.fuelCapacity }];
  return {
    ...problem,
    targets: [...new Set(problem.targets)],
    fuelCapacity: capacityOf(problem.fuelCapacity),
    fuelAxes: axes.length > 0 ? axes.map(ax => ({ egg: ax.egg, capacity: capacityOf(ax.capacity) })) : [EMPTY_TANK],
    timeCapacityPerSlot: capacityOf(problem.timeCapacityPerSlot),
  };
}

// Optional self-report of what a planner believes its own plan is worth; supplying
// it opts into the arena's C2-honesty and C3-joint-product checks.
export interface PlanReport {
  jointProbability: number;
  perTarget: number[]; // parallel to problem.targets
}

// The craft counts behind a `PlanReport`, keyed by recipe node id: `byNode` pooled across the whole
// plan, `byTarget` each target's own column of that same point. Nothing in the arena reads this; it
// is how the app gets its reported split off the judge's LP instead of re-deriving one.
export interface CraftSplitReport {
  byNode: Map<string, number>;
  byTarget: Map<string, number>;
}

export interface PlanResult {
  // Missions launched per option, parallel to `problem.options`. Non-negative
  // integers, fuel within capacity, packable into `slots` slots of `timeCapacityPerSlot`.
  allocation: number[];
  reported?: PlanReport;
  // Alongside `reported`, and absent for the same reason: the judge could not re-derive the plan.
  craftSplit?: CraftSplitReport;
}

// HiGHS treats any bound at or beyond this magnitude as infinite.
export const INF = 1e30;

export interface MilpModel {
  columnCount: number;
  columnLower: Float64Array;
  columnUpper: Float64Array;
  columnIsInteger: Uint8Array;
  // Always maximized.
  objective: Float64Array;
  rowCount: number;
  // One per row, parallel to `offsets`; `highs.ts` writes them into the LP text, so a row
  // HiGHS or `Rows.end` complains about is greppable. See SPEC.md section 3.
  rowNames: string[];
  rowLower: Float64Array;
  rowUpper: Float64Array;
  // Row-major sparse matrix. `offsets` holds one start per row (length `rowCount`,
  // not `rowCount + 1`); the last row runs to the end of `indices`.
  offsets: Int32Array;
  indices: Int32Array;
  values: Float64Array;
}

export type MilpStatus =
  | 'optimal'
  // a feasible incumbent, but the search stopped on a limit
  | 'feasible'
  | 'infeasible'
  // no finite optimum: the objective can be pushed arbitrarily far, so any point HiGHS
  // reports is a waypoint on a ray rather than a plan
  | 'unbounded'
  // no usable primal solution came back
  | 'unknown';

export interface MilpSolution {
  status: MilpStatus;
  // Only meaningful when `status` is 'optimal' or 'feasible'.
  objective: number;
  columnValues: Float64Array;
}

// Node- and gap-based rather than time-based; see SPEC.md section 7.
export interface MilpLimits {
  // 0 means "no branching allowed beyond the root". Must be a whole number inside
  // int32 — see `SOLVER_OPTIONS`.
  maxNodes: number;
  relGap: number;
}

export type MilpSolve = (model: MilpModel, limits: MilpLimits) => MilpSolution;

// Options pinned on every solve, so a plan is a function of the model and the limits and of nothing else.
// The wasm binding sets a numeric option through `Highs_setDoubleOptionValue` and falls back to the int setter
// only when the value is integral, so a non-integral or non-finite option is *silently ignored*.
export const SOLVER_OPTIONS: Readonly<Record<string, boolean | number | string>> = {
  output_flag: false,
  log_to_console: false,
  threads: 1,
  parallel: 'off',
  random_seed: 0,
  // Off, and measured that way rather than assumed; see SPEC.md section 8.
  presolve: 'off',
  primal_feasibility_tolerance: 1e-9,
  // Three orders below HiGHS's 1e-6 default: HiGHS may satisfy a slot row only to this
  // figure while the arena's packer admits at most `capacity + 1e-9`, so loosening it
  // lets the solver commit a violation the arena will not accept. Tried at 1e-8 for
  // the presolve breakdown 1e-9 triggers (ERGO-Code/HiGHS#1578); presolve off removes
  // that failure path instead.
  mip_feasibility_tolerance: 1e-9,
  // One order below default, not more: at HiGHS's documented minimum of 1e-10 the
  // simplex fails outright ("HiGHS error -1"). See SPEC.md section 4.
  dual_feasibility_tolerance: 1e-8,
};
