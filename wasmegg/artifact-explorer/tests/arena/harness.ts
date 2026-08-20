// Problem construction and scoring. The only place the arena touches a solver.
// Every invariant compares a number the harness computed from the candidate's allocation, never one it reported.

import { getArtifactTierPropsFromId, singleCraftCost } from 'lib';
import { buildRecipeDag } from '@/lib';
import { enumerateLaunchOptions } from '@/lib/phases';
import { EFFORT_LAUNCH_PERIOD_SECONDS, type EffortLevel } from '@/store/schema';
import type { CraftBudget, LaunchOption, RecipeDAG } from '@/lib/types';
import { evaluateAllocationJoint, type OracleInstance, type OracleJointEvaluation } from '../oracle/evaluate';
import { NUM_SLOTS, type PlanProblem, type PlanResult, type Planner, type ScheduleRun } from './contract';
import type { ArenaInstance } from './instances';
import { packFeasible, type PackVariant, type PackVerdict } from './pack-feasibility';

// Slack on budget comparisons. Capacities are float sums of float costs, so a
// plan that lands exactly on the cap can read a few ulps over it.
const BUDGET_TOL = 1e-9;
// An absolute floor on top of the relative slack: fuel figures run to 1e18, but
// a plan of a few cheap missions can still land an absolute ulp over.
const FUEL_ABS_TOL = 1e-6;

// One predicate, called from both `feasible` here and C1 in `invariants.ts`. The two have to agree exactly,
// or C1 fails a plan the improvement search calls legal.
export function fuelWithinCapacity(fuel: number, capacity: number): boolean {
  return fuel <= capacity * (1 + BUDGET_TOL) + FUEL_ABS_TOL;
}

// Per-craft golden egg prices, derived here from the game's price curve rather than taken from
// `optimizer-cost.ts`: a shared pricing helper would make a mispriced curve agree with itself.
export function craftUnitPrices(dag: RecipeDAG, previousCrafts = 0): Map<string, number> {
  const prices = new Map<string, number>();
  for (const [nodeId, node] of dag) {
    if (node.isLeaf) continue;
    const params = getArtifactTierPropsFromId(nodeId).recipe?.crafting_price;
    if (!params) continue;
    prices.set(nodeId, singleCraftCost(params, previousCrafts));
  }
  return prices;
}

export interface SolveOverrides {
  config?: ArenaInstance['config'];
  targets?: string[];
  fuelCapacity?: number;
  timeCapacityPerSlot?: number;
  craftBudget?: CraftBudget;
  effort?: EffortLevel;
  craftingLevel?: number;
  previousCrafts?: number;
  baseYield?: Map<string, number>;
  // Seconds of 2x mission capacity remaining. Reaches the menu and the problem together; a menu
  // enumerated against one window and solved against another has no rows for its doubled options.
  eventWindowSeconds?: number;
  // Applied to the enumerated menu before it reaches the solver, for the
  // invariances that perturb the menu itself.
  transformOptions?: (options: LaunchOption[]) => LaunchOption[];
  // Bypasses the plan cache in both directions, for the checks that have to
  // observe the planner running again rather than a value it returned before.
  // Not part of the problem: `buildProblem` ignores it.
  fresh?: boolean;
}

