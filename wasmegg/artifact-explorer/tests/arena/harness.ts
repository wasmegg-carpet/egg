// Problem construction and scoring. The only place the arena touches a solver.
// Every invariant compares a number the harness computed from the candidate's allocation, never one it reported.

import { getArtifactTierPropsFromId, singleCraftCost } from 'lib';
import { buildRecipeDag } from '@/lib';
import { enumerateLaunchOptions } from 'lib/mission-optimizer/problem-inputs';
import { EFFORT_LAUNCH_PERIOD_SECONDS, type EffortLevel } from 'lib/mission-optimizer/effort';
import type { CraftBudget, LaunchOption, RecipeDAG } from 'lib/mission-optimizer/types';
import { evaluateAllocationJoint, type OracleInstance, type OracleJointEvaluation } from '../oracle/evaluate';
import { NUM_SLOTS, type PlanProblem, type PlanResult, type Planner } from './contract';
import type { CalendarDay } from './calendar';
import type { ArenaInstance } from './instances';
import { capacityVariants, isDoubled } from './capacity';
import { packFeasible, packFeasibleBudgets, type PackVerdict } from './pack-feasibility';
import { sleepCapacity, sleepVariants, startVariants, wakeOffsetOf } from './sleep';

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
  ownedStock?: Map<string, number>;
  // Seconds of sleep a day, replacing the instance's own window. `timeCapacityPerSlot` stays the horizon
  // either way; `buildProblem` turns the pair into waking seconds and nights.
  sleepSeconds?: number;
  // Seconds of 2x capacity window left, replacing the instance's own. Reaches the menu and the problem together.
  eventWindowSeconds?: number;
  // Seconds since the player woke up at the plan's start, replacing the instance's own; read against whichever
  // sleep window applies (`wakeOffsetOf`).
  wakeOffsetSeconds?: number;
  // Applied to the enumerated menu before it reaches the solver, for the
  // invariances that perturb the menu itself.
  transformOptions?: (options: LaunchOption[]) => LaunchOption[];
  // Bypasses the plan cache in both directions, for the checks that have to
  // observe the planner running again rather than a value it returned before.
  // Not part of the problem: `buildProblem` ignores it.
  fresh?: boolean;
}

// The sleep window, horizon and event window an instance is stated with, after overrides: what C1 verifies a
// calendar against, kept by the harness rather than read back off the problem a candidate was handed. Without
// sleep the day is all waking time, and the horizon is the slot.
function dayOf(inst: ArenaInstance, over: SolveOverrides): CalendarDay {
  const sleepSeconds = over.sleepSeconds ?? inst.sleepSeconds;
  const eventWindowSeconds = over.eventWindowSeconds ?? inst.eventWindowSeconds;
  const wake = wakeOf(inst, over);
  return {
    sleepSeconds: sleepSeconds > 0 ? sleepSeconds : 0,
    horizonSeconds: over.timeCapacityPerSlot ?? inst.timeCapacityPerSlot,
    slots: NUM_SLOTS,
    eventWindowSeconds: eventWindowSeconds > 0 ? eventWindowSeconds : 0,
    ...(wake > 0 && { wakeOffsetSeconds: wake }),
    // The instance's pad, never the one on the problem a candidate was handed.
    ...(inst.fuelingRate !== undefined && { fuelingRate: inst.fuelingRate }),
  };
}

// The wake offset after overrides, against the sleep window after overrides: 0 without sleep.
function wakeOf(inst: ArenaInstance, over: SolveOverrides): number {
  return wakeOffsetOf(over.wakeOffsetSeconds ?? inst.wakeOffsetSeconds ?? 0, over.sleepSeconds ?? inst.sleepSeconds);
}

