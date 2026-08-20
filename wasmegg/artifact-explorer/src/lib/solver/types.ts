// The solver's type surface: what a plan is, and what the MILP backend behind it
// trades in.

import type { CraftBudget, LaunchOption, RecipeDAG } from '../types';

export interface PlanProblem {
  // Menu of launches available. A schedule entry is indexed against this array, in this
  // order. Options may repeat, may be shuffled, and may include useless entries.
  readonly options: readonly LaunchOption[];
  readonly dag: RecipeDAG;
  // Desired artifact node ids. The objective is P(a legendary of EVERY one of these)
  // — the product over targets, not the max or the sum.
  readonly targets: readonly string[];
  readonly fuelCapacity: number;
  // Seconds. Note the asymmetry with `fuelCapacity` above, which is for the whole plan.
  readonly timeCapacityPerSlot: number;
  readonly slots: number;
  // Copies of each node the player already owns, folded in before crafting.
  readonly baseYield: ReadonlyMap<string, number>;
  // Optional cap on the plan's craft cost in golden eggs; absent means unconstrained.
  readonly craftBudget?: CraftBudget;
  // Seconds of 2x mission capacity remaining, measured from the start of the plan; the window is always
  // a prefix, never an interval starting at some future offset. 0 or absent means no event, and then the
  // menu carries only `normal` options.
  readonly eventWindowSeconds?: number;
}

// Optional self-report of what a planner believes its own plan is worth; supplying
// it opts into the arena's C2-honesty and C3-joint-product checks.
export interface PlanReport {
  jointProbability: number;
  perTarget: number[]; // parallel to problem.targets
}

// `count` consecutive launches of `problem.options[option]`, flown back to back.
export interface ScheduleRun {
  option: number;
  count: number;
}

export interface PlanResult {
  // The plan: one launch order per slot, `problem.slots` entries long. Each slot's runs fly in array
  // order from offset 0, so a run's start offset is the sum of `count * actualTime` over everything
  // before it. Per-option counts are derived from this by summing; nothing reports them separately.
  //
  // The order is checked as given and never reordered, so a schedule the event window rejects is a
  // breach even where some other permutation of the same runs would pass.
  schedule: ScheduleRun[][];
  reported?: PlanReport;
}

// HiGHS treats any bound at or beyond this magnitude as infinite.
export const INF = 1e30;

export interface MilpModel {
  columnCount: number;
  columnLower: Float64Array;
  columnUpper: Float64Array;
  columnIsInteger: Uint8Array;
  // Always maximized; there is no sense flag to get wrong.
  objective: Float64Array;
  rowCount: number;
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
  // lets the solver commit a violation the judge will not accept. Tried at 1e-8 for
  // the presolve breakdown 1e-9 triggers (ERGO-Code/HiGHS#1578); presolve off removes
  // that failure path instead.
  mip_feasibility_tolerance: 1e-9,
  // One order below default, not more: at HiGHS's documented minimum of 1e-10 the
  // simplex fails outright ("HiGHS error -1"). See SPEC.md section 4.
  dual_feasibility_tolerance: 1e-8,
};
