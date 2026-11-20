// The mission-plan pipeline: option filtering, objective evaluation, and the assembly of a renderable
// solution around whatever plan the planner (`./solver/`) returned. See OPTIMIZER.md for the objective.

import type { CraftBudget, LaunchOption, LaunchSolution, OptimizerSolution, RecipeDAG, SlotSummary } from './types';
import { ei } from '../index';
import { craftsToProbability } from './objective';
import { capacityVariants, eventWindowSecondsOf } from './capacity';
import { sleepCapacity, sleepSecondsOf, sleepVariants, startVariants, wakeOffsetSecondsOf } from './sleep';
import { loadHighs } from './solver/highs';
import { DEFAULT_TUNING, solveWith } from './solver/solve';
import {
  DAY_SECONDS,
  fuelCostOnAxis,
  normalizeProblem,
  type CalendarLaunch,
  type CraftSplitReport,
  type PlanProblem,
} from './solver/types';

// Below this, a mission's duration counts as zero — the only quantity it's compared against.
const ZERO_TOL = 1e-9;

// Three mission slots, as the game gives. Exported because it is a property of the game rather than of the solver.
export const NUM_SLOTS = 3;

// The budgets below obey `solver/types.ts`'s one rule: absent means no limit, a present one is a
// finite non-negative number, and `normalizeProblem` holds every caller to it.
export interface OptimizeArgs {
  options: LaunchOption[];
  recipeDag: RecipeDAG;
  desiredArtifactNodeIds: string[];
  fuelCapacity: number;
  // Per-egg budgets from the player's tank. When present these replace `fuelCapacity`:
  // the plan is limited by the fuel actually stocked, egg by egg, rather than by how
  // much the tank could hold.
  fuelByEggCapacity?: Map<ei.Egg, number>;
  // The wall-clock horizon of each slot, whether or not the player sleeps: with a sleep window it is
  // `optimizeFull` that splits it into waking seconds and nights, so every caller keeps saying how long the
  // plan may run rather than how much of that is launchable.
  timeCapacityPerSlot: number;
  // Seconds a day the player cannot launch. Absent or 0 plans around the clock.
  // Present, the menu is split into daytime and overnight variants and only a plan laid out on real days is
  // returned (`solver/SPEC.md` sections 9 and 10).
  sleepSeconds?: number;
  // Seconds since the player last woke up, now: the plan starts that far into a waking day of the regular schedule
  // `sleepSeconds` sets, so the first waking window has that much less left, and every later day is a whole one
  // (`solver/SPEC.md` section 17). Absent or 0 starts the plan at wake-up, as it always did; ignored without
  // `sleepSeconds`. Past the waking window the player is up in the night, only to launch: each slot may send one
  // ship at T+0, and the next launches wait for the wake-up `86400 - wakeOffsetSeconds` in (`startVariants`). A
  // day or more is not a regular schedule and reads as 0 (`wakeOffsetSecondsOf`).
  wakeOffsetSeconds?: number;
  // Seconds of a 2x mission capacity event left, starting now. Absent or 0 is no event. Present, the
  // menu gains the doubled variants (`capacity.ts`), capped at `MAX_DOUBLE_CAPACITY_SECONDS`, and the window
  // rows hold them inside it (`solver/SPEC.md` section 11). The caller passes the menu as enumerated; it never
  // enumerates against the window itself. Combines with `sleepSeconds`, the window then counting nights too
  // (`solver/SPEC.md` section 13).
  eventWindowSeconds?: number;
  // Eggs a second the game's one fueling pad moves into a ship, for every slot: each launch is fuelled there first,
  // one ship at a time, for `actualFuel / fuelingRate` seconds, so launches the plan would send together are spaced
  // out (`solver/SPEC.md` section 18). Both apps pass `fuelingRateOfLevel` of the tank level (`fueling.ts`). Absent fuels
  // every launch in no time, the plan without the pad exactly.
  fuelingRate?: number;
  // Not a budget the plan spends against but a threshold on the menu: it drops ships the player
  // will not pay for, and leaves the feasible set bounded at any value, so `Infinity` is a legal
  // way to say "the whole menu" where an infinite capacity would be malformed.
  maximumCost: number | undefined;
  ownedStock: Map<string, number>;
  // Golden egg cap on the plan's crafts, or absent for no cap. It has to reach both the MILP and the
  // judge's craft LP, or the cap does not bind on the craft counts the card actually prints.
  craftBudget?: CraftBudget;
}

