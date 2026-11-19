// Flat display helpers derived from an OptimizerSolution; the recipe-tree
// builders live in optimizer-tree.ts.

import type { ei, MissionType } from '../index';
import { formatProbability } from '../index';
import type { CraftChainMetrics, RecipeTreeNode } from './optimizer-tree';
import { DAY_SECONDS } from './solver/types';
import type {
  CapacityVariant,
  LaunchSolution,
  OptimizerSolution,
  SlotLaunch,
  SlotSummary,
  TargetProbability,
} from './types';

// Below 0.01% lib's formatProbability switches to "1.5×10⁻⁶%", which a player can't act on. Pair
// it with the reading they'd actually use — the same number as odds — rather than ask lib (shared
// with other pages) to grow a second notation for one caller.
export function formatProbabilityForDisplay(p: number): string {
  const text = formatProbability(p);
  if (!Number.isFinite(p) || p <= 0 || p >= 0.0001) return text;
  return `${text} (about 1 in ${Math.round(1 / p).toLocaleString('en-US')})`;
}

export interface MissionLegendaryRow {
  ship: MissionType;
  targetAfxId: ei.ArtifactSpec.Name;
  numShipsLaunched: number;
  legendaryDrops: number;
  // Flown at 2x capacity, so each launch brings home twice what the same mission does otherwise.
  doubled: boolean;
}

// One target's worth of presentation data, resolved against that target's own
// nodeId rather than the plan's primary target.
export interface TargetView {
  nodeId: string;
  name: string;
  iconUrl: string;
  perTarget: TargetProbability;
  pCraft: number;
  lambda: number;
  craftChainTree: RecipeTreeNode<CraftChainMetrics> | null;
  missionLegendarySources: MissionLegendaryRow[];
  dropDataIsSparse: boolean;
}

// Whether a `choiceHistory` entry flies at 2x capacity. `event` and `overhang` exist only to make "launched
// inside the window" linear for the solver (`types.ts`); the player flies both the same way, so every view
// folds them into one.
export function isDoubled(choice: { variant?: CapacityVariant }): boolean {
  return choice.variant === 'event' || choice.variant === 'overhang';
}

// What the player can tell two launches apart by: the mission, its target, whether it flies at 2x and, where a
// view keeps them apart, whether it is in the air at bedtime (undefined where it does not). Whether, not how many
// nights: the views mark a launch with one dot, green awake and indigo overnight, so a one-night and a two-night
// launch of a mission read alike and are one line.
function lineKey(choice: LaunchSolution, overnight: boolean | undefined): string {
  const key = `${choice.ship.shipType}|${choice.ship.durationType}|${choice.targetAfxId}|${isDoubled(choice)}`;
  return overnight === undefined ? key : `${key}|${overnight}`;
}

// The nights a slot launch is in the air for, as the calendar flies it (`SlotLaunch.nights`). A solution from
// before that field was carried falls back on the variant's own count.
const flownNights = (solution: OptimizerSolution, launch: SlotLaunch): number =>
  launch.nights ?? solution.choiceHistory[launch.choice].nights ?? 0;

// One line of a launch list: a mission, how many of it, and the two things that change how it is flown.
export interface LaunchLine {
  ship: MissionType;
  targetAfxId: ei.ArtifactSpec.Name;
  numShipsLaunched: number;
  // Whether each launch is in the air when the player goes to sleep, as the calendar flies it; false is a launch
  // that is back before bed, as is every launch of a plan made around the clock. Absent on a line totalled across
  // both.
  overnight?: boolean;
  doubled: boolean;
}

// The plan's launches totalled over the three slots, one line per mission, target and capacity: `choiceHistory`
// can name one mission several times, as a doubled launch's `event` and `overhang` variants or from more than one
// option, and the player cannot tell those apart. `byOvernight` also keeps a mission's launches apart by whether
// they are in the air at bedtime, as the card's two lists do, counting each launch where the calendar flies it, so
// the totals say what the timeline shows; how many nights a launch is in the air for is not a line of its own. The
// humility missions file totals across both, because the ascension planner flies them alike. Sorted awake before
// overnight, then doubled (2x) before 1x, then by ship, duration and target, so a list is a function of the plan
// rather than of the order the solver emitted its choices in.
export function launchTotals(solution: OptimizerSolution, { byOvernight = true } = {}): LaunchLine[] {
  const lines = new Map<string, LaunchLine>();
  const add = (choice: LaunchSolution, count: number, overnight: boolean | undefined) => {
    const key = lineKey(choice, overnight);
    const line = lines.get(key);
    if (line) line.numShipsLaunched += count;
    else
      lines.set(key, {
        ship: choice.ship,
        targetAfxId: choice.targetAfxId,
        numShipsLaunched: count,
        ...(overnight !== undefined && { overnight }),
        doubled: isDoubled(choice),
      });
  };
  // A sleep-aware plan's nights are the calendar's, launch by launch; the calendar flies every launch of the plan
  // exactly once (the solver's verifier holds it to the allocation).
  if (byOvernight && (solution.sleepSeconds ?? 0) > 0 && solution.slots) {
    for (const slot of solution.slots)
      for (const launch of slot.launches)
        add(solution.choiceHistory[launch.choice], 1, flownNights(solution, launch) > 0);
  } else {
    for (const choice of solution.choiceHistory) {
      if (choice.numShipsLaunched > 0)
        add(choice, choice.numShipsLaunched, byOvernight ? (choice.nights ?? 0) > 0 : undefined);
    }
  }
  return [...lines.values()].sort(
    (a, b) =>
      Number(a.overnight ?? false) - Number(b.overnight ?? false) ||
      Number(b.doubled) - Number(a.doubled) ||
      a.ship.shipType - b.ship.shipType ||
      a.ship.durationType - b.ship.durationType ||
      a.targetAfxId - b.targetAfxId
  );
}

