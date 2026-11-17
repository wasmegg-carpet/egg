// Flat display helpers derived from an OptimizerSolution; the recipe-tree
// builders live in optimizer-tree.ts.

import type { ei, MissionType } from '../index';
import { formatProbability } from '../index';
import type { CraftChainMetrics, RecipeTreeNode } from './optimizer-tree';
import { DAY_SECONDS } from './solver/types';
import type { CapacityVariant, LaunchSolution, OptimizerSolution, SlotSummary, TargetProbability } from './types';

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

// Invert P(drop) = 1 - e^(-lambda); 0 outside (0, 1).
export function lambdaFromDropProbability(p: number): number {
  return p > 0 && p < 1 ? -Math.log(1 - p) : 0;
}

// Whether a `choiceHistory` entry flies at 2x capacity. `event` and `overhang` exist only to make "launched
// inside the window" linear for the solver (`types.ts`); the player flies both the same way, so every view
// folds them into one.
export function isDoubled(choice: { variant?: CapacityVariant }): boolean {
  return choice.variant === 'event' || choice.variant === 'overhang';
}

const missionKey = (ship: MissionType, targetAfxId: ei.ArtifactSpec.Name) =>
  `${ship.shipType}|${ship.durationType}|${targetAfxId}`;

// One line of a launch list: a mission, how many of it, and the two things that change how it is flown.
export interface LaunchLine {
  ship: MissionType;
  targetAfxId: ei.ArtifactSpec.Name;
  numShipsLaunched: number;
  // Sleep windows each launch flies through; 0 is a launch flown while awake, as is every launch of a plan made
  // around the clock.
  nights: number;
  doubled: boolean;
}

// The plan's totals, one line per mission, nights and capacity: the list the card shows beside the timeline.
// `choiceHistory` can name one mission several times, as its `event` and `overhang` variants or from more than
// one option, and the player cannot tell those apart, so they are one line here. Sorted by ship, duration and
// target, a mission's daytime line before its overnight ones and its 1x line before its 2x one.
export function launchTotals(solution: OptimizerSolution): LaunchLine[] {
  const lines = new Map<string, LaunchLine>();
  for (const choice of solution.choiceHistory) {
    if (!(choice.numShipsLaunched > 0)) continue;
    const nights = choice.nights ?? 0;
    const doubled = isDoubled(choice);
    const key = `${missionKey(choice.ship, choice.targetAfxId)}|${nights}|${doubled}`;
    const line = lines.get(key);
    if (line) line.numShipsLaunched += choice.numShipsLaunched;
    else
      lines.set(key, {
        ship: choice.ship,
        targetAfxId: choice.targetAfxId,
        numShipsLaunched: choice.numShipsLaunched,
        nights,
        doubled,
      });
  }
  return [...lines.values()].sort(
    (a, b) =>
      a.ship.shipType - b.ship.shipType ||
      a.ship.durationType - b.ship.durationType ||
      a.targetAfxId - b.targetAfxId ||
      a.nights - b.nights ||
      Number(a.doubled) - Number(b.doubled)
  );
}

// One row per mission, target and capacity. A sleep-aware plan can launch the same mission both by day and
// overnight, as two entries of `choiceHistory`; where a legendary comes from does not depend on when the ship
// left, so those are one source here. Whether it flew doubled does change what it brings home, so a mission flown
// at both capacities is two rows.
export function computeMissionLegendaryRows(solution: OptimizerSolution, rootId: string): MissionLegendaryRow[] {
  const rows = new Map<string, MissionLegendaryRow>();
  for (const choice of solution.choiceHistory) {
    const doubled = isDoubled(choice);
    const key = `${missionKey(choice.ship, choice.targetAfxId)}|${doubled}`;
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
        doubled,
      });
    }
  }
  return [...rows.values()].filter(row => row.legendaryDrops > 0.0001);
}

export function legendaryCraftProbabilityOf(solution: OptimizerSolution, rootId: string): number {
  return solution.recipeDag.get(rootId)?.legendaryCraftProbability ?? 0;
}

// ---------------------------------------------------------------------------
// The per-slot timeline
// ---------------------------------------------------------------------------

// A run of identical launches flown back to back: `count` of `choice`, the first going up at `launchAt`, in
// seconds from the start of the plan. Inside a block of identical days, or a routine of several days flown over
// and over (`repeat` > 1), the run is flown `repeat` times in all, and `launchAt` is the first time's.
export interface TimelineLaunchRow {
  kind: 'launch';
  choice: LaunchSolution;
  count: number;
  repeat: number;
  launchAt: number;
  doubled: boolean;
  // Sleep windows each launch flies through: launched before bed, back after a night or more.
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
  eventWindowSeconds: number;
}

type Token = { kind: 'launch'; choice: number; launchAt: number; doubled: boolean } | { kind: 'window-end' };

interface Run {
  choice: number;
  doubled: boolean;
  count: number;
  launchAt: number;
}

type Segment = Run | 'window-end';

interface DayGroup {
  day: number;
  tokens: Token[];
  // The window closes between the previous group and this one, so the divider goes above this group's heading.
  windowEndsBefore: boolean;
}