interface Assembly {
  options: LaunchOption[];
  recipeDag: RecipeDAG;
  targets: string[];
  ownedStock: Map<string, number>;
}

// Slack on reading a launch time against a bedtime or a wake-up: the solver's verifier's own microsecond.
const CLOCK_TOL = 1e-6;

// The sleep windows a ship launched at `launchAt` is in the air for: the bedtimes from its launch up to, not
// including, its landing `flightSeconds` later. A ship sent up at bedtime is one; one that lands as the player
// goes to bed is not. This is what the player sees, and it can differ from the night count of the variant the
// solver budgeted the launch as: a re-timed or folded launch can land a night early, and a daytime one can go up
// before bed and land in the night (`solver/SPEC.md` section 14). Bedtimes fall on the regular day, `wakeOffset`
// seconds ahead of the plan's clock (section 17). A ship that goes up asleep, which only a launch at T+0 in the
// night the plan starts in does, is in the air through that night too, however soon it lands: the player sends it
// on the way back to sleep, and it is out while they are.
export function nightsFlown(launchAt: number, flightSeconds: number, sleepSeconds: number, wakeOffset = 0): number {
  if (!(sleepSeconds > 0)) return 0;
  const bedtime = DAY_SECONDS - sleepSeconds;
  const at = launchAt + wakeOffset;
  const first = Math.ceil((at - CLOCK_TOL - bedtime) / DAY_SECONDS);
  const last = Math.ceil((at + flightSeconds - CLOCK_TOL - bedtime) / DAY_SECONDS) - 1;
  // Read as the verifier reads it, so a time a hair under a wake-up counts as the wake-up.
  const asleep =
    at - Math.floor((at + CLOCK_TOL) / DAY_SECONDS) * DAY_SECONDS > bedtime + CLOCK_TOL && flightSeconds > 0 ? 1 : 0;
  return asleep + Math.max(0, last - first + 1);
}

// The first instant at or after `t` the player is awake: `t` itself, or the next wake-up when `t` is in a night.
// In the plan's seconds, with its wake-ups `wakeOffset` before each whole day of the regular one.
function awakeFrom(t: number, sleepSeconds: number, wakeOffset: number): number {
  if (!(sleepSeconds > 0)) return t;
  const at = t + wakeOffset;
  const day = Math.floor((at + CLOCK_TOL) / DAY_SECONDS);
  return at - day * DAY_SECONDS <= DAY_SECONDS - sleepSeconds + CLOCK_TOL ? t : (day + 1) * DAY_SECONDS - wakeOffset;
}