function buildProblem(inst: ArenaInstance, over: SolveOverrides = {}): PlanProblem {
  const targets = over.targets ?? inst.targets;
  const config = over.config ?? inst.config;
  const effort = over.effort ?? inst.effort;
  const eventWindowSeconds = over.eventWindowSeconds ?? inst.eventWindowSeconds;

  const dag = buildRecipeDag(
    targets,
    over.craftingLevel ?? inst.craftingLevel,
    null,
    over.previousCrafts ?? inst.previousCrafts
  );
  let options = enumerateLaunchOptions(config, dag, EFFORT_LAUNCH_PERIOD_SECONDS[effort], eventWindowSeconds);
  if (over.transformOptions) options = over.transformOptions(options);

  return {
    options,
    dag,
    // Copied, not aliased. `targets` would otherwise be the instance's own array, and a candidate that
    // sorted it in place would silently change every later check instead of producing a violation.
    targets: [...targets],
    fuelCapacity: over.fuelCapacity ?? inst.fuelCapacity,
    timeCapacityPerSlot: over.timeCapacityPerSlot ?? inst.timeCapacityPerSlot,
    slots: NUM_SLOTS,
    baseYield: over.baseYield ?? new Map<string, number>(),
    // Only ever set by an override: generated instances are uncapped, so the
    // sweep every recorded result was measured on is unchanged.
    craftBudget: over.craftBudget,
    eventWindowSeconds,
  };
}

// Plan cache. A `Planner` is a pure function of `PlanProblem`, so serving a repeat changes no output, only
// wall clock. The key is built from nothing outside `PlanProblem`, so this cannot leak instance identity.
const PLAN_CACHE_MAX = 128;
// The elapsed time is cached with the plan and replayed on a hit, so the
// scorecard's latency reports what the planner cost on that problem rather than
// what a Map lookup cost.
interface PlanCacheEntry {
  result: PlanResult;
  elapsedMs: number;
}
// Per planner, not per problem: a sweep runs the whole roster in one process, so a cache keyed on the
// problem alone would answer the second candidate with the first one's plan.
const planCaches = new WeakMap<Planner, Map<string, PlanCacheEntry>>();

function cacheFor(planner: Planner): Map<string, PlanCacheEntry> {
  const existing = planCaches.get(planner);
  if (existing) return existing;
  const created = new Map<string, PlanCacheEntry>();
  planCaches.set(planner, created);
  return created;
}

