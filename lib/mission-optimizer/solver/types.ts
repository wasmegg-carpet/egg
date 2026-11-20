// The solver's type surface: what a plan is, and what the MILP backend behind it
// trades in.

import type { ei } from '../../index';
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
  // Whole sleep windows available per slot, alongside `timeCapacityPerSlot`, which then counts waking
  // seconds only. Absent means today's problem: no sleep, and no option carries `nights`; the model then
  // reads it as 0, so an option that does carry nights is dropped rather than flown for free. See SPEC.md
  // section 9. The app sets it, always together with `sleep` below, when the player has a sleep window
  // (`optimizeFull`, via `../sleep.ts`).
  readonly nightsPerSlot?: number;
  // The day the night budget above is cut from, which the per-day fit rows, the layout and the verifier need
  // and `nightsPerSlot` alone does not say (SPEC.md section 10). Absent means no day: no fit rows, and the
  // calendar every plan carries is laid back to back (SPEC.md section 12). Present, every plan returned has been
  // laid out on real days and verified.
  readonly sleep?: SleepWindow;
  // Seconds of a 2x mission capacity event left, as a window starting at the plan's t = 0: a prefix, never an
  // interval starting later. Absent or 0 means no window: no option may fly doubled, so one that carries a doubled
  // `variant` is dropped, and the matrix is the one built without a window (SPEC.md sections 11 and 13). The app
  // sets it from the player's "time left" (`optimizeFull`, via `../capacity.ts`). With a sleep window as well, the
  // window is wall-clock seconds from the plan's start, nights included, and a doubled launch that the layout
  // cannot start inside it is flown at 1x instead (SPEC.md section 13).
  readonly eventWindowSeconds?: number;
  // Eggs a second the game's one fueling pad moves into a ship. Every launch is fueled on that pad first, for its
  // `actualFuel / fuelingRate` seconds (`padSecondsOf`), one ship at a time for all the slots: fueling the next ship
  // may start the moment the previous one launches, and a fueled ship waits on the pad until its slot is free. So,
  // over every launch of the plan in launch order, the first goes up no sooner than its own fueling after t = 0 and
  // each later one no sooner than its fueling after the one before it. Absent means instant fueling, the problem
  // without the pad exactly. The app sets it from the player's tank level (`../fueling.ts`). See SPEC.md section 18.
  readonly fuelingRate?: number;
  readonly slots: number;
  // Copies of each node the player already owns, folded in before crafting.
  readonly ownedStock: ReadonlyMap<string, number>;
  // Optional cap on the plan's craft cost in golden eggs; absent means unconstrained.
  readonly craftBudget?: CraftBudget;
}

export const DAY_SECONDS = 86400;

// A day is a waking window of `DAY_SECONDS - sleepSeconds` followed by `sleepSeconds` of sleep, the same every
// day and shared by every slot; the plan starts `wakeOffsetSeconds` after a wake-up and runs `horizonSeconds`,
// which is what `timeCapacityPerSlot` was before it came to count waking seconds only. Sleep forbids launching and
// nothing else. See SPEC.md sections 10 and 17.
export interface SleepWindow {
  readonly sleepSeconds: number;
  readonly horizonSeconds: number;
  // Seconds since the player last woke up, at the plan's t = 0: wake-ups are at `k * DAY_SECONDS -
  // wakeOffsetSeconds`, and the first waking window has `DAY_SECONDS - sleepSeconds - wakeOffsetSeconds` left in it.
  // Absent or 0 is a plan that starts at wake-up, today's problem exactly. Up to the waking window `W`, the player
  // is awake at t = 0; past it they are in the night, up at t = 0 only to launch, and asleep until the next wake-up
  // at `DAY_SECONDS - wakeOffsetSeconds` (SPEC.md section 17).
  readonly wakeOffsetSeconds?: number;
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

// Nights are whole: a fraction of a sleep window is not one the player can fly through.
function wholeCapacityOf(value: number): number {
  return Math.floor(capacityOf(value));
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
    // Left absent when absent, so a problem without a sleep window normalizes to exactly what it did before.
    ...(problem.nightsPerSlot === undefined ? {} : { nightsPerSlot: wholeCapacityOf(problem.nightsPerSlot) }),
    ...(problem.sleep === undefined ? {} : { sleep: sleepWindowOf(problem.sleep) }),
    // The window is a budget like any other. With a sleep window as well its rows are a relaxation and the
    // layout makes every plan true (SPEC.md section 13).
    ...(problem.eventWindowSeconds === undefined ? {} : { eventWindowSeconds: capacityOf(problem.eventWindowSeconds) }),
    // Left absent when absent, so a problem without the pad normalizes to exactly what it did before.
    ...(problem.fuelingRate === undefined ? {} : { fuelingRate: fuelingRateOf(problem.fuelingRate) }),
  };
}

// The pad's rate is not a budget either, and no reading of a malformed one is safe: 0 or less would mean no ship is
// ever fueled, and a non-finite one fuels in no time, which is a different problem from the one the caller set. So
// it throws, as a malformed sleep window does. The only path to one is a programming error: the app derives it from
// a tank size.
function fuelingRateOf(rate: number): number {
  if (!Number.isFinite(rate) || !(rate > 0)) throw new Error(`fueling rate must be a positive number, got ${rate}`);
  return rate;
}