// Per-slot occupancy of a plan, read off the calendar the solver verified, which is the arrangement the plan
// was accepted on: the MILP's own slot columns, laid out (`solver/SPEC.md` section 12). A slot's load is where
// its last block ends — with a sleep window, the first moment after that the player is awake to collect its last
// ship and launch again; without one, the sum of its launches.
// Each launch keeps its place and names the `choiceHistory` entry it flies by index: `choiceOf` maps an option
// index to that entry. With a sleep window it also carries the nights it is in the air for, by its launch time
// and its flight (`nightsFlown`). `wakeOffset` is the plan's start on the player's regular day (0, at wake-up).
export function slotSummariesOfCalendar(
  options: LaunchOption[],
  calendar: CalendarLaunch[][],
  sleepSeconds: number,
  choiceOf: ReadonlyMap<number, number>,
  wakeOffset = 0
): SlotSummary[] {
  if (calendar.every(launches => launches.length === 0)) return [];
  // A launch at T+0 in the night holds its slot to its landing (`LaunchOption.atStartSeconds`).
  const blockOf = (launch: CalendarLaunch) =>
    options[launch.option].atStartSeconds ?? launch.wakingSeconds + launch.nights * sleepSeconds;
  return calendar.map(launches => {
    const last = launches[launches.length - 1];
    return {
      loadSeconds: last ? awakeFrom(last.launchAt + blockOf(last), sleepSeconds, wakeOffset) : 0,
      rawLoadSeconds: launches.reduce((total, launch) => total + options[launch.option].rawTime, 0),
      launches: launches.map(launch => {
        const choice = choiceOf.get(launch.option);
        // The verifier holds the calendar to the allocation count for count, so this is a broken seam.
        if (choice === undefined)
          throw new Error(`optimizer: the calendar flies option ${launch.option}, never chosen`);
        return {
          choice,
          launchAt: launch.launchAt,
          ...(sleepSeconds > 0 && {
            nights: nightsFlown(launch.launchAt, options[launch.option].rawTime, sleepSeconds, wakeOffset),
          }),
        };
      }),
    };
  });
}