function sortedEntries(map: ReadonlyMap<string, number>): string {
  return [...map]
    .filter(([, v]) => v !== 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
}

function problemKey(problem: PlanProblem): string {
  // The capacity variant belongs in the key: an `event` and an `overhang` copy of the same launch are
  // identical in every number here and differ only in which row holds them.
  const options = problem.options
    .map(
      (o: LaunchOption) =>
        `${o.variant}|${o.actualFuel}|${o.actualTime}|${sortedEntries(o.yieldVector)}|${sortedEntries(o.legendaryYieldVector)}`
    )
    .join(';');
  const dag = [...problem.dag.keys()]
    .sort()
    .map(id => {
      const node = problem.dag.get(id)!;
      const children = node.children.map(c => `${c.nodeId}:${c.quantity}`).join(',');
      return `${id}~${node.isLeaf ? 1 : 0}~${node.legendaryCraftProbability}~${children}`;
    })
    .join(';');
  // The budget belongs in the key like any other. Leaving it out would serve an uncapped plan for a capped
  // problem, and a cache hit is indistinguishable from a solver that ignored the cap.
  const budget = problem.craftBudget
    ? `${problem.craftBudget.capacity}~${sortedEntries(problem.craftBudget.unitPrices)}`
    : '';
  // Leave the window out and the cache serves a no-event plan for an event problem, at which point the
  // W-monotonicity check compares a plan against itself and passes.
  return [
    problem.targets.join(','),
    problem.fuelCapacity,
    problem.timeCapacityPerSlot,
    budget,
    problem.eventWindowSeconds ?? 0,
    problem.slots,
    sortedEntries(problem.baseYield),
    dag,
    options,
  ].join('##');
}

// Copied on both sides, so a check mutating what it got back cannot poison a
// later solve.
function copyResult(result: PlanResult): PlanResult {
  return {
    schedule: result.schedule.map(runs => runs.map(r => ({ option: r.option, count: r.count }))),
    reported: result.reported
      ? { jointProbability: result.reported.jointProbability, perTarget: result.reported.perTarget.slice() }
      : undefined,
  };
}

// Per-option counts, summed out of the schedule.
export function allocationOf(problem: PlanProblem, schedule: readonly (readonly ScheduleRun[])[]): number[] {
  const alloc = new Array<number>(problem.options.length).fill(0);
  for (const runs of schedule) {
    for (const run of runs) {
      if (!Number.isInteger(run?.option) || run.option < 0 || run.option >= alloc.length) continue;
      if (Number.isFinite(run.count) && run.count > 0) alloc[run.option] += Math.floor(run.count);
    }
  }
  return alloc;
}

// One instance per problem, not one per call: the judge caches its compiled LP template on `OracleInstance`
// identity. Keyed structurally on the same `problemKey` the plan cache uses, since `buildProblem` allocates
// a fresh `PlanProblem` every run; the WeakMap stays in front as the identity fast path.
const instanceCache = new WeakMap<PlanProblem, OracleInstance>();
const INSTANCE_CACHE_MAX = 128;
const instancesByKey = new Map<string, OracleInstance>();

export function oracleInstanceOf(problem: PlanProblem): OracleInstance {
  const known = instanceCache.get(problem);
  if (known) return known;
  const key = problemKey(problem);
  let instance = instancesByKey.get(key);
  if (!instance) {
    instance = {
      label: 'arena',
      seed: 0,
      options: problem.options as LaunchOption[],
      dag: problem.dag,
      targets: problem.targets as string[],
      fuelCapacity: problem.fuelCapacity,
      timeCapacityPerSlot: problem.timeCapacityPerSlot,
      baseYield: problem.baseYield as Map<string, number>,
      craftBudget: problem.craftBudget,
    };
    if (instancesByKey.size >= INSTANCE_CACHE_MAX) instancesByKey.clear();
    instancesByKey.set(key, instance);
  }
  instanceCache.set(problem, instance);
  return instance;
}

// A candidate that returns something outside the contract is a finding, not a
// crash. Normalise what can be normalised, report what cannot.
function contractBreaches(problem: PlanProblem, result: PlanResult): string[] {
  const out: string[] = [];
  const schedule = result.schedule;
  if (!Array.isArray(schedule)) {
    out.push('schedule is not an array');
    return out;
  }
  if (schedule.length !== problem.slots) {
    out.push(`schedule has ${schedule.length} slot(s) for a problem with ${problem.slots}`);
    return out;
  }
  breaches: for (let k = 0; k < schedule.length; k++) {
    const runs = schedule[k];
    if (!Array.isArray(runs)) {
      out.push(`schedule[${k}] is not an array of runs`);
      break;
    }
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      const at = `schedule[${k}][${r}]`;
      if (!run || typeof run !== 'object') {
        out.push(`${at} is not a run`);
        break breaches;
      }
      if (!Number.isInteger(run.option) || run.option < 0 || run.option >= problem.options.length) {
        out.push(`${at}.option is ${run.option} for a menu of ${problem.options.length}`);
        break breaches;
      }
      if (!Number.isFinite(run.count)) {
        out.push(`${at}.count is ${run.count}`);
        break breaches;
      }
      if (run.count <= 0) {
        out.push(`${at}.count is ${run.count}; a run names at least one launch`);
        break breaches;
      }
      if (!Number.isInteger(run.count)) {
        out.push(`${at}.count is fractional (${run.count}); missions are indivisible`);
        break breaches;
      }
    }
  }
  if (result.reported) {
    const r = result.reported;
    if (!Number.isFinite(r.jointProbability)) {
      out.push(`reported.jointProbability is ${r.jointProbability}`);
    }
    if (r.perTarget.length !== problem.targets.length) {
      out.push(`reported.perTarget has ${r.perTarget.length} entries for ${problem.targets.length} target(s)`);
    }
  }
  return out;
}

export interface Budgets {
  fuel: number;
  totalTime: number;
  pack: PackVerdict;
}

