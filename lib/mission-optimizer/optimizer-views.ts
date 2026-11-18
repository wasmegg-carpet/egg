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
// view keeps them apart, the nights it is in the air for (undefined where it does not).
function lineKey(choice: LaunchSolution, nights: number | undefined): string {
  const key = `${choice.ship.shipType}|${choice.ship.durationType}|${choice.targetAfxId}|${isDoubled(choice)}`;
  return nights === undefined ? key : `${key}|${nights}`;
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
  // Sleep windows each launch is in the air for, as the calendar flies it; 0 is a launch that is back before
  // bed, as is every launch of a plan made around the clock. Absent on a line totalled across nights.
  nights?: number;
  doubled: boolean;
}

// The plan's launches totalled over the three slots, one line per mission, target and capacity: `choiceHistory`
// can name one mission several times, as a doubled launch's `event` and `overhang` variants or from more than one
// option, and the player cannot tell those apart. `byNights` also keeps a mission's launches apart by the nights
// they are in the air for, as the card's two lists do, counting each launch where the calendar flies it, so the
// totals say what the timeline shows; the humility missions file totals across them, because the ascension
// planner flies both alike. Sorted by ship, duration, target, nights and capacity (1x first), so a list is a
// function of the plan rather than of the order the solver emitted its choices in.
export function launchTotals(solution: OptimizerSolution, { byNights = true } = {}): LaunchLine[] {
  const lines = new Map<string, LaunchLine>();
  const add = (choice: LaunchSolution, count: number, nights: number | undefined) => {
    const key = lineKey(choice, nights);
    const line = lines.get(key);
    if (line) line.numShipsLaunched += count;
    else
      lines.set(key, {
        ship: choice.ship,
        targetAfxId: choice.targetAfxId,
        numShipsLaunched: count,
        ...(nights !== undefined && { nights }),
        doubled: isDoubled(choice),
      });
  };
  // A sleep-aware plan's nights are the calendar's, launch by launch; the calendar flies every launch of the plan
  // exactly once (the solver's verifier holds it to the allocation).
  if (byNights && (solution.sleepSeconds ?? 0) > 0 && solution.slots) {
    for (const slot of solution.slots)
      for (const launch of slot.launches) add(solution.choiceHistory[launch.choice], 1, flownNights(solution, launch));
  } else {
    for (const choice of solution.choiceHistory) {
      if (choice.numShipsLaunched > 0)
        add(choice, choice.numShipsLaunched, byNights ? (choice.nights ?? 0) : undefined);
    }
  }
  return [...lines.values()].sort(
    (a, b) =>
      a.ship.shipType - b.ship.shipType ||
      a.ship.durationType - b.ship.durationType ||
      a.targetAfxId - b.targetAfxId ||
      (a.nights ?? 0) - (b.nights ?? 0) ||
      Number(a.doubled) - Number(b.doubled)
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
// entry of the run, where two entries fly the same one), the first going up at `launchAt`, in
// seconds from the start of the plan. Inside a block of identical days, or a routine of several days flown over
// and over (`repeat` > 1), the run is flown `repeat` times in all, and `launchAt` is the first time's.
export interface TimelineLaunchRow {
  kind: 'launch';
  choice: LaunchSolution;
  count: number;
  repeat: number;
  launchAt: number;
  doubled: boolean;
  // Sleep windows each launch is in the air for, as the calendar flies it: in the air at bedtime, back after a
  // night or more.
  nights: number;
}

// The start of a day on a sleep-aware plan, or of a block of days flown identically. Days count from 0. Inside a
// routine it is day `routineDay.day` (from 1) of the routine's `routineDay.of`, and `firstDay` is the day it falls
// on the first time round.
export interface TimelineDayRow {
  kind: 'day';
  firstDay: number;
  lastDay: number;
  routineDay?: { day: number; of: number };
}

// The start of a routine: the `period` days that follow, flown `times` over, from `firstDay` to `lastDay`. A
// sleep-aware plan settles into one whenever its ships take more than a day to come round, as long ones do.
export interface TimelineRoutineRow {
  kind: 'routine';
  firstDay: number;
  lastDay: number;
  period: number;
  times: number;
}

// Where the 2x capacity event ends: everything above it goes up inside the window, nothing below it does.
export interface TimelineWindowEndRow {
  kind: 'window-end';
  at: number;
}

export type TimelineRow = TimelineLaunchRow | TimelineDayRow | TimelineRoutineRow | TimelineWindowEndRow;

// The longest routine the timeline looks for. A week covers every ship's round trip at any sleep the controls
// offer; a longer one would fold too little to be worth reading as one.
const MAX_ROUTINE_DAYS = 7;

export interface SlotTimeline {
  rows: TimelineRow[];
  launchCount: number;
  // When the slot's last ship is back and, with sleep, the player is awake to collect it.
  endsAt: number;
}

export interface PlanTimeline {
  slots: SlotTimeline[];
  // Whether rows are grouped by day: the plan was laid out around a sleep window.
  byDay: boolean;
}

// The plan's slots as the player flies them, read off the calendar the solver verified: one row per run of
// identical consecutive launches, day headings on a sleep-aware plan, and a divider where the 2x capacity event
// ends. Days flown exactly like the ones before them fold away: a run of identical days into one "days n to m"
// block, and a rhythm of several days into one routine shown once, which is what keeps a month-long plan to a
// handful of lines. Every launch is counted exactly once: for each line of `launchTotals`, the rows flying its
// mission, nights and capacity have `count * repeat` summing to its `numShipsLaunched`.
export function planTimeline(solution: OptimizerSolution): PlanTimeline {
  const byDay = (solution.sleepSeconds ?? 0) > 0;
  const window = solution.eventWindowSeconds ?? 0;
  return { slots: (solution.slots ?? []).map(slot => slotTimeline(solution, slot, byDay, window)), byDay };
}

// A run of consecutive launches the player cannot tell apart (one `lineKey`), or the event window's end. `clock`
// holds each launch's time of day, to the minute, so two days fold only when they are flown at the same times.
type Segment =
  | { choice: number; key: string; count: number; launchAt: number; clock: number[]; nights: number }
  | 'window-end';

// One day of a slot, or the whole slot on a plan made around the clock.
interface Day {
  day: number;
  segments: Segment[];
  // The window closed between the previous day's last launch and this day's first, while the player was away
  // from the game, so the divider goes above this day's heading rather than inside either day.
  windowEndsBefore: boolean;
}

// What a day flies and at what time of day: two days with the same signature are flown alike, so one can stand
// for the other in a fold.
const signatureOf = (day: Day) =>
  day.segments
    .map(segment => (segment === 'window-end' ? '|' : `${segment.key}:${segment.count}@${segment.clock.join('/')}`))
    .join(',');

// A launch's time of day, in whole minutes: finer than a player reads a clock, coarse enough that float drift in a
// launch time never splits two days that are flown alike.
const clockOf = (launchAt: number) => Math.round((launchAt - Math.floor(launchAt / DAY_SECONDS) * DAY_SECONDS) / 60);

function slotTimeline(solution: OptimizerSolution, slot: SlotSummary, byDay: boolean, window: number): SlotTimeline {
  // The window opens with the plan, so a slot starts inside it. The divider goes before the first launch that
  // leaves after it closes, or under the slot's last launch when none does.
  const days: Day[] = [];
  let windowOpen = window > 0;
  for (const launch of slot.launches) {
    const closes = windowOpen && launch.launchAt > window;
    if (closes) windowOpen = false;
    const dayIndex = byDay ? Math.floor(launch.launchAt / DAY_SECONDS) : 0;
    let day = days[days.length - 1];
    if (day?.day !== dayIndex) {
      day = { day: dayIndex, segments: [], windowEndsBefore: closes };
      days.push(day);
    } else if (closes) day.segments.push('window-end');
    const nights = flownNights(solution, launch);
    const key = lineKey(solution.choiceHistory[launch.choice], nights);
    const last = day.segments[day.segments.length - 1];
    const clock = clockOf(launch.launchAt);
    if (last !== undefined && last !== 'window-end' && last.key === key) {
      last.count++;
      last.clock.push(clock);
    } else
      day.segments.push({ choice: launch.choice, key, count: 1, launchAt: launch.launchAt, clock: [clock], nights });
  }

  const signatures = days.map(signatureOf);
  const dayAt = new Map(days.map((day, i) => [day.day, i]));
  // What day `d` flies, '' for a day with no launch; undefined when it may not take part in a fold at all,
  // because the window ends in it or just before it.
  const daySignature = (d: number, first: boolean): string | undefined => {
    const i = dayAt.get(d);
    if (i === undefined) return '';
    if (days[i].segments.includes('window-end') || (!first && days[i].windowEndsBefore)) return undefined;
    return signatures[i];
  };
  // How many times over the `period` days from `start` are flown, counting the first.
  const repeatsOf = (start: number, period: number): number => {
    const pattern = Array.from({ length: period }, (_, i) => daySignature(start + i, i === 0));
    if (pattern.includes(undefined)) return 1;
    let times = 1;
    while (pattern.every((sig, i) => daySignature(start + times * period + i, false) === sig)) times++;
    return times;
  };

  const rows: TimelineRow[] = [];
  const windowEnd: TimelineWindowEndRow = { kind: 'window-end', at: window };
  const emit = (day: Day, repeat: number, heading: TimelineDayRow | null) => {
    if (heading) rows.push(heading);
    for (const segment of day.segments) {
      if (segment === 'window-end') {
        rows.push(windowEnd);
        continue;
      }
      const choice = solution.choiceHistory[segment.choice];
      rows.push({
        kind: 'launch',
        choice,
        count: segment.count,
        repeat,
        launchAt: segment.launchAt,
        doubled: isDoubled(choice),
        nights: segment.nights,
      });
    }
  };

  for (let i = 0; i < days.length; ) {
    const start = days[i].day;
    if (days[i].windowEndsBefore) rows.push(windowEnd);
    // The fold that covers the most days, the shortest routine on a tie. Without sleep there is one day and
    // nothing to fold.
    let period = 1;
    let times = 1;
    if (byDay) {
      for (let p = 1; p <= MAX_ROUTINE_DAYS; p++) {
        const t = repeatsOf(start, p);
        if (t >= 2 && p * t > period * times) [period, times] = [p, t];
      }
    }
    let next = i;
    while (next < days.length && days[next].day < start + period * times) next++;
    // Every day the fold covers, the quiet days of the last time round included: a two-day routine flown twice
    // covers four days, whichever of them holds the last launch.
    const lastDay = start + period * times - 1;
    if (!byDay) emit(days[i], 1, null);
    else if (period === 1) emit(days[i], times, { kind: 'day', firstDay: start, lastDay });
    else {
      rows.push({ kind: 'routine', firstDay: start, lastDay, period, times });
      for (let j = i; j < next && days[j].day < start + period; j++)
        emit(days[j], times, {
          kind: 'day',
          firstDay: days[j].day,
          lastDay: days[j].day,
          routineDay: { day: days[j].day - start + 1, of: period },
        });
    }
    i = next;
  }
  if (windowOpen && slot.launches.length > 0) rows.push(windowEnd);

  return { rows, launchCount: slot.launches.length, endsAt: slot.loadSeconds };
}