// The whole plan, start to finish. Async because the solver is a WebAssembly module instantiated once;
// every call after the first resolves off a cached promise.
export async function optimizeFull(args: OptimizeArgs): Promise<OptimizerSolution> {
  const { recipeDag, fuelByEggCapacity, maximumCost, ownedStock, craftBudget } = args;

  // A sleep window turns the wall-clock horizon into two budgets per slot, waking seconds and nights, and
  // each option into the ways it can sit against those nights (`sleep.ts`). Without one this is today's
  // problem field for field: the menu as given, and neither sleep field on it.
  const sleepSeconds = sleepSecondsOf(args.sleepSeconds);
  // Where the plan starts on the player's regular day: 0, at wake-up, unless they say they woke earlier. Without a
  // sleep window there is no day, and it is 0 whatever they said.
  const wakeOffsetSeconds = wakeOffsetSecondsOf(args.wakeOffsetSeconds, sleepSeconds);
  const capacity =
    sleepSeconds > 0 ? sleepCapacity(args.timeCapacityPerSlot, sleepSeconds, wakeOffsetSeconds) : undefined;
  // The event window, likewise: doubled variants of whatever the sleep split produced, so a doubled launch keeps
  // its nights and its waking seconds. Without one the menu passes through untouched.
  const eventWindowSeconds = eventWindowSecondsOf(args.eventWindowSeconds);
  // Starting in the night, each option also as a launch at T+0 (`startVariants`); none otherwise.
  const options = capacityVariants(
    capacity
      ? [
          ...sleepVariants(args.options, sleepSeconds),
          ...startVariants(args.options, sleepSeconds, wakeOffsetSeconds, args.timeCapacityPerSlot),
        ]
      : args.options,
    eventWindowSeconds
  );

  // The whole boundary: budgets validated and clamped, targets deduplicated, fuel axes materialized.
  // Everything below reads the normalized problem rather than `args`, so no rule is applied twice or
  // differently — `buildModel` enters through the same function.
  const normalized = normalizeProblem({
    options,
    dag: recipeDag,
    targets: args.desiredArtifactNodeIds,
    fuelCapacity: args.fuelCapacity,
    // A per-egg budget replaces the tank entirely: the egg amounts already sum to no more
    // than the tank holds, so an aggregate row on top of them would be redundant.
    fuelAxes: fuelByEggCapacity && [...fuelByEggCapacity].map(([egg, capacity]) => ({ egg, capacity })),
    timeCapacityPerSlot: capacity ? capacity.wakingSecondsPerSlot : args.timeCapacityPerSlot,
    ...(capacity && {
      nightsPerSlot: capacity.nightsPerSlot,
      sleep: {
        sleepSeconds,
        horizonSeconds: args.timeCapacityPerSlot,
        ...(wakeOffsetSeconds > 0 && { wakeOffsetSeconds }),
      },
    }),
    ...(eventWindowSeconds > 0 && { eventWindowSeconds }),
    ...(args.fuelingRate !== undefined && { fuelingRate: args.fuelingRate }),
    slots: NUM_SLOTS,
    ownedStock,
    craftBudget,
  });
  const S = normalized.timeCapacityPerSlot;
  const nightsPerSlot = normalized.nightsPerSlot ?? 0;
  const axes = normalized.fuelAxes;
  const targets = [...normalized.targets];

  // Dropped before indices are assigned, so an allocation index means the same thing here and inside the solver.
  // Fuel is bounded from above only, since a zero-fuel mission is legitimate, and the per-axis bound is what
  // still holds a NaN fuel budget to the zero-fuel missions. It is also what keeps an egg the player has *none* of
  // from reading as free downstream, where a zero capacity means "ignore this axis".
  // An overnight variant is kept at zero seconds: a short ship launched at bedtime takes no waking time and
  // is still a launch, paid for with its night. Dropping it would silently turn that launch into none.
  const feasibleOptions = [...options].filter(o => {
    const nights = o.nights ?? 0;
    // A launch at T+0 that is back before the first wake-up takes no waking time either, and is still a launch.
    return (
      (ZERO_TOL < o.actualTime || nights > 0 || o.atStartSeconds !== undefined) &&
      o.actualTime <= S &&
      nights <= nightsPerSlot &&
      axes.every(ax => fuelCostOnAxis(o, ax) <= ax.capacity) &&
      (maximumCost === undefined || o.cost <= maximumCost)
    );
  });

  const assembly: Assembly = { options: feasibleOptions, recipeDag, targets, ownedStock };

  const problem: PlanProblem = { ...normalized, options: feasibleOptions };

  const solve = await loadHighs();
  // `report` is what makes the judge hand back the craft split as well as the plan, so the counts the
  // card prints are the ones the plan was selected on rather than a second solver's answer to the same
  // question. See `solver/SPEC.md` section 5.
  const { allocation, craftSplit, calendar } = solveWith(problem, solve, DEFAULT_TUNING, { report: true });
  // The solver returns a calendar with every plan and refuses to return one that fails its own verifier, so a
  // missing one is a broken seam rather than a plan to fall back from.
  if (!calendar) throw new Error('optimizer: a plan came back without a calendar');

  const alloc = new Map<number, number>();
  for (let i = 0; i < allocation.length; i++) {
    if (allocation[i] > 0) alloc.set(i, allocation[i]);
  }

  // `assembleSolution` pushes one `choiceHistory` entry per allocated option, in `alloc`'s order.
  const choiceOf = new Map([...alloc.keys()].map((option, choice) => [option, choice]));
  const slots = slotSummariesOfCalendar(feasibleOptions, calendar, sleepSeconds, choiceOf, wakeOffsetSeconds);
  return assembleFullSolution(assembly, alloc, slots, craftSplit, {
    ...(capacity && { sleepSeconds }),
    ...(wakeOffsetSeconds > 0 && { wakeOffsetSeconds }),
    ...(eventWindowSeconds > 0 && { eventWindowSeconds }),
    ...(normalized.fuelingRate !== undefined && { fuelingRate: normalized.fuelingRate }),
  });
}