export function budgetsOf(problem: PlanProblem, alloc: readonly number[]): Budgets {
  let fuel = 0;
  let totalTime = 0;
  const durations: number[] = [];
  const counts: number[] = [];
  const variants: PackVariant[] = [];
  for (let i = 0; i < alloc.length; i++) {
    const n = alloc[i];
    if (!(n > 0)) continue;
    fuel += n * problem.options[i].actualFuel;
    totalTime += n * problem.options[i].actualTime;
    durations.push(problem.options[i].actualTime);
    counts.push(n);
    variants.push(problem.options[i].variant);
  }
  const window = problem.eventWindowSeconds ?? 0;
  return {
    fuel,
    totalTime,
    pack: packFeasible(durations, counts, problem.timeCapacityPerSlot, problem.slots, undefined, {
      seconds: window,
      variants,
    }),
  };
}

// The golden egg budget is deliberately absent: missions cost no golden eggs, so no allocation can breach
// it — the cap binds on the craft split, which the judge chooses in `../evaluate.ts` under the same row.
export function feasible(problem: PlanProblem, alloc: readonly number[]): boolean {
  const b = budgetsOf(problem, alloc);
  return fuelWithinCapacity(b.fuel, problem.fuelCapacity) && b.pack === 'packs';
}

export interface Solved {
  problem: PlanProblem;
  result: PlanResult;
  // The plan as given, one launch order per slot; empty slots for a breached contract, so a check
  // reading this never has to re-test what C0 already reported.
  schedule: ScheduleRun[][];
  // Summed out of `schedule` by the harness, never taken from the candidate.
  allocation: number[];
  breaches: string[];
  // The harness's own valuation of `result.allocation`. Every invariant
  // compares this, never `result.reported`.
  judged: OracleJointEvaluation;
  joint: number;
  elapsedMs: number;
}

export function run(planner: Planner, inst: ArenaInstance, over: SolveOverrides = {}): Solved {
  const problem = buildProblem(inst, over);
  const key = over.fresh ? null : problemKey(problem);
  const cache = key === null ? null : cacheFor(planner);
  const hit = key !== null && cache ? cache.get(key) : undefined;
  const started = performance.now();
  const result = hit ? copyResult(hit.result) : planner(problem);
  const elapsedMs = hit ? hit.elapsedMs : performance.now() - started;

  const breaches = contractBreaches(problem, result);
  // Cached only once it is known well-formed: `copyResult` assumes the arrays
  // the contract promises, and a plan that breaches it is C0's to report rather
  // than something to hand back to a later check.
  if (key !== null && cache && !hit && breaches.length === 0) {
    if (cache.size >= PLAN_CACHE_MAX) cache.clear();
    cache.set(key, { result: copyResult(result), elapsedMs });
  }
  // Score whatever is scoreable. A malformed schedule is reported by C0 and
  // clamped here so one bad return does not abort the rest of the sweep.
  const schedule: ScheduleRun[][] = Array.isArray(result.schedule)
    ? result.schedule.map(runs =>
        Array.isArray(runs)
          ? runs
              .filter(r => r && Number.isInteger(r.option) && r.option >= 0 && r.option < problem.options.length)
              .map(r => ({
                option: r.option,
                count: Number.isFinite(r.count) && r.count > 0 ? Math.floor(r.count) : 0,
              }))
              .filter(r => r.count > 0)
          : []
      )
    : [];
  const allocation = allocationOf(problem, schedule);

  const judged = evaluateAllocationJoint(oracleInstanceOf(problem), allocation);
  return {
    problem,
    result,
    schedule,
    allocation,
    breaches,
    judged,
    joint: judged.jointProbability,
    elapsedMs,
  };
}

// Identity of a plan, including the order it is flown in: the same counts in a different order are
// different answers, and under a window only one of them may be legal.
export function signature(s: Solved): string {
  return s.schedule.map(runs => runs.map(r => `${r.option}:${r.count}`).join(',')).join('|');
}