// One row per mission, target and capacity. Where a legendary comes from does not depend on when the ship left,
// so a mission's daytime and overnight launches are one source; whether it flew doubled changes what it brings
// home, so a mission flown at both capacities is two.
export function computeMissionLegendaryRows(solution: OptimizerSolution, rootId: string): MissionLegendaryRow[] {
  const rows = new Map<string, MissionLegendaryRow>();
  for (const choice of solution.choiceHistory) {
    const key = lineKey(choice, undefined);
    const legendaryDrops = choice.numShipsLaunched * (choice.legendarySupplyVector.get(rootId) ?? 0);
    const row = rows.get(key);
    if (row) {
      row.numShipsLaunched += choice.numShipsLaunched;
      row.legendaryDrops += legendaryDrops;
    } else {
      rows.set(key, {
        ship: choice.ship,
        targetAfxId: choice.targetAfxId,
        numShipsLaunched: choice.numShipsLaunched,
        legendaryDrops,
        doubled: isDoubled(choice),
      });
    }
  }
  return [...rows.values()].filter(row => row.legendaryDrops > 0.0001);
}

// ---------------------------------------------------------------------------
// The per-slot timeline
// ---------------------------------------------------------------------------

// A run of launches the player cannot tell apart, flown back to back: `count` of `choice`'s mission (the first
// entry of the run, where two entries fly the same one), the first going up at `launchAt`, in seconds from the
// start of the plan.
export interface TimelineLaunchRow {
  kind: 'launch';
  choice: LaunchSolution;
  count: number;
  launchAt: number;
  doubled: boolean;
  // Whether each launch of the run is in the air when the player goes to sleep, as the calendar flies it. A run
  // is all one or all the other, though its launches may be in the air for different numbers of nights.
  overnight: boolean;
}

// Where the 2x capacity event ends: everything above it goes up inside the window, nothing below it does.
export interface TimelineWindowEndRow {
  kind: 'window-end';
  at: number;
}

export type TimelineRow = TimelineLaunchRow | TimelineWindowEndRow;

export interface SlotTimeline {
  rows: TimelineRow[];
  launchCount: number;
  // When the slot's last ship is back and, with sleep, the player is awake to collect it.
  endsAt: number;
}

export interface PlanTimeline {
  slots: SlotTimeline[];
}

// The plan's slots as the player flies them, read off the calendar the solver verified: every launch of every day,
// in order, one row per run of identical consecutive launches, and a divider where the 2x capacity event ends.
// Nothing is folded and days get no headings; the T+ times alone say where one day ends and the next begins. On a
// sleep-aware plan a run stops at the end of a day, so a row never spans a night. Every launch is counted exactly
// once: for each line of `launchTotals`, the rows flying its mission, overnight mark and capacity have `count`
// summing to its `numShipsLaunched`.
export function planTimeline(solution: OptimizerSolution): PlanTimeline {
  const byDay = (solution.sleepSeconds ?? 0) > 0;
  const window = solution.eventWindowSeconds ?? 0;
  return { slots: (solution.slots ?? []).map(slot => slotTimeline(solution, slot, byDay, window)) };
}

// A launch time on the player's regular day: seconds since the wake-up the plan starts `wakeOffsetSeconds` after, so
// a plan's days break at its wake-ups (`solver/SPEC.md` section 17). The plan's own time when it starts at wake-up.
export const sinceWake = (solution: OptimizerSolution, launchAt: number) =>
  launchAt + (solution.wakeOffsetSeconds ?? 0);

function slotTimeline(solution: OptimizerSolution, slot: SlotSummary, byDay: boolean, window: number): SlotTimeline {
  const rows: TimelineRow[] = [];
  const windowEnd: TimelineWindowEndRow = { kind: 'window-end', at: window };
  // The window opens with the plan, so a slot starts inside it. The divider goes before the first launch that
  // leaves after it closes, which may be the first of the next day, or under the slot's last launch when none does.
  let windowOpen = window > 0;
  // The run the next launch may join: the row it is building, and the day (0 around the clock) and the line it
  // is of. A divider ends it, so a run never straddles the window's end.
  let run: { row: TimelineLaunchRow; key: string; day: number } | null = null;
  for (const launch of slot.launches) {
    if (windowOpen && launch.launchAt > window) {
      windowOpen = false;
      rows.push(windowEnd);
      run = null;
    }
    const day = byDay ? Math.floor(sinceWake(solution, launch.launchAt) / DAY_SECONDS) : 0;
    const choice = solution.choiceHistory[launch.choice];
    const overnight = flownNights(solution, launch) > 0;
    const key = lineKey(choice, overnight);
    if (run && run.key === key && run.day === day) run.row.count++;
    else {
      const row: TimelineLaunchRow = {
        kind: 'launch',
        choice,
        count: 1,
        launchAt: launch.launchAt,
        doubled: isDoubled(choice),
        overnight,
      };
      rows.push(row);
      run = { row, key, day };
    }
  }
  if (windowOpen && slot.launches.length > 0) rows.push(windowEnd);

  return { rows, launchCount: slot.launches.length, endsAt: slot.loadSeconds };
}