function assembleFullSolution(
  a: Assembly,
  bestAlloc: Map<number, number>,
  bestSlots: SlotSummary[],
  craftSplit: CraftSplitReport | undefined,
  windows: Pick<OptimizerSolution, 'sleepSeconds' | 'wakeOffsetSeconds' | 'eventWindowSeconds' | 'fuelingRate'>
): OptimizerSolution {
  const { recipeDag, ownedStock, targets } = a;
  const { supplyByItem, totalLegendary, fuelUsed, fuelByEgg, choiceHistory } = assembleSolution(
    ownedStock,
    bestAlloc,
    a.options
  );

  const busiest = bestSlots.reduce<SlotSummary | null>(
    (best, s) => (best === null || s.loadSeconds > best.loadSeconds ? s : best),
    null
  );
  const makespan = busiest?.loadSeconds ?? 0;
  const running = busiest?.rawLoadSeconds ?? 0;

  // Absent when the judge could not re-derive the plan it had already selected. Empty maps then read
  // as "no crafts", which is what every downstream figure already means by a missing node.
  const craftByTarget = craftSplit?.byTarget ?? new Map<string, number>();
  const perTarget = targets.map(t => {
    const craftCount = craftByTarget.get(t) ?? (recipeDag.get(t)?.isLeaf ? (supplyByItem.get(t) ?? 0) : 0);
    const p = craftsToProbability(craftCount, totalLegendary, [t], recipeDag);
    return { nodeId: t, expectedCrafts: craftCount, ...p };
  });
  const primary = perTarget[0] ?? {
    bestProbability: 0,
    craftProbability: 0,
    dropProbability: 0,
    expectedCrafts: 0,
  };

  // No targets yields 0, not the empty product's 1: nothing was asked for, so nothing is achieved.
  // Every factor is a distinct target: `normalizeProblem` deduplicates the list, so an id asked for
  // twice cannot square its own probability here.
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
    ...windows,
    slots: bestSlots.length > 0 ? bestSlots : undefined,
    choiceHistory: choiceHistory,
    expectedDrops: [], // populated by index.ts
    supplyByItem: supplyByItem,
    ownedStock: new Map(ownedStock),
    recipeDag: recipeDag,
    craftPrimal: craftSplit?.byNode ?? new Map<string, number>(),
    perTarget: perTarget,
    jointProbability,
  };
}

function assembleSolution(ownedStock: Map<string, number>, bestAlloc: Map<number, number>, options: LaunchOption[]) {
  const choiceHistory: LaunchSolution[] = [];
  let fuelUsed = 0;
  const supplyByItem = new Map<string, number>(ownedStock);
  const totalLegendary = new Map<string, number>();
  const fuelByEgg = new Map<ei.Egg, number>();
  for (const [idx, k] of bestAlloc) {
    if (k <= 0) continue;
    const opt = options[idx];
    fuelUsed += k * opt.actualFuel;
    for (const [n, r] of opt.yieldVector) {
      supplyByItem.set(n, (supplyByItem.get(n) ?? 0) + k * r);
    }
    for (const [n, r] of opt.legendaryYieldVector) {
      totalLegendary.set(n, (totalLegendary.get(n) ?? 0) + k * r);
    }
    for (const [egg, rate] of opt.fuelByEgg) {
      fuelByEgg.set(egg, (fuelByEgg.get(egg) ?? 0) + k * rate);
    }
    choiceHistory.push({
      ship: opt.ship,
      actualFuel: opt.actualFuel,
      actualFuelByEgg: opt.fuelByEgg,
      actualTime: opt.actualTime,
      ...(opt.nights !== undefined && { nights: opt.nights }),
      ...(opt.variant !== undefined && { variant: opt.variant }),
      ...(opt.atStartSeconds !== undefined && { atStartSeconds: opt.atStartSeconds }),
      target: opt.target ?? '',
      targetAfxId: opt.targetAfxId,
      numShipsLaunched: k,
      supplyVector: opt.supplyVector,
      legendarySupplyVector: opt.legendaryYieldVector,
    });
  }
  return { supplyByItem, totalLegendary, fuelUsed, fuelByEgg, choiceHistory };
}