// The plan's slots as the player flies them, read off the calendar the solver verified: one row per run of
// identical consecutive launches, day headings on a sleep-aware plan, and a divider where the 2x capacity event
// ends. Days flown exactly like the ones before them fold away: a run of identical days into one "days n to m"
// block, and a rhythm of several days into one routine shown once, which is what keeps a month-long plan to a
// handful of lines. Every launch is counted exactly once: for each `choiceHistory` entry, its rows'
// `count * repeat` sum to its `numShipsLaunched`.
export function planTimeline(solution: OptimizerSolution): PlanTimeline {
  const byDay = (solution.sleepSeconds ?? 0) > 0;
  const window = solution.eventWindowSeconds ?? 0;
  return {
    slots: (solution.slots ?? []).map(slot => slotTimeline(solution, slot, byDay, window)),
    byDay,
    eventWindowSeconds: window,
  };
}

function slotTimeline(solution: OptimizerSolution, slot: SlotSummary, byDay: boolean, window: number): SlotTimeline {
  const launches = slot.launches;
  // The window opens with the plan, so a slot with anything in it starts inside it. The divider goes before the
  // first launch that leaves after it closes, or under the last launch when none does.
  const tokens: Token[] = [];
  let divided = !(window > 0) || launches.length === 0;
  for (const launch of launches) {
    if (!divided && launch.launchAt > window) {
      tokens.push({ kind: 'window-end' });
      divided = true;
    }
    tokens.push({ kind: 'launch', ...launch });
  }
  if (!divided) tokens.push({ kind: 'window-end' });

  // Split into days. A divider between the last launch of one day and the first of the next goes between the two
  // days rather than inside either: the window closed while the player was away from the game.
  const groups: DayGroup[] = [];
  let pendingEnd = false;
  for (const token of tokens) {
    if (token.kind === 'window-end') {
      pendingEnd = true;
      continue;
    }
    const day = byDay ? Math.floor(token.launchAt / DAY_SECONDS) : 0;
    const current = groups[groups.length - 1];
    if (current && current.day === day) {
      if (pendingEnd) current.tokens.push({ kind: 'window-end' });
      current.tokens.push(token);
    } else {
      groups.push({ day, tokens: [token], windowEndsBefore: pendingEnd });
    }
    pendingEnd = false;
  }

  const rows: TimelineRow[] = [];
  const windowEnd: TimelineWindowEndRow = { kind: 'window-end', at: window };
  const segments = groups.map(group => runsOf(group.tokens));
  const signatures = segments.map(signatureOf);
  const groupOnDay = new Map(groups.map((group, i) => [group.day, i]));
  // What day `day` flies, '' for a day with no launch; undefined when it may not take part in a fold at all,
  // because the window ends in it or just before it.
  const daySignature = (day: number, first: boolean): string | undefined => {
    const i = groupOnDay.get(day);
    if (i === undefined) return '';
    if (segments[i].includes('window-end') || (!first && groups[i].windowEndsBefore)) return undefined;
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
  const emitDay = (g: number, repeat: number, day: TimelineDayRow | null) => {
    if (day) rows.push(day);
    for (const segment of segments[g]) {
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
        doubled: segment.doubled,
        nights: choice.nights ?? 0,
      });
    }
  };

  for (let g = 0; g < groups.length; ) {
    const start = groups[g].day;
    if (groups[g].windowEndsBefore) rows.push(windowEnd);
    // The fold that covers the most days, the shortest routine on a tie. Without sleep there is one group and
    // nothing to fold.
    let period = 1;
    let times = 1;
    if (byDay) {
      for (let p = 1; p <= MAX_ROUTINE_DAYS; p++) {
        const t = repeatsOf(start, p);
        if (t >= 2 && p * t > period * times) [period, times] = [p, t];
      }
    }
    const end = start + period * times;
    let next = g;
    while (next < groups.length && groups[next].day < end) next++;
    const lastDay = groups[next - 1].day;
    if (!byDay) emitDay(g, 1, null);
    else if (period === 1) emitDay(g, times, { kind: 'day', firstDay: start, lastDay });
    else {
      rows.push({ kind: 'routine', firstDay: start, lastDay, period, times });
      for (let i = g; i < next && groups[i].day < start + period; i++)
        emitDay(i, times, {
          kind: 'day',
          firstDay: groups[i].day,
          lastDay: groups[i].day,
          routineDay: { day: groups[i].day - start + 1, of: period },
        });
    }
    g = next;
  }
  if (pendingEnd) rows.push(windowEnd);

  return { rows, launchCount: launches.length, endsAt: slot.loadSeconds };
}

// Consecutive launches of one entry at one capacity, as one run; the window's end breaks a run.
function runsOf(tokens: Token[]): Segment[] {
  const runs: Segment[] = [];
  for (const token of tokens) {
    if (token.kind === 'window-end') {
      runs.push('window-end');
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && last !== 'window-end' && last.choice === token.choice && last.doubled === token.doubled) last.count++;
    else runs.push({ choice: token.choice, doubled: token.doubled, count: 1, launchAt: token.launchAt });
  }
  return runs;
}

// What a day flies, without when: two days with the same signature are the same routine.
const signatureOf = (runs: Segment[]) =>
  runs.map(run => (run === 'window-end' ? '|' : `${run.choice}:${run.doubled}:${run.count}`)).join(',');