// Seconds the pad takes to fuel one launch of `opt` at `rate` eggs a second: all of its eggs at one rate, so egg types
// do not fuel side by side. A doubled launch carries its 1x twin's fuel, so it fuels as long. 0 without a rate.
export function padSecondsOf(opt: Pick<LaunchOption, 'actualFuel'>, rate: number | undefined): number {
  return rate !== undefined && rate > 0 ? opt.actualFuel / rate : 0;
}

// The horizon is a budget and follows the rule above. The sleep window is not one: no reading of a malformed
// value is the safe one (0 would hand back the nights, a whole day would forbid every launch), and the only
// path to one is a programming error, so it throws, as a malformed `craftBudget` does.
// The wake offset is not a budget either, and is held the same way: a value outside a day throws. Left absent when
// absent or 0, so a plan that starts at wake-up normalizes to exactly what it did before the field existed.
function sleepWindowOf(sleep: SleepWindow): SleepWindow {
  if (!Number.isFinite(sleep.sleepSeconds) || sleep.sleepSeconds < 0 || sleep.sleepSeconds >= DAY_SECONDS) {
    throw new Error(`sleep window must be in [0, ${DAY_SECONDS}) seconds, got ${sleep.sleepSeconds}`);
  }
  const offset = sleep.wakeOffsetSeconds;
  if (offset !== undefined && (!Number.isFinite(offset) || offset < 0 || offset >= DAY_SECONDS)) {
    throw new Error(`wake offset must be in [0, ${DAY_SECONDS}) seconds, got ${offset}`);
  }
  const wake = offset ?? 0;
  return {
    sleepSeconds: sleep.sleepSeconds,
    horizonSeconds: capacityOf(sleep.horizonSeconds),
    ...(wake > 0 && { wakeOffsetSeconds: wake }),
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

// One launch on a slot's timeline. `launchAt` is seconds from the plan's start (`wakeOffsetSeconds` after a wake-up,
// with a sleep window); the launch occupies its slot for `wakingSeconds + nights * sleepSeconds` (just `wakingSeconds`
// without one), after which the next launch may go.
export interface CalendarLaunch {
  // Index into `problem.options`, and that option's id, so a reader can check one against the other.
  option: number;
  optionId: string;
  launchAt: number;
  wakingSeconds: number;
  nights: number;
  // Whether it flies at 2x capacity: its option is an `event` or `overhang` variant, and it launches inside the
  // event window (SPEC.md section 11). Always false for a problem without one.
  doubled: boolean;
}

// What it took to lay a plan out; diagnostics only, nothing reads them to decide anything.
export interface LayoutStats {
  // Launches the solve wanted and the layout could not place, so the plan went without (overnight ones included).
  launchesTrimmed: number;
  // Of those, overnight launches dropped because the slot's overnight ships could not be ordered to fit.
  overnightTrimmed: number;
  // Layout MILPs handed to the backend, margin re-solves included; a slot the greedy places whole needs none.
  layoutSolves: number;
  // Re-solves with the one-second margin, after a rounded layout failed its own exact re-check.
  marginResolves: number;
  // Slot layouts the verifier rejected, each followed by a drop and a re-lay.
  verifierRetries: number;
  // Doubled launches the layout could not start inside the 2x window, flown at 1x as their normal twin instead
  // (SPEC.md section 13); not counted in `launchesTrimmed`, since they still fly. Present only when the problem
  // also carries an event window, so a sleep-only result carries no window statistics.
  launchesDemoted?: number;
  // 1x launches the layout found going up inside the 2x window, flown doubled instead (SPEC.md section 16); a
  // trim the window forces is counted in `launchesTrimmed`. Present exactly when `launchesDemoted` is.
  launchesPromoted?: number;
  // What the plan promised: the solver's own judge (`STEERING_PRECISION`) on the MILP's counts before any of them
  // was laid out, trimmed or demoted, as a natural log of the joint. Beside the delivered plan's judged joint it
  // is the gap the relaxed rows leave for the layout to close (SPEC.md section 14). Absent when no plan came
  // out of the MILP.
  plannedLogJoint?: number;
}

export interface PlanResult {
  // Missions launched per option, parallel to `problem.options`. Non-negative
  // integers, fuel within capacity, packable into `slots` slots of `timeCapacityPerSlot`.
  allocation: number[];
  reported?: PlanReport;
  // Alongside `reported`, and absent for the same reason: the judge could not re-derive the plan.
  craftSplit?: CraftSplitReport;
  // Per slot, its launches in launch order, already passed by the verifier, and accounting for every launch in
  // `allocation` (SPEC.md sections 10 and 12). `solveWith` returns one with every plan; optional because the
  // arena's contract lets a candidate return an allocation alone for a problem with neither a sleep window nor
  // an event window.
  calendar?: CalendarLaunch[][];
  // Present exactly when the problem carries `sleep` or a `fuelingRate`, the cases with anything to lay out or trim.
  layoutStats?: LayoutStats;
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
  // Solve with `SOLVER_RETRY_OPTIONS` on top of `SOLVER_OPTIONS`: the one second attempt `solveWith` makes after
  // HiGHS fails outright (SPEC.md section 8). Absent is false.
  retry?: boolean;
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

// The second attempt's change: presolve on. HiGHS can fail out of `Highs_run` ("HiGHS error -1") on a model it
// reads perfectly well, with presolve on (the failure that turned it off) and with it off (arena seed 2030 with a
// 2x window straddling the horizon). A different code path through the same model, as deterministic as the first;
// presolve only reformulates, so it cannot turn a wrong answer into a right-looking one. See SPEC.md section 8.
export const SOLVER_RETRY_OPTIONS: Readonly<Record<string, boolean | number | string>> = { presolve: 'on' };