function buildProblem(inst: ArenaInstance, over: SolveOverrides = {}): PlanProblem {
  const targets = over.targets ?? inst.targets;
  const config = over.config ?? inst.config;
  const effort = over.effort ?? inst.effort;

  const dag = buildRecipeDag(
    targets,
    over.craftingLevel ?? inst.craftingLevel,
    null,
    over.previousCrafts ?? inst.previousCrafts
  );
  // Variants are split off the enumerated menu before any menu perturbation, so a shuffle shuffles the
  // variants too and a duplicate duplicates one variant. Capacity over sleep, so a doubled launch keeps its
  // nights. With neither this is the menu itself.
  const sleep = over.sleepSeconds ?? inst.sleepSeconds;
  const horizon = over.timeCapacityPerSlot ?? inst.timeCapacityPerSlot;
  const window = over.eventWindowSeconds ?? inst.eventWindowSeconds;
  const menu = enumerateLaunchOptions(config, dag, EFFORT_LAUNCH_PERIOD_SECONDS[effort]);
  // Starting in the night, the menu also holds each option as a launch at T+0, before capacity so a doubled T+0
  // launch keeps its charge; otherwise there are none, and the menu is what it always was.
  const wake = wakeOf(inst, over);
  let options = [
    ...capacityVariants([...sleepVariants(menu, sleep), ...startVariants(menu, sleep, wake, horizon)], window),
  ];
  if (over.transformOptions) options = over.transformOptions(options);
  // With sleep, the slot budget becomes waking seconds plus whole nights. Without, `nightsPerSlot` is absent
  // rather than undefined, so a sleep-free instance states today's problem exactly.
  const capacity = sleep > 0 ? sleepCapacity(horizon, sleep, wake) : null;

  return {
    options,
    dag,
    // Copied, not aliased. `targets` would otherwise be the instance's own array, and a candidate that
    // sorted it in place would silently change every later check instead of producing a violation.
    targets: [...targets],
    fuelCapacity: over.fuelCapacity ?? inst.fuelCapacity,
    timeCapacityPerSlot: capacity ? capacity.wakingSecondsPerSlot : horizon,
    ...(capacity ? { nightsPerSlot: capacity.nightsPerSlot } : {}),
    // The day itself, which the candidate needs to lay its plan out on real days and return a calendar.
    // The wake offset rides on it, absent when the plan starts at wake-up, so such a problem is today's exactly.
    ...(capacity
      ? { sleep: { sleepSeconds: sleep, horizonSeconds: horizon, ...(wake > 0 ? { wakeOffsetSeconds: wake } : {}) } }
      : {}),
    // Absent rather than 0 without one, so a window-free instance states today's problem exactly.
    ...(window > 0 ? { eventWindowSeconds: window } : {}),
    // Absent without a pad, so such an instance states today's problem exactly.
    ...(inst.fuelingRate !== undefined ? { fuelingRate: inst.fuelingRate } : {}),
    slots: NUM_SLOTS,
    ownedStock: over.ownedStock ?? new Map<string, number>(),
    // Only ever set by an override: generated instances are uncapped, so the
    // sweep every recorded result was measured on is unchanged.
    craftBudget: over.craftBudget,
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
  const options = problem.options
    .map(
      (o: LaunchOption) =>
        `${o.actualFuel}|${o.actualTime}|${sortedEntries(o.yieldVector)}|${sortedEntries(o.legendaryYieldVector)}` +
        (o.nights === undefined ? '' : `|n${o.nights}`) +
        // An `event` and an `overhang` copy of one launch are identical in every number above.
        (o.variant === undefined ? '' : `|v${o.variant}`) +
        (o.atStartSeconds === undefined ? '' : `|s${o.atStartSeconds}`)
    )
    .join(';');
  const dag = [...problem.dag.keys()]
    .sort()
    .map(id => {
      const node = problem.dag.get(id)!;
      const children = node.children.map(c => `${c.nodeId}:${c.qty}`).join(',');
      return `${id}~${node.isLeaf ? 1 : 0}~${node.legendaryCraftProbability}~${children}`;
    })
    .join(';');
  // The budget belongs in the key like any other. Leaving it out would serve an uncapped plan for a capped
  // problem, and a cache hit is indistinguishable from a solver that ignored the cap.
  const budget = problem.craftBudget
    ? `${problem.craftBudget.capacity}~${sortedEntries(problem.craftBudget.unitPrices)}`
    : '';
  return [
    problem.targets.join(','),
    problem.fuelCapacity,
    problem.timeCapacityPerSlot,
    ...(problem.nightsPerSlot === undefined ? [] : [`nights${problem.nightsPerSlot}`]),
    ...(problem.sleep === undefined ? [] : [`sleep${problem.sleep.sleepSeconds}/${problem.sleep.horizonSeconds}`]),
    ...(problem.sleep?.wakeOffsetSeconds === undefined ? [] : [`wake${problem.sleep.wakeOffsetSeconds}`]),
    // Left out, the cache serves a plan solved for one window to a problem with another, and A11-window compares a
    // plan against itself and passes.
    ...(problem.eventWindowSeconds === undefined ? [] : [`window${problem.eventWindowSeconds}`]),
    ...(problem.fuelingRate === undefined ? [] : [`pad${problem.fuelingRate}`]),
    budget,
    problem.slots,
    sortedEntries(problem.ownedStock),
    dag,
    options,
  ].join('##');
}

// Copied on both sides, so a check mutating what it got back cannot poison a
// later solve.
function copyResult(result: PlanResult): PlanResult {
  return {
    allocation: result.allocation.slice(),
    reported: result.reported
      ? { jointProbability: result.reported.jointProbability, perTarget: result.reported.perTarget.slice() }
      : undefined,
    // C1 reads the calendar off every solve, cached ones included; dropping it here would fail a cache hit.
    ...(result.calendar === undefined ? {} : { calendar: result.calendar.map(slot => slot.map(l => ({ ...l }))) }),
    ...(result.layoutStats === undefined ? {} : { layoutStats: { ...result.layoutStats } }),
  };
}

// What candidates say it took to lay their plans out, summed over fresh solves (cache hits replay a plan and
// are not counted again). Diagnostics for the scorecard only: nothing scores or gates on a figure a candidate
// reports about itself.
export interface LayoutTally {
  solves: number;
  plansTrimmed: number;
  launchesTrimmed: number;
  overnightTrimmed: number;
  layoutSolves: number;
  marginResolves: number;
  verifierRetries: number;
  // Doubled launches the candidate flew at 1x because its layout could not start them inside the 2x window, and
  // the plans with any; 0 for a candidate that reports none.
  plansDemoted: number;
  launchesDemoted: number;
  // 1x launches the candidate found going up inside the 2x window and flew doubled; 0 for one that reports none.
  launchesPromoted: number;
}

const layoutTallies = new WeakMap<Planner, LayoutTally>();

function emptyTally(): LayoutTally {
  return {
    solves: 0,
    plansTrimmed: 0,
    launchesTrimmed: 0,
    overnightTrimmed: 0,
    layoutSolves: 0,
    marginResolves: 0,
    verifierRetries: 0,
    plansDemoted: 0,
    launchesDemoted: 0,
    launchesPromoted: 0,
  };
}

// Returns the tally so far and starts a new one.
export function takeLayoutTally(planner: Planner): LayoutTally {
  const t = layoutTallies.get(planner) ?? emptyTally();
  layoutTallies.set(planner, emptyTally());
  return t;
}

function tallyLayout(planner: Planner, result: PlanResult): void {
  const stats = result.layoutStats;
  if (stats === undefined) return;
  const t = layoutTallies.get(planner) ?? emptyTally();
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  t.solves++;
  if (n(stats.launchesTrimmed) > 0) t.plansTrimmed++;
  t.launchesTrimmed += n(stats.launchesTrimmed);
  t.overnightTrimmed += n(stats.overnightTrimmed);
  t.layoutSolves += n(stats.layoutSolves);
  t.marginResolves += n(stats.marginResolves);
  t.verifierRetries += n(stats.verifierRetries);
  if (n(stats.launchesDemoted) > 0) t.plansDemoted++;
  t.launchesDemoted += n(stats.launchesDemoted);
  t.launchesPromoted += n(stats.launchesPromoted);
  layoutTallies.set(planner, t);
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
      ownedStock: problem.ownedStock as Map<string, number>,
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
  const alloc = result.allocation;
  if (!Array.isArray(alloc)) {
    out.push('allocation is not an array');
    return out;
  }
  if (alloc.length !== problem.options.length) {
    out.push(`allocation has ${alloc.length} entries for a menu of ${problem.options.length}`);
    return out;
  }
  for (let i = 0; i < alloc.length; i++) {
    const n = alloc[i];
    if (!Number.isFinite(n)) {
      out.push(`allocation[${i}] is ${n}`);
      break;
    }
    if (n < 0) {
      out.push(`allocation[${i}] is negative (${n})`);
      break;
    }
    if (!Number.isInteger(n)) {
      out.push(`allocation[${i}] is fractional (${n}); missions are indivisible`);
      break;
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
  // Sleep windows the plan flies through, summed over launches. 0 for a problem without a sleep window.
  totalNights: number;
  pack: PackVerdict;
}

export function budgetsOf(problem: PlanProblem, alloc: readonly number[]): Budgets {
  let fuel = 0;
  let totalTime = 0;
  let totalNights = 0;
  let doubled = 0;
  const durations: number[] = [];
  const nights: number[] = [];
  const variants: (string | undefined)[] = [];
  const counts: number[] = [];
  for (let i = 0; i < alloc.length; i++) {
    const n = alloc[i];
    if (!(n > 0)) continue;
    const o = problem.options[i];
    fuel += n * o.actualFuel;
    totalTime += n * o.actualTime;
    totalNights += n * (o.nights ?? 0);
    if (isDoubled(o)) doubled += n;
    durations.push(o.actualTime);
    nights.push(o.nights ?? 0);
    variants.push(o.variant);
    counts.push(n);
  }
  // Each further budget only once the plan actually spends it. A plan of daytime, undoubled launches packs exactly
  // as it always has, so the one-dimensional rule stays the one every earlier result was measured against.
  const withNights = problem.nightsPerSlot !== undefined && totalNights > 0;
  if (!withNights && doubled === 0) {
    return {
      fuel,
      totalTime,
      totalNights,
      pack: packFeasible(durations, counts, problem.timeCapacityPerSlot, problem.slots),
    };
  }
  // Per launch: waking seconds; then nights; then, with a doubled launch, the window's two budgets as the
  // labels state them — `event` seconds against the window, `overhang` launches against one a slot. Sound, since
  // `event` launches first and the one `overhang` after them all go up inside the window; label-bound, since
  // two `overhang` launches that would both fit are refused (ARENA.md, "The 2x capacity window").
  const window = problem.eventWindowSeconds ?? 0;
  const costs = durations.map((d, j) => [
    d,
    ...(withNights ? [nights[j]] : []),
    ...(doubled > 0 ? [variants[j] === 'event' ? d : 0, variants[j] === 'overhang' ? 1 : 0] : []),
  ]);
  const capacities = [
    problem.timeCapacityPerSlot,
    ...(withNights ? [problem.nightsPerSlot!] : []),
    ...(doubled > 0 ? [window, window > 0 ? 1 : 0] : []),
  ];
  return { fuel, totalTime, totalNights, pack: packFeasibleBudgets(costs, counts, capacities, problem.slots) };
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
  allocation: number[];
  breaches: string[];
  // The harness's own valuation of `result.allocation`. Every invariant
  // compares this, never `result.reported`.
  judged: OracleJointEvaluation;
  joint: number;
  elapsedMs: number;
  // The day and the event window the problem was stated with: sleep 0 and the slot as the horizon without a
  // sleep window, window 0 without an event.
  day: CalendarDay;
}

export function run(planner: Planner, inst: ArenaInstance, over: SolveOverrides = {}): Solved {
  const problem = buildProblem(inst, over);
  const key = over.fresh ? null : problemKey(problem);
  const cache = key === null ? null : cacheFor(planner);
  const hit = key !== null && cache ? cache.get(key) : undefined;
  const started = performance.now();
  const result = hit ? copyResult(hit.result) : planner(problem);
  const elapsedMs = hit ? hit.elapsedMs : performance.now() - started;
  if (!hit) tallyLayout(planner, result);

  const breaches = contractBreaches(problem, result);
  // Cached only once it is known well-formed: `copyResult` assumes the arrays
  // the contract promises, and a plan that breaches it is C0's to report rather
  // than something to hand back to a later check.
  if (key !== null && cache && !hit && breaches.length === 0) {
    if (cache.size >= PLAN_CACHE_MAX) cache.clear();
    cache.set(key, { result: copyResult(result), elapsedMs });
  }
  // Score whatever is scoreable. A malformed allocation is reported by C0 and
  // clamped here so one bad return does not abort the rest of the sweep.
  const allocation = new Array<number>(problem.options.length).fill(0);
  if (Array.isArray(result.allocation)) {
    for (let i = 0; i < allocation.length; i++) {
      const n = result.allocation[i];
      allocation[i] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }
  }

  const judged = evaluateAllocationJoint(oracleInstanceOf(problem), allocation);
  return {
    problem,
    result,
    allocation,
    breaches,
    judged,
    joint: judged.jointProbability,
    elapsedMs,
    day: dayOf(inst, over),
  };
}

export function signature(s: Solved): string {
  return s.allocation
    .map((n, i) => (n > 0 ? `${i}:${n}` : ''))
    .filter(Boolean)
    .join('|');
}
