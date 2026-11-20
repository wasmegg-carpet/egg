// Laying a plan out as each slot's timeline, the calendar every plan is returned with. With a sleep window that
// is real work: per slot, which waking window each daytime launch is flown in and when each overnight ship goes,
// as launch times the verifier then checks, and what does not fit is trimmed, one launch at a time, by the
// solver's own judge (SPEC.md section 10). Without one it is exact and trivial: a slot's launches back to back,
// doubled ones first (SPEC.md section 12). Either way every launch that goes up inside the 2x window is then flown
// doubled (SPEC.md section 16).

import type { CapacityVariant, LaunchOption } from '../types';
import type { DaySchedule } from './days';
import { nCol, type Layout } from './milp';
import type { DoubledVariant, Model } from './model';
import {
  DAY_SECONDS,
  INF,
  type CalendarLaunch,
  type LayoutStats,
  type MilpLimits,
  type MilpModel,
  type MilpSolve,
  type SleepWindow,
} from './types';
import { VERIFY_TOL_SECONDS, doubledCopiesOnMenu, padFault, slotFault, startChain, type TimedLaunch } from './verify';
import { schedulePad, type PadItem } from './pad';

// A node limit and never a timeout, for SPEC.md section 7's reason: the layout decides what is trimmed, so a
// clock here would make the plan a function of machine load.
export const LAYOUT_LIMITS: MilpLimits = { maxNodes: 1000, relGap: 1e-6 };

// The layout MILP's limits on a slot's alternative layouts around the 2x window (`ATTEMPTS` after the first, and every
// fold), which the judge weighs against the first (SPEC.md section 14). Each alternative used to get the full 1000
// nodes, and most of a combined plan's layout time went there: a layout MILP that cannot place everything usually
// runs to its node limit, at one to three seconds a slot attempt. Measured over the forty-seed list with 8 hours of
// sleep and a 48-hour window, 200 nodes cut post-MILP time from 62 to 42 seconds and total from 232 to 214 (medians
// of three interleaved runs), with mean delivered log10(joint) -8.5623 to -8.5624 (one seed 0.0033 better, one 0.0038
// worse); smaller budgets saved little more. It is a trade, not free: with 12 hours and a window straddling the horizon two seeds lost up to 0.015 and
// the mean 0.0005. A slot without a doubled launch has only the first layout, so sleep-only plans are untouched.
export const ALTERNATIVE_LAYOUT_LIMITS: MilpLimits = { maxNodes: 200, relGap: 1e-6 };

// The layout MILP works in hours: seconds put a 16-hour window at 57600 against unit head coefficients.
const HOUR = 3600;

// Slack on the layout's own seconds arithmetic. Ten times inside the verifier's `VERIFY_TOL_SECONDS`, so
// nothing the layout accepts can reach the verifier's edge.
const LAYOUT_TOL = 1e-7;

// HiGHS accepts an integer column within 1e-6 of a whole number, so a rounded layout can over-fill a day by a
// few hundredths of a second. Taken off every day row on a second solve, only once the first one's rounded
// answer failed the exact re-check: always taking it would forbid exact fits, sixteen one-hour launches in a
// sixteen-hour day among them, and can make a day whose overnight ships already fill it exactly infeasible.
const MARGIN_SECONDS = 1;

// The one-night stand-in for a night nothing flies through.
const NULL_CONNECTOR = -1;

// A sleep window in a slot's timeline, and what crosses it: an overnight launch of class `cls`, or nothing.
// `flex` is the launch's waking seconds outside the whole windows it flies through, split between the window
// it leaves (`head`, before bed) and the one it lands in.
interface Connector {
  cls: number;
  nights: number;
  flex: number;
  // A doubled ship placed first for the 2x window, which may take off as early as its day allows: before
  // bedtime by more than its flex, landing at the next wake-up with waking time of its last day left unused.
  // Valid, since its block, `waking seconds + nights * S`, then ends before that wake-up (SPEC.md section 13).
  early?: boolean;
}

interface SlotContext {
  classSeconds: readonly number[];
  classNights: readonly number[];
  // Whether a class flies doubled (`event` or `overhang`), which the layout puts first so it starts inside the 2x
  // window (SPEC.md section 13). All false without a window, and then nothing below orders by it.
  doubled: readonly boolean[];
  // Of those, the `overhang` classes, which go after the `event` ones, as the window rows' argument has them.
  overhang: readonly boolean[];
  day: DaySchedule;
  solve: MilpSolve;
  // Drops one launch of one of `candidates` from the plan, chosen by the judge, and returns its class.
  drop: (candidates: readonly number[]) => number;
  // With the fueling pad: what the judge makes of the plan after one drop from each of `steps` in turn, each the drop
  // `drop` would make there, and the classes those drops come from, without making any. Absent without the pad.
  peek?: (steps: readonly (readonly number[])[]) => { value: number; classes: number[] };
  stats: LayoutStats;
  // The limits of this slot's layout MILPs: `LAYOUT_LIMITS`, or `ALTERNATIVE_LAYOUT_LIMITS` for an alternative.
  limits: MilpLimits;
}

interface ClassLaunch {
  cls: number;
  launchAt: number;
  // The group this launch is flown as, when it has to be one in particular: a 1x launch inside the 2x window whose
  // class has groups the menu could have doubled there and groups it could not (SPEC.md section 16).
  group?: number;
}

// Where an order of connectors starts. `largest`, the usual: the first segment is a whole waking window with no
// landing in it, so the largest flex goes first. With a wake offset the first segment starts busy, as if a landing
// of `wakeOffsetSeconds` ran into it (SPEC.md section 17), and the usual order can fail there where another stands:
// `small` alternates from the smallest instead, as a long landing calls for, and `smallest` flies the smallest first
// and then the usual alternation, so the landing after it is as short as it can be.
type OrderStart = 'largest' | 'small' | 'smallest';

// Ordered by flex, alternately largest and smallest so a long landing is followed by a short take-off, and, when
// `smallestLast`, with the smallest held back to the end so nothing lands past the final wake-up into a short tail.
function alternating(conns: Connector[], smallestLast: boolean, start: OrderStart = 'largest'): Connector[] {
  const sorted = conns.sort((a, b) => a.flex - b.flex || a.cls - b.cls);
  const first = start === 'smallest' ? sorted.shift() : undefined;
  const last = smallestLast ? sorted.shift() : undefined;
  const out: Connector[] = first ? [first] : [];
  for (let lo = 0, hi = sorted.length - 1, big = start !== 'small'; lo <= hi; big = !big)
    out.push(big ? sorted[hi--] : sorted[lo++]);
  if (last) out.push(last);
  return out;
}

// Each overnight launch, then null connectors until the nights sum to the slot's, in `alternating` order. With
// `doubledFirst`, the doubled overnight ships go first — the `event` ones, then the `overhang`, the order the window
// rows' argument flies them in, each alternating among themselves from the largest flex (the one that can take off
// earliest in its day) — and everything else follows in the usual order, so the ships that must start inside the
// 2x window take the first nights (SPEC.md section 13). A heuristic either way: another order may place more,
// which makes what this layout places a lower bound on what fits, never an over-statement. `start` says where the
// first run starts (`OrderStart`).
export function connectorsOf(
  counts: readonly number[],
  ctx: Pick<SlotContext, 'classSeconds' | 'classNights' | 'day'> & Partial<Pick<SlotContext, 'doubled' | 'overhang'>>,
  doubledFirst = false,
  start: OrderStart = 'largest'
): Connector[] {
  const all: Connector[] = [];
  let nights = 0;
  for (let c = 0; c < counts.length; c++) {
    const m = ctx.classNights[c];
    if (m <= 0) continue;
    for (let i = 0; i < counts[c]; i++) {
      all.push({ cls: c, nights: m, flex: ctx.classSeconds[c] - (m - 1) * ctx.day.wakingSeconds });
      nights += m;
    }
  }
  for (; nights < ctx.day.nights; nights++) all.push({ cls: NULL_CONNECTOR, nights: 1, flex: 0 });
  const isDoubled = (conn: Connector) =>
    doubledFirst && conn.cls !== NULL_CONNECTOR && ctx.doubled?.[conn.cls] === true;
  const isOverhang = (conn: Connector) => isDoubled(conn) && ctx.overhang?.[conn.cls] === true;
  const runs = [
    all.filter(conn => isDoubled(conn) && !isOverhang(conn)),
    all.filter(isOverhang),
    all.filter(conn => !isDoubled(conn)),
  ].filter(run => run.length > 0);
  // Only the last run holds its smallest back for the tail; without a doubled ship that is the one usual order.
  // In either order a doubled ship takes off as early as its day allows.
  for (const conn of all) if (conn.cls !== NULL_CONNECTOR && ctx.doubled?.[conn.cls] === true) conn.early = true;
  return runs.flatMap((run, r) => alternating(run, r === runs.length - 1, r === 0 ? start : 'largest'));
}

// The connector orders a slot tries, in turn: the usual one, and with a wake offset the two that start from small
// flexes, for a first segment that begins busy (`OrderStart`). Without an offset, the usual one alone.
function connectorOrders(
  counts: readonly number[],
  ctx: Pick<SlotContext, 'classSeconds' | 'classNights' | 'day'> & Partial<Pick<SlotContext, 'doubled' | 'overhang'>>,
  doubledFirst = false
): Connector[][] {
  const usual = connectorsOf(counts, ctx, doubledFirst);
  if (!(ctx.day.wakeOffsetSeconds > 0)) return [usual];
  return [usual, connectorsOf(counts, ctx, doubledFirst, 'small'), connectorsOf(counts, ctx, doubledFirst, 'smallest')];
}

// What of segment `j` the plan's start has already taken: the first segment's first `wakeOffsetSeconds`, a busy
// block before any launch when the plan starts after wake-up (SPEC.md section 17), and nothing anywhere else.
function busyIn(j: number, day: DaySchedule): number {
  return j === 0 ? day.wakeOffsetSeconds : 0;
}

// Segment `j` is the waking time between connector `j - 1` landing and connector `j` leaving, less the busy block
// in the first; the last one is the trailing partial day.
function capacityOf(j: number, conns: readonly Connector[], day: DaySchedule): number {
  return (j < conns.length ? day.wakingSeconds : day.tailSeconds) - busyIn(j, day);
}

// Each connector's head, given the daytime seconds `used` in each segment, or the first segment that cannot
// hold its share. Taking every head as large as its segment allows is exact rather than greedy: a larger head
// only shortens the landing that the next segment has to absorb. The first segment also holds the busy block.
function chainHeads(
  conns: readonly Connector[],
  used: readonly number[],
  day: DaySchedule
): { heads: number[]; fail: number } {
  const W = day.wakingSeconds;
  const heads: number[] = [];
  let after = 0;
  for (let j = 0; j < conns.length; j++) {
    const conn = conns[j];
    const afterCap = j === conns.length - 1 ? day.tailSeconds : W;
    const lo = Math.max(0, conn.flex - afterCap);
    const h = Math.min(conn.early ? W : conn.flex, W, W - after - used[j] - busyIn(j, day));
    if (h < lo - LAYOUT_TOL) return { heads, fail: j };
    const head = Math.max(h, lo);
    heads.push(head);
    after = Math.max(0, conn.flex - head);
  }
  if (after + used[conns.length] + busyIn(conns.length, day) > day.tailSeconds + LAYOUT_TOL) {
    return { heads, fail: conns.length };
  }
  return { heads, fail: -1 };
}

// Daytime launches per daytime class (`daytime[d]`) per segment.
type Placement = number[][];

function usedOf(placed: Placement, daytime: readonly number[], ctx: SlotContext, segments: number): number[] {
  const used = new Array<number>(segments).fill(0);
  daytime.forEach((c, d) => {
    for (let j = 0; j < segments; j++) used[j] += placed[d][j] * ctx.classSeconds[c];
  });
  return used;
}

function placedSeconds(placed: Placement, daytime: readonly number[], ctx: SlotContext): number {
  let total = 0;
  daytime.forEach((c, d) => {
    for (const n of placed[d]) total += n * ctx.classSeconds[c];
  });
  return total;
}

// Which segments a daytime class may go in, in the order it tries them. `inOrder`: every segment, earliest first.
// Around the 2x window (SPEC.md section 13), a normal class tries the segments after the last doubled ship first, so
// 1x launches do not push a doubled ship's take-off back: under `wrap` it then falls back on the ones before it, under
// `strict` it never goes there (section 14). Doubled classes, and every class on a slot without a doubled ship, take
// the segments in order.
type Around = 'inOrder' | 'wrap' | 'strict';

function segmentOrder(conns: readonly Connector[], around: Around): { doubled: number[]; normal: number[] } {
  const inOrder = Array.from({ length: conns.length + 1 }, (_, j) => j);
  let lastDoubled = -1;
  if (around !== 'inOrder') conns.forEach((conn, j) => conn.early && (lastDoubled = j));
  const after = inOrder.slice(lastDoubled + 1);
  const normal = around === 'strict' ? after : [...after, ...inOrder.slice(0, lastDoubled + 1)];
  return { doubled: inOrder, normal };
}

// Largest first, each into the earliest segment that takes it with the overnight chain still standing, among the
// segments `around` allows it. Exact in seconds, and when it places everything it is optimal and no MILP is needed.
function greedyFill(
  conns: readonly Connector[],
  daytime: readonly number[],
  counts: readonly number[],
  ctx: SlotContext,
  around: Around = 'inOrder'
): Placement {
  const segments = conns.length + 1;
  const used = new Array<number>(segments).fill(0);
  const order = segmentOrder(conns, around);
  return daytime.map(c => {
    const s = ctx.classSeconds[c];
    const row = new Array<number>(segments).fill(0);
    let remaining = counts[c];
    for (const j of ctx.doubled[c] ? order.doubled : order.normal) {
      if (remaining <= 0) break;
      const base = used[j];
      let lo = 0;
      let hi = Math.min(remaining, Math.max(0, Math.floor((capacityOf(j, conns, ctx.day) - base) / s + 1e-9)));
      // The chain only gets harder as a segment fills, so the count that still stands is found by bisection.
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        used[j] = base + mid * s;
        if (chainHeads(conns, used, ctx.day).fail < 0) lo = mid;
        else hi = mid - 1;
      }
      used[j] = base + lo * s;
      row[j] = lo;
      remaining -= lo;
    }
    return row;
  });
}

// Integer `x[d][j]`, launches of daytime class `daytime[d]` in segment `j`, and continuous `head[j]`, hours
// connector `j` flies before bed. One row per segment (its daytime launches, its own head and the previous
// connector's landing within its window) and one per class (no more than the slot has). Maximizes the
// waking time placed. Under `strict` the doubled classes are pinned where `pinned` has them, the greedy's placement,
// so the seconds it maximizes cannot buy a 1x launch with a doubled one (SPEC.md section 14).
function layoutMilp(
  conns: readonly Connector[],
  daytime: readonly number[],
  counts: readonly number[],
  ctx: SlotContext,
  margin: number,
  around: Around,
  pinned: Placement
): { model: MilpModel; upper: Float64Array } {
  const K = conns.length;
  const segments = K + 1;
  const W = ctx.day.wakingSeconds;
  const headBase = daytime.length * segments;
  const columnCount = headBase + K;
  const columnLower = new Float64Array(columnCount);
  const columnUpper = new Float64Array(columnCount);
  const columnIsInteger = new Uint8Array(columnCount);
  const objective = new Float64Array(columnCount);
  // Under `strict` a normal class has no column worth anything before the last doubled ship (SPEC.md section 14).
  const allowed = segmentOrder(conns, around === 'strict' ? 'strict' : 'inOrder');
  daytime.forEach((c, d) => {
    const s = ctx.classSeconds[c];
    const may = new Set(ctx.doubled[c] ? allowed.doubled : allowed.normal);
    for (let j = 0; j < segments; j++) {
      const col = d * segments + j;
      columnUpper[col] = may.has(j) ? Math.min(counts[c], Math.floor(capacityOf(j, conns, ctx.day) / s + 1e-9)) : 0;
      if (around === 'strict' && ctx.doubled[c]) columnLower[col] = columnUpper[col] = pinned[d][j];
      columnIsInteger[col] = 1;
      objective[col] = s / HOUR;
    }
  });
  for (let j = 0; j < K; j++) {
    const afterCap = j === K - 1 ? ctx.day.tailSeconds : W;
    columnLower[headBase + j] = Math.max(0, conns[j].flex - afterCap) / HOUR;
    columnUpper[headBase + j] = Math.min(conns[j].flex, W) / HOUR;
  }

  const rowNames: string[] = [];
  const rowLower: number[] = [];
  const rowUpper: number[] = [];
  const offsets: number[] = [];
  const indices: number[] = [];
  const values: number[] = [];
  const row = (name: string, terms: [number, number][], up: number) => {
    rowNames.push(name);
    rowLower.push(-INF);
    rowUpper.push(up);
    offsets.push(indices.length);
    for (const [col, v] of terms.sort((a, b) => a[0] - b[0])) {
      indices.push(col);
      values.push(v);
    }
  };
  for (let j = 0; j < segments; j++) {
    const terms: [number, number][] = daytime.map((c, d) => [d * segments + j, ctx.classSeconds[c] / HOUR]);
    if (j < K) terms.push([headBase + j, 1]);
    if (j > 0) terms.push([headBase + j - 1, -1]);
    const landing = j > 0 ? conns[j - 1].flex : 0;
    row(`day_j${j}`, terms, (capacityOf(j, conns, ctx.day) - landing - margin) / HOUR);
  }
  daytime.forEach((c, d) => {
    const terms: [number, number][] = [];
    for (let j = 0; j < segments; j++) terms.push([d * segments + j, 1]);
    row(`count_c${c}`, terms, counts[c]);
  });

  return {
    model: {
      columnCount,
      columnLower,
      columnUpper,
      columnIsInteger,
      objective,
      rowCount: rowNames.length,
      rowNames,
      rowLower: Float64Array.from(rowLower),
      rowUpper: Float64Array.from(rowUpper),
      offsets: Int32Array.from(offsets),
      indices: Int32Array.from(indices),
      values: Float64Array.from(values),
    },
    upper: columnUpper,
  };
}

// The MILP's integer columns, rounded and clamped back inside their bounds and the class counts; null when no
// incumbent came back (infeasible, or the node limit reached without one).
function solveLayout(
  conns: readonly Connector[],
  daytime: readonly number[],
  counts: readonly number[],
  ctx: SlotContext,
  margin: number,
  around: Around,
  pinned: Placement
): Placement | null {
  const { model, upper } = layoutMilp(conns, daytime, counts, ctx, margin, around, pinned);
  ctx.stats.layoutSolves++;
  const solution = ctx.solve(model, ctx.limits);
  if (solution.status !== 'optimal' && solution.status !== 'feasible') return null;
  const segments = conns.length + 1;
  return daytime.map((c, d) => {
    const row: number[] = [];
    let total = 0;
    for (let j = 0; j < segments; j++) {
      const v = solution.columnValues[d * segments + j];
      const n = Number.isFinite(v) ? Math.max(0, Math.min(Math.round(v), upper[d * segments + j])) : 0;
      row.push(n);
      total += n;
    }
    // Rounding can push a class one over its count; the excess comes off its last segments.
    for (let j = segments - 1; j >= 0 && total > counts[c]; j--) {
      const cut = Math.min(row[j], total - counts[c]);
      row[j] -= cut;
      total -= cut;
    }
    return row;
  });
}

// Takes launches off a rounded layout until the exact chain stands: from the failing segment, or the latest
// one before it holding a daytime launch, the shortest launch first. Ends, because an empty day stands
// whenever the connectors alone do.
function repair(
  placed: Placement,
  conns: readonly Connector[],
  daytime: readonly number[],
  ctx: SlotContext
): Placement {
  const segments = conns.length + 1;
  const out = placed.map(r => r.slice());
  for (;;) {
    const fail = chainHeads(conns, usedOf(out, daytime, ctx, segments), ctx.day).fail;
    if (fail < 0) return out;
    let cut = false;
    for (let j = Math.min(fail, segments - 1); j >= 0 && !cut; j--) {
      let pick = -1;
      daytime.forEach((c, d) => {
        if (out[d][j] > 0 && (pick < 0 || ctx.classSeconds[c] < ctx.classSeconds[daytime[pick]])) pick = d;
      });
      if (pick >= 0) {
        out[pick][j]--;
        cut = true;
      }
    }
    if (!cut) throw new Error('layout: the overnight chain fails with no daytime launch left to take off');
  }
}

function standsExactly(
  placed: Placement,
  conns: readonly Connector[],
  daytime: readonly number[],
  ctx: SlotContext
): boolean {
  return chainHeads(conns, usedOf(placed, daytime, ctx, conns.length + 1), ctx.day).fail < 0;
}

// How one attempt lays a slot out (SPEC.md sections 13 and 14). Without a doubled launch on the slot every attempt
// is section 10's layout, and only `TODAY` is tried.
interface SlotHow {
  // Doubled ships and launches first, so they start inside the 2x window; false is section 10's order alone.
  doubledFirst: boolean;
  // With `doubledFirst`, whether a 1x daytime launch may still go before the last doubled ship once nothing after
  // it has room (`wrap`), or never does (`strict`).
  around: 'wrap' | 'strict';
  // Positions, in the order of the connectors that stood, of the doubled ships flown as folds.
  fold?: ReadonlySet<number>;
  // The laid-out slot re-timed with its doubled launches first (`regroup` in `layOutPlan`); only with a wake offset.
  regroup?: boolean;
}

const TODAY: SlotHow = { doubledFirst: true, around: 'wrap' };

// What a slot holding a doubled launch tries, in this order (SPEC.md section 14): section 13's layout, the same with
// no 1x launch before the last doubled ship, and section 10's order alone.
const ATTEMPTS: readonly SlotHow[] = [
  TODAY,
  { doubledFirst: true, around: 'strict' },
  { doubledFirst: false, around: 'wrap' },
];

// A doubled ship that takes off before bedtime by more than its flex and a night lands in a waking window, a day
// before the one its nights were counted to: it flies through one night fewer than its class says. Folded, it is
// a connector over those nights with its landing in that window (`flex + D`, so a head of at least `flex + S`), and
// the night it no longer flies through follows as a null connector, so the slot's nights still sum to its own and
// the rest of that day is a segment of its own. Its block, `waking seconds + nights * S`, ends exactly at that
// landing, so the timeline verifies as it is. See SPEC.md section 14.
function foldConnectors(conns: readonly Connector[], fold: ReadonlySet<number>): Connector[] {
  return conns.flatMap((conn, j) =>
    fold.has(j) && conn.early && conn.cls !== NULL_CONNECTOR
      ? [
          { cls: conn.cls, nights: conn.nights - 1, flex: conn.flex + DAY_SECONDS, early: true },
          { cls: NULL_CONNECTOR, nights: 1, flex: 0 },
        ]
      : [conn]
  );
}

// The positions of the ships `conns` would fly as folds: a doubled ship whose head reaches its flex and a night.
function foldable(conns: readonly Connector[], heads: readonly number[], day: DaySchedule): Set<number> {
  const out = new Set<number>();
  conns.forEach((conn, j) => {
    if (conn.early && conn.cls !== NULL_CONNECTOR && heads[j] >= conn.flex + day.sleepSeconds + LAYOUT_TOL) out.add(j);
  });
  return out;
}

interface SlotLaid {
  launches: ClassLaunch[];
  placed: number[];
  conns: Connector[];
  heads: number[];
}

const standsAlone = (conns: readonly Connector[], day: DaySchedule) =>
  chainHeads(conns, new Array<number>(conns.length + 1).fill(0), day).fail < 0;

// Lays one slot's launches (`demand`, per class) out on its days, as `how` says. Launches it cannot place are
// dropped through `ctx.drop`; what comes back is every launch kept, in launch order, the per-class counts of those,
// and the connectors and heads they were laid around. Null only when `how` folds ships whose chain does not stand.
function layOutSlot(demand: readonly number[], ctx: SlotContext, how: SlotHow = TODAY): SlotLaid | null {
  const counts = demand.slice();
  const { day } = ctx;
  const W = day.wakingSeconds;
  const overnight = () => counts.flatMap((n, c) => (n > 0 && ctx.classNights[c] > 0 ? [c] : []));
  const nightsOf = () => counts.reduce((a, n, c) => a + n * ctx.classNights[c], 0);
  const dropOvernight = (candidates: readonly number[]) => {
    const c = ctx.drop(candidates);
    counts[c]--;
    ctx.stats.overnightTrimmed++;
  };

  // The overnight ships first: they must each have a sleep window, and they must stand on their own before
  // any daytime launch is placed around them. The night rows make the first loop idle unless the problem's
  // nights and horizon disagree; the second fires where two long landings and take-offs meet in one day.
  // Doubled ships first when that order stands, the usual order when only it does (SPEC.md section 13); with no
  // doubled ship the two are one order, tried once. With a wake offset each is tried from its other starts as well
  // when it does not stand from the usual one (`connectorOrders`, SPEC.md section 17).
  const standing = (of: readonly number[] = counts): Connector[] | null => {
    if (how.doubledFirst) {
      const first = connectorOrders(of, ctx, true).find(order => standsAlone(order, day));
      if (first) return first;
      if (!of.some((n, c) => n > 0 && ctx.classNights[c] > 0 && ctx.doubled[c])) return null;
    }
    return connectorOrders(of, ctx).find(order => standsAlone(order, day)) ?? null;
  };
  while (nightsOf() > day.nights) dropOvernight(overnight());
  for (;;) {
    if (standing() !== null) break;
    const candidates = overnight();
    if (candidates.length === 0) throw new Error('layout: a slot with no overnight launch has no room for its nights');
    // Prefer a drop that stands the chain up by itself; failing that, the judge's choice among them all.
    const fixes = candidates.filter(c => {
      counts[c]--;
      const ok = standing() !== null;
      counts[c]++;
      return ok;
    });
    // With the fueling pad, a drop that stands the chain up by itself can be the plan's most valuable ship, where
    // dropping cheaper ones until the chain stands costs less (SPEC.md section 18): the judge weighs the two ways to a
    // standing chain, the one drop against the drops of its choice among them all.
    if (fixes.length > 0 && fixes.length < candidates.length && ctx.peek) {
      const single = ctx.peek([fixes]);
      const sim = counts.slice();
      const steps: number[][] = [];
      while (standing(sim) === null && steps.length < candidates.length * 8) {
        const open = sim.flatMap((n, c) => (n > 0 && ctx.classNights[c] > 0 ? [c] : []));
        if (open.length === 0) break;
        steps.push(open);
        const { classes } = ctx.peek(steps);
        sim[classes[classes.length - 1]]--;
      }
      if (standing(sim) !== null && steps.length > 0 && ctx.peek(steps).value > single.value) {
        for (const step of steps) dropOvernight(step);
        continue;
      }
    }
    dropOvernight(fixes.length > 0 ? fixes : candidates);
  }
  const conns = how.fold ? foldConnectors(standing()!, how.fold) : standing()!;
  if (how.fold && !standsAlone(conns, day)) return null;
  const segments = conns.length + 1;

  // Longest first, the greedy's packing order; with doubled classes on the slot, doubled ones first (`event`, then
  // `overhang`), so they take the earliest segments, unless the usual order alone places more (SPEC.md section 13).
  const byLength = counts
    .flatMap((n, c) => (n > 0 && ctx.classNights[c] === 0 && ctx.classSeconds[c] > 0 ? [c] : []))
    .sort((a, b) => ctx.classSeconds[b] - ctx.classSeconds[a] || a - b);
  const daytime =
    how.doubledFirst && byLength.some(c => ctx.doubled[c])
      ? [
          ...byLength.filter(c => ctx.doubled[c] && !ctx.overhang[c]),
          ...byLength.filter(c => ctx.overhang[c]),
          ...byLength.filter(c => !ctx.doubled[c]),
        ]
      : byLength;
  const around: Around =
    how.doubledFirst && (daytime !== byLength || conns.some(conn => conn.early)) ? how.around : 'inOrder';
  let placed = greedyFill(conns, daytime, counts, ctx, around);
  const complete = (p: Placement) => daytime.every((c, d) => p[d].reduce((a, n) => a + n, 0) === counts[c]);
  if (!complete(placed) && daytime !== byLength && around !== 'strict') {
    const usual = greedyFill(conns, byLength, counts, ctx);
    const reindexed = daytime.map(c => usual[byLength.indexOf(c)]);
    if (placedSeconds(reindexed, daytime, ctx) > placedSeconds(placed, daytime, ctx)) placed = reindexed;
  }
  if (!complete(placed)) {
    const greedy = placed;
    let solved = solveLayout(conns, daytime, counts, ctx, 0, around, greedy);
    if (solved && !standsExactly(solved, conns, daytime, ctx)) {
      ctx.stats.marginResolves++;
      const again = solveLayout(conns, daytime, counts, ctx, MARGIN_SECONDS, around, greedy);
      solved = again && standsExactly(again, conns, daytime, ctx) ? again : repair(solved, conns, daytime, ctx);
    }
    if (solved && placedSeconds(solved, daytime, ctx) > placedSeconds(placed, daytime, ctx)) placed = solved;
  }

  const { heads, fail } = chainHeads(conns, usedOf(placed, daytime, ctx, segments), day);
  if (fail >= 0) throw new Error(`layout: segment ${fail} over-full after placement`);

  const laid: ClassLaunch[] = [];
  // A zero-second daytime launch takes no time at all; it goes at the very start, which is the plan's start.
  counts.forEach((n, c) => {
    if (ctx.classNights[c] === 0 && !(ctx.classSeconds[c] > 0))
      for (let i = 0; i < n; i++) laid.push({ cls: c, launchAt: day.wakeOffsetSeconds });
  });
  // Within a segment, doubled launches go up first and shortest first, which starts as many of them as early as
  // any order can; the rest in the greedy's order. Only the totals reach the chain, so the order is free.
  const doubledByShortest = daytime
    .filter(c => ctx.doubled[c])
    .sort((a, b) => ctx.classSeconds[a] - ctx.classSeconds[b] || a - b);
  const launchOrder = [...doubledByShortest, ...daytime.filter(c => !ctx.doubled[c])].map(c => daytime.indexOf(c));
  let startDay = 0;
  let after = 0;
  for (let j = 0; j < segments; j++) {
    const dayStart = startDay * DAY_SECONDS;
    let offset = after + busyIn(j, day);
    for (const d of launchOrder) {
      const c = daytime[d];
      for (let i = 0; i < placed[d][j]; i++) {
        laid.push({ cls: c, launchAt: dayStart + offset });
        offset += ctx.classSeconds[c];
      }
    }
    if (j < conns.length) {
      const conn = conns[j];
      if (conn.cls !== NULL_CONNECTOR) laid.push({ cls: conn.cls, launchAt: dayStart + W - heads[j] });
      after = Math.max(0, conn.flex - heads[j]);
      startDay += conn.nights;
    }
  }

  // The segments time every overnight ship as flying through the nights its class counts, so one that takes off
  // early enough to land before a bedtime holds its slot, on paper, until a wake-up its block ended before. When the
  // segments leave launches unplaced, the slot is re-timed in the same order, each launch at the first waking instant
  // its predecessor's block leaves it, so the waking time after such a landing is used and the slot is free again
  // sooner; what the segments could not place then goes on the end, longest first, while it still ends by the
  // horizon (SPEC.md section 14). The re-timed slot is kept when that places a launch more; otherwise the segments'
  // timeline stands, as it is. What does not fit even there leaves the plan, one launch at a time, each the one the
  // judge misses least. With a wake offset the first waking window is short, and a launch the segments could not
  // fit in it may still go up at the plan's start and fly on into the night: before going on the end, what was left
  // over is tried at the front, longest first, while the re-timed slot still ends by the horizon (SPEC.md section
  // 17). A 1x launch goes there only on a slot without a doubled launch, which it would push out of the 2x window.
  const left = daytime.map((c, d) => counts[c] - placed[d].reduce((a, n) => a + n, 0));
  let launches = laid;
  if (left.some(n => n > 0)) {
    let order = laid;
    let gained = 0;
    const endOf = (timeline: readonly ClassLaunch[]) =>
      timeline.reduce((end, l) => Math.max(end, l.launchAt + blockOf(l.cls, ctx)), day.wakeOffsetSeconds);
    if (day.wakeOffsetSeconds > 0) {
      const holdsDoubled = laid.some(l => ctx.doubled[l.cls]);
      daytime.forEach((c, d) => {
        if (holdsDoubled && !ctx.doubled[c]) return;
        while (left[d] > 0) {
          const trial = [{ cls: c, launchAt: 0 }, ...order];
          if (endOf(compact(trial, ctx)) > day.horizonSeconds + LAYOUT_TOL) break;
          order = trial;
          left[d]--;
          gained++;
        }
      });
    }
    const retimed = compact(order, ctx);
    let free = endOf(retimed);
    daytime.forEach((c, d) => {
      for (; left[d] > 0; left[d]--, gained++) {
        const at = wakingFrom(free, day);
        if (at + ctx.classSeconds[c] > day.horizonSeconds + LAYOUT_TOL) break;
        retimed.push({ cls: c, launchAt: at });
        free = at + ctx.classSeconds[c];
      }
    });
    if (gained > 0) launches = retimed;
    else daytime.forEach((c, d) => (left[d] = counts[c] - placed[d].reduce((a, n) => a + n, 0)));
  }
  daytime.forEach((c, d) => {
    for (let i = 0; i < left[d]; i++) counts[ctx.drop([c])]--;
  });

  return { launches, placed: counts, conns, heads };
}

// The wall-clock seconds a launch of class `cls` holds its slot for, as the verifier times it.
function blockOf(cls: number, ctx: Pick<SlotContext, 'classSeconds' | 'classNights' | 'day'>): number {
  return ctx.classSeconds[cls] + ctx.classNights[cls] * ctx.day.sleepSeconds;
}

// The first instant at or after `t` the player is awake: `t` itself, or the next wake-up when `t` is in a night.
function wakingFrom(t: number, day: DaySchedule): number {
  const d = Math.floor((t + LAYOUT_TOL) / DAY_SECONDS);
  return t - d * DAY_SECONDS <= day.wakingSeconds + LAYOUT_TOL ? t : (d + 1) * DAY_SECONDS;
}

// `launches` in the order given, each re-timed to the first waking instant at or after the end of the block before
// it, the first at the plan's start. Never later than it was, for a timeline that verified: by induction each block
// ends no later than it did, so the instant a launch waits for is no later either. Earliest start is optimal for a
// fixed order, since a block that ends earlier never makes the next one start later.
function compact(
  launches: readonly ClassLaunch[],
  ctx: Pick<SlotContext, 'classSeconds' | 'classNights' | 'day'>,
  from = ctx.day.wakeOffsetSeconds
): ClassLaunch[] {
  let free = from;
  return launches.map(l => {
    const launchAt = wakingFrom(free, ctx.day);
    free = launchAt + blockOf(l.cls, ctx);
    return { cls: l.cls, launchAt };
  });
}

// What one slot's timeline is verified against, in the plan's own seconds. Without a sleep window: no sleep, and the
// slot itself as the horizon, so the verifier's rules reduce to launches going up back to back inside the slot
// (SPEC.md section 12).
export function timelineOf(model: Model): SleepWindow {
  const day = model.day;
  return day
    ? {
        sleepSeconds: day.sleepSeconds,
        horizonSeconds: day.planHorizonSeconds,
        ...(day.wakeOffsetSeconds > 0 && { wakeOffsetSeconds: day.wakeOffsetSeconds }),
        // Starting in the night, the offset that put it there (SPEC.md section 17).
        ...(day.firstNightSeconds > 0 && { wakeOffsetSeconds: DAY_SECONDS - day.firstNightSeconds }),
      }
    : { sleepSeconds: 0, horizonSeconds: model.timeCapacitySeconds };
}

// Doubled launches first, `event` before the one `overhang`, so the window rows' exactness argument is the
// launch order itself (SPEC.md section 11); class order within each.
const LAUNCH_ORDER: Readonly<Record<CapacityVariant, number>> = { event: 0, overhang: 1, normal: 2 };

// One slot without a sleep window: every launch back to back from t = 0. Exact, so nothing is trimmed and no
// MILP is built; nights, on a problem stating them without a day, ride along untimed.
function backToBack(demand: readonly number[], layout: Layout): ClassLaunch[] {
  const order = demand
    .flatMap((n, c) => (n > 0 ? [c] : []))
    .sort((a, b) => LAUNCH_ORDER[layout.classVariant[a]] - LAUNCH_ORDER[layout.classVariant[b]] || a - b);
  const launches: ClassLaunch[] = [];
  let at = 0;
  for (const c of order) {
    for (let i = 0; i < demand[c]; i++) {
      launches.push({ cls: c, launchAt: at });
      at += layout.classSeconds[c];
    }
  }
  return launches;
}

// The MILP's per-slot class counts without a sleep window, re-dealt so the busiest slot is as light as longest
// processing time first makes it: `order_k` only sorts slots by load, so the MILP hands back whatever split it
// branched to, three 10-hour launches as one slot of 30 hours (SPEC.md section 12). Every launch keeps its class,
// so the allocation and the joint are the MILP's; each slot keeps every row the MILP's slots kept: seconds within
// the slot, nights within its nights, `event` seconds within the window and at most one `overhang`. Doubled launches
// are dealt first, `event` then `overhang`, longest first within each, then the rest longest first, each to the
// lightest slot that takes it (ties to the lower slot). The MILP's own split stands unless this one's busiest slot is
// strictly lighter.
function balance(demand: readonly (readonly number[])[], model: Model, layout: Layout): number[][] {
  const slots = demand.length;
  const loadOf = (counts: readonly number[]) => counts.reduce((a, n, c) => a + n * layout.classSeconds[c], 0);
  const busiest = Math.max(...demand.map(loadOf));
  const order = layout.classSeconds
    .map((_, c) => c)
    .filter(c => demand.some(d => d[c] > 0))
    .sort(
      (a, b) =>
        LAUNCH_ORDER[layout.classVariant[a]] - LAUNCH_ORDER[layout.classVariant[b]] ||
        layout.classSeconds[b] - layout.classSeconds[a] ||
        a - b
    );
  const out = Array.from({ length: slots }, () => new Array<number>(layout.classes).fill(0));
  const load = new Array<number>(slots).fill(0);
  const nights = new Array<number>(slots).fill(0);
  const event = new Array<number>(slots).fill(0);
  const overhang = new Array<number>(slots).fill(0);
  for (const c of order) {
    const seconds = layout.classSeconds[c];
    const variant = layout.classVariant[c];
    for (let n = demand.reduce((a, d) => a + d[c], 0); n > 0; n--) {
      let to = -1;
      for (let k = 0; k < slots; k++) {
        if (load[k] + seconds > model.timeCapacitySeconds + LAYOUT_TOL) continue;
        if (nights[k] + layout.classNights[c] > model.nightsPerSlot) continue;
        if (variant === 'event' && event[k] + seconds > model.eventWindowBudget + LAYOUT_TOL) continue;
        if (variant === 'overhang' && overhang[k] >= 1) continue;
        if (to < 0 || load[k] < load[to]) to = k;
      }
      if (to < 0) return demand.map(d => d.slice());
      out[to][c]++;
      load[to] += seconds;
      nights[to] += layout.classNights[c];
      if (variant === 'event') event[to] += seconds;
      if (variant === 'overhang') overhang[to]++;
    }
  }
  return Math.max(...load) < busiest - LAYOUT_TOL ? out : demand.map(d => d.slice());
}

export interface PlanLayout {
  // Per group, the plan that was laid out: the solve's counts less every launch trimmed.
  counts: number[];
  calendar: CalendarLaunch[][];
  stats: LayoutStats;
}

export type SlotVerifier = (
  launches: readonly TimedLaunch[],
  sleep: SleepWindow,
  eventWindowSeconds?: number
) => string | null;

// Lays the whole plan out slot by slot, from the MILP's own per-slot class columns, which are the packing it
// certified. `judge` scores a vector of group counts (higher is better); every trim decrements the group,
// within the classes allowed, whose loss it misses least. With a sleep window a slot the verifier rejects loses
// one more launch, by the same rule, and is laid out again; an empty slot always verifies, so this ends. Without
// one the layout is exact, and a slot it fails to verify is a bug, thrown rather than trimmed.
export function layOutPlan(
  model: Model,
  layout: Layout,
  columnValues: Float64Array,
  counts: readonly number[],
  options: readonly LaunchOption[],
  solve: MilpSolve,
  judge: (counts: readonly number[]) => number,
  verify: SlotVerifier = slotFault,
  given?: readonly (readonly CalendarLaunch[])[]
): PlanLayout {
  const day = model.day;
  const sleep = timelineOf(model);
  // With the fueling pad and a sleep window, the layout works to the window the MILP's rows read, closing a little
  // early (`Model.eventWindowPadReserve`): launches it would send exactly at the close, as at a wake-up the close falls
  // on, cannot all go up there once the pad spaces them, and the pad stage below, which keeps the real close, promotes
  // again whatever it does fly inside it. Without sleep the slots go back to back from T+0 and meet nowhere but there.
  const realWindow = model.eventWindowSeconds;
  const window = realWindow - model.eventWindowPadReserve;
  // The layout times a slot on the player's regular day, from the wake-up at or before the plan's start, which is
  // `shift` seconds before it (SPEC.md section 17); the calendar, the verifier and the window are in the plan's own
  // seconds. `planAt` is a launch's plan time, computed as the calendar writes it, so every comparison against the
  // window here is the one the verifier makes. Without an offset the two clocks are one.
  // Starting in the night (section 17), the regular day is the one from the first wake-up, `firstNight` into the plan,
  // and the launches at T+0 sit at `-firstNight` on it; then `shift` is negative.
  const busy = day?.wakeOffsetSeconds ?? 0;
  const firstNight = day?.firstNightSeconds ?? 0;
  const shift = busy - firstNight;
  const planAt = (l: ClassLaunch) => l.launchAt - shift;
  // Where a launch's block ends on the layout's clock: a launch at T+0 holds its slot to its landing, the longest of
  // its class's; every other launch its block.
  const isStart = (cls: number) => layout.classAtStart[cls];
  const blockEnd = (l: ClassLaunch, slotCtx: SlotContext) =>
    l.launchAt + (isStart(l.cls) ? layout.classAtStartBlock[l.cls] : blockOf(l.cls, slotCtx));
  const current = counts.slice();
  const stats: LayoutStats = {
    launchesTrimmed: 0,
    overnightTrimmed: 0,
    layoutSolves: 0,
    marginResolves: 0,
    verifierRetries: 0,
    // With the fueling pad as well as without sleep: the pad can carry a doubled launch out of the window.
    ...((day !== null || model.fuelingRate > 0) && window > 0 && { launchesDemoted: 0, launchesPromoted: 0 }),
  };
  const groupsOf: number[][] = Array.from({ length: layout.classes }, () => []);
  for (let g = 0; g < layout.groups; g++) groupsOf[layout.classOf[g]].push(g);

  // `drop`'s choices for each of `steps` in turn, made on a copy and undone: the judge's value after them all.
  const peek = (steps: readonly (readonly number[])[]): { value: number; classes: number[] } => {
    const saved = current.slice();
    const classes: number[] = [];
    for (const candidates of steps) {
      let best = -Infinity;
      let bestGroup = -1;
      for (const c of candidates) {
        for (const g of groupsOf[c]) {
          if (current[g] <= 0) continue;
          current[g]--;
          let value: number;
          try {
            value = judge(current);
          } catch {
            value = -Infinity;
          }
          current[g]++;
          if (bestGroup < 0 || value > best) [best, bestGroup] = [value, g];
        }
      }
      if (bestGroup < 0) break;
      current[bestGroup]--;
      classes.push(layout.classOf[bestGroup]);
    }
    let value: number;
    try {
      value = judge(current);
    } catch {
      value = -Infinity;
    }
    saved.forEach((n, g) => (current[g] = n));
    return { value, classes };
  };

  const drop = (candidates: readonly number[]): number => {
    let best = -Infinity;
    let bestGroup = -1;
    for (const c of candidates) {
      for (const g of groupsOf[c]) {
        if (current[g] <= 0) continue;
        current[g]--;
        let value: number;
        try {
          value = judge(current);
        } catch {
          // An unjudgeable candidate is the worst one, not a reason to stop laying the plan out.
          value = -Infinity;
        }
        current[g]++;
        if (bestGroup < 0 || value > best) {
          best = value;
          bestGroup = g;
        }
      }
    }
    if (bestGroup < 0) throw new Error(`layout: no launch left to drop in class(es) ${candidates.join(', ')}`);
    current[bestGroup]--;
    stats.launchesTrimmed++;
    return layout.classOf[bestGroup];
  };

  // Flies one launch of one of the doubled `candidates` classes at 1x instead: the group, within them, whose
  // launch moves onto its `twin` at the least cost to the judge. A group with no twin can only be dropped, which
  // competes on the same terms and counts as a trim. Returns the class given up and the class taken on, null for a
  // drop. See SPEC.md section 13.
  const demote = (candidates: readonly number[]): { from: number; to: number | null } => {
    let best = -Infinity;
    let bestGroup = -1;
    for (const c of candidates) {
      for (const g of groupsOf[c]) {
        if (current[g] <= 0) continue;
        const twin = model.groups[g].twin;
        current[g]--;
        if (twin >= 0) current[twin]++;
        let value: number;
        try {
          value = judge(current);
        } catch {
          value = -Infinity;
        }
        if (twin >= 0) current[twin]--;
        current[g]++;
        if (bestGroup < 0 || value > best) {
          best = value;
          bestGroup = g;
        }
      }
    }
    if (bestGroup < 0)
      throw new Error(`layout: no doubled launch left to demote in class(es) ${candidates.join(', ')}`);
    const twin = model.groups[bestGroup].twin;
    current[bestGroup]--;
    if (twin >= 0) {
      current[twin]++;
      stats.launchesDemoted = (stats.launchesDemoted ?? 0) + 1;
    } else {
      stats.launchesTrimmed++;
    }
    return { from: layout.classOf[bestGroup], to: twin >= 0 ? layout.classOf[twin] : null };
  };

  // A laid-out slot against the 2x window. Launches of equal seconds and nights hold the slot identically, so
  // among them the doubled ones take the earliest launch times, which changes no time on the timeline; any still
  // launching past the window are flown at 1x, through `demote`, in place. The timeline is the one laid out, less
  // at most the launches dropped for want of a twin, so it stands exactly as it did. Without a window, the slot.
  const settle = (launches: readonly ClassLaunch[]): ClassLaunch[] => {
    if (!(window > 0)) return launches.slice();
    const isDoubled = (c: number) => layout.classVariant[c] !== 'normal';
    const byKey = new Map<string, number[]>();
    launches.forEach((l, i) => {
      const key = `${layout.classSeconds[l.cls]}/${layout.classNights[l.cls]}${isStart(l.cls) ? '/start' : ''}`;
      const at = byKey.get(key);
      if (at) at.push(i);
      else byKey.set(key, [i]);
    });
    const out: (ClassLaunch | null)[] = launches.slice();
    for (const positions of byKey.values()) {
      const classes = positions.map(i => launches[i].cls);
      const doubled = classes
        .filter(isDoubled)
        .sort((a, b) => LAUNCH_ORDER[layout.classVariant[a]] - LAUNCH_ORDER[layout.classVariant[b]] || a - b);
      if (doubled.length === 0) continue;
      // Launch order, so the doubled ones that still miss the window are the last of the first `doubled.length`.
      const late = positions.slice(0, doubled.length).filter(i => planAt(launches[i]) > window + LAYOUT_TOL).length;
      const demoted: (number | null)[] = [];
      for (let n = 0; n < late; n++) {
        const { from, to } = demote([...new Set(doubled)]);
        doubled.splice(doubled.indexOf(from), 1);
        demoted.push(to);
      }
      const assigned = [...doubled, ...demoted, ...classes.filter(c => !isDoubled(c))];
      positions.forEach((i, n) => {
        const cls = assigned[n];
        out[i] = cls === null ? null : { cls, launchAt: launches[i].launchAt };
      });
    }
    return out.filter((l): l is ClassLaunch => l !== null);
  };

  const judged = () => {
    try {
      return judge(current);
    } catch {
      return -Infinity;
    }
  };

  // Per group, whether the menu holds its flight at 2x as an `event` and as an `overhang` option: what the verifier
  // holds a 1x launch inside the window to (SPEC.md section 16).
  const menuCopies = doubledCopiesOnMenu(options);
  const onMenu = (g: number, variant: DoubledVariant) => menuCopies[model.groups[g].members[0]][variant];
  const inWindow = (l: ClassLaunch) => window > 0 && planAt(l) <= window + LAYOUT_TOL;

  // Moves one launch from group `from` to group `to`, in `current`.
  const move = (from: number, to: number) => {
    current[from]--;
    current[to]++;
  };

  // The reverse of `settle`: every launch inside the 2x window goes up doubled, since the game doubles it whatever
  // the plan says (SPEC.md section 16). Labelled canonically: the slot's last launch inside the window is its
  // `overhang` and the earlier ones are `event` launches. Each of those ends before the last one starts, so their
  // seconds fit the window, as the window rows' argument has it (section 11). A 1x launch the menu could have doubled
  // there is flown as its group's `copy` of that variant, the group chosen by the judge when its class has more than
  // one; a doubled launch with the other label is relabelled to the same flight's other copy, which changes no yield,
  // and keeps its label when there is none. The slot holds no more than one `overhang`: when an earlier one cannot
  // be relabelled, the last launch takes the `event` label if it can. Launch times do not move, and a copy's block is
  // never longer than its own (a stand-in dominates it), so the slot verifies as it did. Each promotion moves a
  // launch onto the same flight, or one that dominates it, at twice the drops, so the judge's joint does not fall.
  const promote = (launches: readonly ClassLaunch[]): ClassLaunch[] => {
    const out = launches.slice();
    const inside = out.flatMap((l, i) => (inWindow(l) ? [i] : []));
    const relabel = (i: number, want: DoubledVariant): boolean => {
      const { cls, launchAt } = out[i];
      const variant = layout.classVariant[cls];
      if (variant === want) return true;
      if (variant !== 'normal') {
        const g = groupsOf[cls].find(h => current[h] > 0 && model.groups[h].copy[want] >= 0);
        if (g === undefined) return false;
        const to = model.groups[g].copy[want];
        move(g, to);
        out[i] = { cls: layout.classOf[to], launchAt };
        return true;
      }
      const pinned = out[i].group;
      const candidates = (pinned === undefined ? groupsOf[cls] : [pinned]).filter(
        g => current[g] > 0 && onMenu(g, want) && model.groups[g].copy[want] >= 0
      );
      if (candidates.length === 0) return false;
      let best = candidates[0];
      if (candidates.length > 1) {
        let value = -Infinity;
        for (const g of candidates) {
          const to = model.groups[g].copy[want];
          move(g, to);
          const v = judged();
          move(to, g);
          if (v > value) [value, best] = [v, g];
        }
      }
      const to = model.groups[best].copy[want];
      move(best, to);
      stats.launchesPromoted = (stats.launchesPromoted ?? 0) + 1;
      out[i] = { cls: layout.classOf[to], launchAt };
      return true;
    };
    if (inside.length === 0) return out;
    const last = inside[inside.length - 1];
    let overhangLeft = false;
    for (const i of inside.slice(0, -1)) {
      if (!relabel(i, 'event') && layout.classVariant[out[i].cls] === 'overhang') overhangLeft = true;
    }
    if (!(overhangLeft && relabel(last, 'event'))) relabel(last, 'overhang');
    return out;
  };

  // The slot columns and the group totals are tied by the class rows, so after rounding they agree; were they
  // ever not to, a slot launch with no group behind it is taken off the latest slot, and a group launch with
  // no slot behind it is trimmed. A `given` calendar replaces the columns, and `counts` are its own.
  const demand: number[][] = Array.from({ length: model.slots }, (_, k) =>
    Array.from({ length: layout.classes }, (_, c) => {
      const v = given ? 0 : columnValues[nCol(layout, c, k)];
      return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
    })
  );
  for (let c = 0; c < layout.classes && !given; c++) {
    let slotTotal = demand.reduce((a, d) => a + d[c], 0);
    const groupTotal = groupsOf[c].reduce((a, g) => a + current[g], 0);
    for (let k = model.slots - 1; k >= 0 && slotTotal > groupTotal; k--) {
      const cut = Math.min(demand[k][c], slotTotal - groupTotal);
      demand[k][c] -= cut;
      slotTotal -= cut;
    }
    for (let i = slotTotal; i < groupTotal; i++) drop([c]);
  }

  const timedOf = (launches: readonly ClassLaunch[]): TimedLaunch[] =>
    launches.map(l => ({
      launchAt: planAt(l),
      wakingSeconds: layout.classSeconds[l.cls],
      nights: layout.classNights[l.cls],
      doubled: layout.classVariant[l.cls] !== 'normal',
      // The longest landing among the class's groups: one block for them all (section 17).
      ...(isStart(l.cls) && { atStartSeconds: layout.classAtStartBlock[l.cls] }),
    }));
  const bySlot: ClassLaunch[][] = [];
  // A calendar that verified without the 2x window (`solveWith`'s last resort, SPEC.md section 16), flown as it is
  // with what goes up inside the window promoted.
  if (given) {
    const groupOf = new Map<number, number>();
    model.groups.forEach((grp, g) => grp.members.forEach(option => groupOf.set(option, g)));
    given.forEach((launches, k) => {
      const slot = promote(
        launches.map(l => {
          const g = groupOf.get(l.option);
          if (g === undefined) throw new Error(`layout: the given calendar flies option ${l.option}, in no group`);
          return { cls: layout.classOf[g], launchAt: l.launchAt + shift };
        })
      );
      const fault = verify(timedOf(slot), sleep, window);
      if (fault !== null) throw new Error(`layout: given slot ${k} fails verification: ${fault}`);
      bySlot.push(slot);
    });
  }
  const dealt = day === null && !given ? balance(demand, model, layout) : demand;
  for (let k = 0; k < model.slots && day === null && !given; k++) {
    const launches = promote(backToBack(dealt[k], layout));
    const fault = verify(timedOf(launches), sleep, window);
    if (fault !== null) throw new Error(`layout: slot ${k} laid back to back fails verification: ${fault}`);
    bySlot.push(launches);
  }
  const ctx: SlotContext | null = day && {
    classSeconds: layout.classSeconds,
    classNights: layout.classNights,
    doubled: layout.classVariant.map(v => v !== 'normal'),
    overhang: layout.classVariant.map(v => v === 'overhang'),
    day,
    solve,
    drop,
    ...(model.fuelingRate > 0 && { peek }),
    stats,
    limits: LAYOUT_LIMITS,
  };
  // One slot laid out as `how` says, settled against the window, and laid out again one launch lighter for as long
  // as the verifier rejects it; null when `how` folds ships whose chain does not stand. The connectors and heads
  // are those of the layout that verified.
  // A laid-out slot with its doubled launches moved to the front: the `event` ones by block, shortest first, then the
  // `overhang`, then the rest in the order laid out, each at the first waking instant the one before it leaves
  // (`compact`), so the doubled ones go up as early as that order allows. What then ends past the horizon comes off
  // the end, the judge choosing the group within its class. An attempt for a slot with a wake offset, whose busy first
  // segment the segments' doubled-first order can serve badly (SPEC.md section 17); the judge weighs it against the
  // others.
  // A launch at T+0 keeps its place, first, and the rest is re-timed from its landing.
  const regroup = (laidOut: readonly ClassLaunch[], slotCtx: SlotContext): ClassLaunch[] => {
    const start = laidOut.filter(l => isStart(l.cls));
    const launches = laidOut.filter(l => !isStart(l.cls));
    const order = [
      ...launches
        .filter(l => slotCtx.doubled[l.cls] && !slotCtx.overhang[l.cls])
        .sort((a, b) => blockOf(a.cls, slotCtx) - blockOf(b.cls, slotCtx) || a.cls - b.cls),
      ...launches.filter(l => slotCtx.overhang[l.cls]),
      ...launches.filter(l => !slotCtx.doubled[l.cls]),
    ];
    const timeline = compact(order, slotCtx, start.length > 0 ? blockEnd(start[0], slotCtx) : undefined);
    for (let last = timeline[timeline.length - 1]; last !== undefined; last = timeline[timeline.length - 1]) {
      if (last.launchAt + blockOf(last.cls, slotCtx) <= slotCtx.day.horizonSeconds + LAYOUT_TOL) break;
      timeline.pop();
      drop([last.cls]);
    }
    return [...start, ...timeline];
  };

  // A slot's launches laid out around its launch at T+0, when the plan starts in the night and the slot has one
  // (SPEC.md section 17). That launch goes up at T+0 and holds the slot to the first waking instant after its
  // landing: whole days of the regular day, and then the waking seconds of the next one it lands in. So the rest of
  // the slot is laid out on the regular day from there, those days gone and those seconds a busy block, as a plan
  // starting after wake-up is (section 17's awake case), and put back on the layout's clock. A slot holding more
  // than one, which no plan the start row admits does, or one the days cannot hold, loses it through `drop`.
  const layOutAround = (want: readonly number[], slotCtx: SlotContext, how: SlotHow): SlotLaid | null => {
    const starts = want.flatMap((n, c) => (n > 0 && isStart(c) ? Array<number>(n).fill(c) : []));
    if (starts.length === 0) return layOutSlot(want, slotCtx, how);
    const rest = want.slice();
    for (const c of starts) rest[c]--;
    const c0 = starts[0];
    for (const c of starts.slice(1)) drop([c]);
    const d = slotCtx.day;
    const m = slotCtx.classNights[c0];
    const held = slotCtx.classSeconds[c0] - m * d.wakingSeconds;
    if (m > d.nights || (m === d.nights && held > d.tailSeconds + LAYOUT_TOL)) {
      drop([c0]);
      return layOutSlot(rest, slotCtx, how);
    }
    const after: DaySchedule = {
      ...d,
      horizonSeconds: d.horizonSeconds - m * DAY_SECONDS,
      nights: d.nights - m,
      windows: Math.max(0, d.windows - m),
      wakeOffsetSeconds: Math.max(0, held),
    };
    const laid = layOutSlot(rest, { ...slotCtx, day: after }, how);
    if (laid === null) return null;
    const placed = laid.placed.slice();
    placed[c0]++;
    return {
      ...laid,
      placed,
      launches: [
        { cls: c0, launchAt: -firstNight },
        ...laid.launches.map(l => ({ ...l, launchAt: l.launchAt + m * DAY_SECONDS })),
      ],
    };
  };

  const runSlot = (slotCtx: SlotContext, k: number, how: SlotHow) => {
    let want = demand[k];
    for (;;) {
      const laid = layOutAround(want, slotCtx, how);
      if (laid === null) return null;
      const launches = promote(settle(how.regroup ? regroup(laid.launches, slotCtx) : laid.launches));
      if (verify(timedOf(launches), sleep, window) === null) return { launches, conns: laid.conns, heads: laid.heads };
      stats.verifierRetries++;
      const placed = new Array<number>(layout.classes).fill(0);
      for (const l of launches) placed[l.cls]++;
      const present = placed.flatMap((n, c) => (n > 0 ? [c] : []));
      if (present.length === 0) throw new Error(`layout: slot ${k} fails verification with nothing left in it`);
      want = placed;
      want[drop(present)]--;
    }
  };

  // What a slot's attempt leaves behind, so the next attempt can start where it did and the best can be restored:
  // the plan's counts, and the statistics that describe that plan rather than the work of finding it.
  const PLAN_STATS = [
    'launchesTrimmed',
    'overnightTrimmed',
    'verifierRetries',
    'launchesDemoted',
    'launchesPromoted',
  ] as const;
  const save = () => ({
    counts: current.slice(),
    stats: PLAN_STATS.map(key => stats[key]),
  });
  const restore = (saved: ReturnType<typeof save>) => {
    saved.counts.forEach((n, g) => (current[g] = n));
    PLAN_STATS.forEach((key, i) => {
      if (saved.stats[i] !== undefined) stats[key] = saved.stats[i]!;
    });
  };
  for (let k = 0; k < model.slots && ctx !== null && !given; k++) {
    // Without a doubled launch on the slot there is one layout, section 10's.
    if (!demand[k].some((n, c) => n > 0 && ctx.doubled[c])) {
      bySlot.push(runSlot(ctx, k, TODAY)!.launches);
      continue;
    }
    // With one, the layout's orders are heuristics that pull against each other, so the judge chooses among them
    // (SPEC.md section 14): doubled first as section 13 lays it, doubled first with no 1x launch before the last
    // doubled ship, the usual order, and each of those again with the doubled ships that took off a night early
    // flown as folds. Ties go to the earlier attempt, so the first one stands unless another is strictly better.
    const before = save();
    let best: { value: number; saved: ReturnType<typeof save>; launches: ClassLaunch[] } | null = null;
    const attempt = (how: SlotHow) => {
      restore(before);
      const laid = runSlot(how === TODAY ? ctx : { ...ctx, limits: ALTERNATIVE_LAYOUT_LIMITS }, k, how);
      if (laid === null) return null;
      const value = judged();
      if (best === null || value > best.value) best = { value, saved: save(), launches: laid.launches };
      return laid;
    };
    for (const how of ATTEMPTS) {
      const laid = attempt(how);
      const fold = laid && foldable(laid.conns, laid.heads, ctx.day);
      if (fold && fold.size > 0) attempt({ ...how, fold });
    }
    // With a wake offset, awake or in the night, section 13's layout and the usual order once more, regrouped
    // (`regroup`, SPEC.md section 17).
    if (ctx.day.wakeOffsetSeconds > 0 || ctx.day.firstNightSeconds > 0) {
      for (const how of [ATTEMPTS[0], ATTEMPTS[2]]) attempt({ ...how, regroup: true });
    }
    restore(best!.saved);
    bySlot.push(best!.launches);
  }

  // With a sleep window the slots are laid out one at a time from the MILP's split, which `order_k` only sorts, so
  // one slot can fly everything while the others stand idle. The busiest slot's last launch moves to the end of
  // whichever other slot it would finish soonest in, at that slot's first waking instant once it is free, as long as
  // that finishes it, and so the pair, strictly sooner, it ends by the horizon, and a doubled launch still goes up
  // inside the window; repeated until no move helps. Removing a slot's last launch and appending one after a slot's
  // last block both leave each slot's timeline standing, and every launch keeps its class, so this changes when and
  // where launches go, never what the plan flies. The two slots are promoted again, since a launch can now go up
  // inside the window where it did not, or be the slot's last there (SPEC.md section 12).
  if (ctx !== null && !given) {
    // An empty slot is free from the plan's start, or from the first wake-up when it starts in the night.
    const endOf = (launches: readonly ClassLaunch[]) => {
      const last = launches[launches.length - 1];
      return last ? wakingFrom(blockEnd(last, ctx), ctx.day) : busy;
    };
    const total = bySlot.reduce((a, launches) => a + launches.length, 0);
    for (let moves = 0; moves < total * model.slots; moves++) {
      const ends = bySlot.map(endOf);
      const from = ends.indexOf(Math.max(...ends));
      const moving = bySlot[from][bySlot[from].length - 1];
      // A launch at T+0 goes up at T+0 or not at all, so a slot that ends with one has nothing to give.
      if (!moving || isStart(moving.cls)) break;
      const left = endOf(bySlot[from].slice(0, -1));
      let to = -1;
      let best = Infinity;
      let at = 0;
      for (let k = 0; k < model.slots; k++) {
        if (k === from) continue;
        const start = wakingFrom(ends[k], ctx.day);
        const finish = start + blockOf(moving.cls, ctx);
        if (finish > ctx.day.horizonSeconds + LAYOUT_TOL) continue;
        if (ctx.doubled[moving.cls] && !inWindow({ cls: moving.cls, launchAt: start })) continue;
        const end = wakingFrom(finish, ctx.day);
        if (Math.max(end, left) < ends[from] - LAYOUT_TOL && end < best) [to, best, at] = [k, end, start];
      }
      if (to < 0) break;
      bySlot[from] = promote(bySlot[from].slice(0, -1));
      bySlot[to] = promote([...bySlot[to], { cls: moving.cls, launchAt: at }]);
      for (const k of [from, to]) {
        const fault = verify(timedOf(bySlot[k]), sleep, window);
        if (fault !== null) throw new Error(`layout: slot ${k} fails verification after balancing: ${fault}`);
      }
    }
  }

  // A 1x launch still inside the window is one `promote` found no copy for in the model. It is flown as a group the
  // menu holds no copy of for its place in the slot, as the verifier reads that place, when its class has one to
  // spare; otherwise the menu could double it and the model cannot, and it leaves the plan, the judge choosing which
  // of its class's groups gives up the launch (SPEC.md section 16). Removing a launch frees its slot, so the slot
  // still verifies; it can change which launch is the slot's last inside the window, so this runs to a fixed point.
  const left = current.slice();
  for (let changed = window > 0; changed; ) {
    changed = false;
    left.splice(0, left.length, ...current);
    for (const launches of bySlot) for (const l of launches) delete l.group;
    for (const launches of bySlot) {
      let lastInside = -1;
      launches.forEach((l, i) => planAt(l) <= window + VERIFY_TOL_SECONDS && (lastInside = i));
      for (let i = 0; i < launches.length && !changed; i++) {
        const l = launches[i];
        if (layout.classVariant[l.cls] !== 'normal' || !(planAt(l) < window - VERIFY_TOL_SECONDS)) continue;
        const want: DoubledVariant = i === lastInside ? 'overhang' : 'event';
        const spare = groupsOf[l.cls].find(g => left[g] > 0 && !onMenu(g, want));
        if (spare !== undefined) {
          left[spare]--;
          l.group = spare;
          continue;
        }
        let best = -Infinity;
        let gone = -1;
        for (const g of groupsOf[l.cls]) {
          if (!(left[g] > 0)) continue;
          current[g]--;
          const v = judged();
          current[g]++;
          if (gone < 0 || v > best) [best, gone] = [v, g];
        }
        if (gone < 0) throw new Error(`layout: class ${l.cls} has more launches than its groups`);
        current[gone]--;
        stats.launchesTrimmed++;
        launches.splice(i, 1);
        changed = true;
      }
      if (changed) break;
    }
  }

  // Each class's launches go to its groups in group order, slot by slot, after the launches pinned to a group
  // above; a group's launches are all flown as its first member, as `emit` reports them.
  const next = new Array<number>(layout.classes).fill(0);
  const calendar = bySlot.map(launches =>
    launches.map(l => {
      const members = groupsOf[l.cls];
      let g = l.group;
      if (g === undefined) {
        while (next[l.cls] < members.length && left[members[next[l.cls]]] === 0) next[l.cls]++;
        if (next[l.cls] >= members.length) throw new Error(`layout: class ${l.cls} has more launches than its groups`);
        g = members[next[l.cls]];
        left[g]--;
      }
      const option = model.groups[g].members[0];
      return {
        option,
        optionId: options[option].id,
        launchAt: planAt(l),
        wakingSeconds: layout.classSeconds[l.cls],
        nights: layout.classNights[l.cls],
        doubled: layout.classVariant[l.cls] !== 'normal',
      };
    })
  );
  if (left.some(n => n !== 0)) throw new Error('layout: some group launches have no place on the calendar');
  if (!(model.fuelingRate > 0)) return { counts: current, calendar, stats };

  // The fueling pad (SPEC.md section 18). Everything above lays the plan out as if fuelling took no time; with a
  // fueling rate the whole calendar is then re-timed on the one pad (`schedulePad`), every slot keeping its order and
  // every launch its group, and what that leaves outside the plan's rules is settled: a doubled launch carried past
  // the 2x window's close is flown as its twin, a 1x launch brought inside it is flown doubled, as `settle` and
  // `promote` do, and a slot carried past the horizon loses a launch, the judge choosing which, until it ends in
  // time. A launch dropped, or one whose fuelling changes, re-times the plan. The times keep the pad, sleep and slot
  // rules by construction, and the result is verified the way `assertVerified` verifies it.
  const groupOfOption = new Map(model.groups.map((grp, g) => [grp.members[0], g]));
  const seqs = calendar.map(launches => launches.map(l => ({ g: groupOfOption.get(l.option)!, at: l.launchAt })));
  type Seq = (typeof seqs)[number];
  const optionOf = (g: number) => options[model.groups[g].members[0]];
  const blockOfGroup = (g: number) => {
    const o = optionOf(g);
    return o.atStartSeconds ?? o.actualTime + (o.nights ?? 0) * sleep.sleepSeconds;
  };
  const itemsOf = (from: readonly Seq[]): PadItem[][] =>
    from.map(seq =>
      seq.map(({ g, at }) => ({
        padSeconds: model.groups[g].padSeconds,
        block: blockOfGroup(g),
        launchAt: at,
        doubled: model.groups[g].variant !== 'normal',
        startVariant: model.groups[g].atStart,
      }))
    );
  // Re-times `into` on the pad, and returns, per slot, the launches that went up too late for the slot to end by the
  // horizon (`schedulePad`).
  const retime = (into: Seq[]) => {
    const times = schedulePad(itemsOf(into), sleep, realWindow);
    into.forEach((seq, k) => seq.forEach((l, i) => (l.at = times.launchAt[k][i])));
    return times.late;
  };
  const endOf = (seq: Seq) => (seq.length > 0 ? seq[seq.length - 1].at + blockOfGroup(seq[seq.length - 1].g) : 0);
  const overHorizon = (seq: Seq) => endOf(seq) > sleep.horizonSeconds + LAYOUT_TOL;
  const removeLaunch = (seq: Seq, i: number) => {
    current[seq[i].g]--;
    stats.launchesTrimmed++;
    seq.splice(i, 1);
  };

  // The 2x window against the re-timed plan, both ways, at the times it has (SPEC.md section 16). True when the pad
  // sequence changed: a launch left the plan, or one is now flown as a group that fuels for less (a stand-in).
  const settleWindow = (): boolean => {
    let changed = false;
    const fly = (l: Seq[number], to: number) => {
      if (model.groups[to].padSeconds !== model.groups[l.g].padSeconds) changed = true;
      move(l.g, to);
      l.g = to;
    };
    for (const seq of seqs) {
      if (!(realWindow > 0)) break;
      for (let i = 0; i < seq.length; i++) {
        const grp = model.groups[seq[i].g];
        if (grp.variant === 'normal' || seq[i].at <= realWindow + LAYOUT_TOL) continue;
        if (grp.twin >= 0) {
          fly(seq[i], grp.twin);
          stats.launchesDemoted = (stats.launchesDemoted ?? 0) + 1;
        } else {
          removeLaunch(seq, i--);
          changed = true;
        }
      }
      // A 1x launch at the close itself, within the verifier's microsecond, may stay 1x (section 16); one the pad has
      // brought there is left so, rather than promoted into a second `overhang` its slot may have no room for.
      const inside = seq.flatMap((l, i) =>
        model.groups[l.g].variant !== 'normal'
          ? l.at <= realWindow + LAYOUT_TOL
            ? [i]
            : []
          : l.at < realWindow - VERIFY_TOL_SECONDS
            ? [i]
            : []
      );
      const relabel = (i: number, want: DoubledVariant): boolean => {
        const grp = model.groups[seq[i].g];
        if (grp.variant === want) return true;
        if (grp.variant === 'normal' && !onMenu(seq[i].g, want)) return false;
        const to = grp.copy[want];
        if (to < 0) return false;
        if (grp.variant === 'normal') stats.launchesPromoted = (stats.launchesPromoted ?? 0) + 1;
        fly(seq[i], to);
        return true;
      };
      if (inside.length > 0) {
        const last = inside[inside.length - 1];
        let overhangLeft = false;
        for (const i of inside.slice(0, -1)) {
          if (!relabel(i, 'event') && model.groups[seq[i].g].variant === 'overhang') overhangLeft = true;
        }
        if (!(overhangLeft && relabel(last, 'event'))) relabel(last, 'overhang');
      }
      // One `overhang` a slot, as the window rows and the arena's labelled packer have it: a later one that found no
      // `event` copy to become is flown at 1x when it goes up at the close itself, and leaves the plan otherwise.
      for (
        let i = seq.length - 1, seen = seq.filter(l => model.groups[l.g].variant === 'overhang').length;
        i >= 0;
        i--
      ) {
        if (seen <= 1) break;
        const grp = model.groups[seq[i].g];
        if (grp.variant !== 'overhang') continue;
        seen--;
        if (grp.twin >= 0 && seq[i].at >= realWindow - VERIFY_TOL_SECONDS) {
          fly(seq[i], grp.twin);
          stats.launchesDemoted = (stats.launchesDemoted ?? 0) + 1;
        } else {
          removeLaunch(seq, i);
          changed = true;
        }
      }
      // A 1x launch the model has no copy for, where the menu could double it, cannot fly there.
      let lastInside = -1;
      seq.forEach((l, i) => l.at <= realWindow + VERIFY_TOL_SECONDS && (lastInside = i));
      for (let i = seq.length - 1; i >= 0; i--) {
        const grp = model.groups[seq[i].g];
        if (grp.variant !== 'normal' || !(seq[i].at < realWindow - VERIFY_TOL_SECONDS)) continue;
        if (onMenu(seq[i].g, i === lastInside ? 'overhang' : 'event')) {
          removeLaunch(seq, i);
          changed = true;
        }
      }
    }
    return changed;
  };

  // One launch off slot `k`, which ends past the horizon: the last of one of its groups, the judge choosing which
  // among the drops that bring the slot back inside the horizon once the plan is re-timed, or, when none does, the
  // slot's last launch.
  const dropFrom = (k: number) => {
    const seq = seqs[k];
    let best: { value: number; i: number } | null = null;
    for (const g of new Set(seq.map(l => l.g))) {
      const i = seq.map(l => l.g).lastIndexOf(g);
      const trial = seqs.map(other => other.map(l => ({ ...l })));
      trial[k].splice(i, 1);
      retime(trial);
      if (overHorizon(trial[k])) continue;
      current[g]--;
      const value = judged();
      current[g]++;
      if (best === null || value > best.value) best = { value, i };
    }
    removeLaunch(seq, best?.i ?? seq.length - 1);
  };

  // A launch the pad made go up too late for its slot to end by the horizon means the slot has to lose one; left to
  // itself the delay runs on through the slot, and with a sleep window a launch carried past a bedtime waits for the
  // next wake-up and takes the slot's whole timeline a night later with it. So the slot loses one launch where that
  // keeps its timeline instead: the last of one of its groups up to the late launch (or the first after it), the
  // judge choosing which among the drops after which the slot's first late launch is a later one, or among them all
  // when none is.
  const repair = (k: number, i: number, nearFirst: boolean) => {
    const seq = seqs[k];
    const when = seq[i].at;
    const groups = seq.map(l => l.g);
    // Where a drop keeps the slot's timeline where it is: the run of launches that went up back to back into the late
    // one, the late one, and the one after it. A drop further off can also leave nothing late, by giving the rest of
    // the slot a day to slide into, and then the slide takes the slot's nights with it, so those are tried only when
    // no nearby drop does.
    let first = i;
    while (first > 0 && seq[first - 1].at + blockOfGroup(seq[first - 1].g) >= seq[first].at - LAYOUT_TOL) first--;
    const near = [
      ...groups.slice(first, i + 1).map((g, j) => ({ g, at: first + j })),
      ...(i + 1 < seq.length ? [{ g: groups[i + 1], at: i + 1 }] : []),
    ];
    const far = [...new Set(groups)].map(g => {
      const before = groups.slice(0, i + 1).lastIndexOf(g);
      return { g, at: before >= 0 ? before : groups.indexOf(g) };
    });
    const choose = (candidates: readonly { g: number; at: number }[]) => {
      let best: { value: number; at: number; resolved: boolean } | null = null;
      const tried = new Set<number>();
      for (const { g, at } of candidates) {
        if (tried.has(g)) continue;
        tried.add(g);
        const trial = seqs.map(other => other.map(l => ({ ...l })));
        trial[k].splice(at, 1);
        const late = retime(trial)[k];
        const resolved = late.length === 0 || trial[k][late[0]].at > when + LAYOUT_TOL;
        current[g]--;
        const value = judged();
        current[g]++;
        if (best === null || (resolved && !best.resolved) || (resolved === best.resolved && value > best.value)) {
          best = { value, at, resolved };
        }
      }
      return best;
    };
    // The nearest occurrence of each group first, so a group is tried where its drop is most local.
    const local = nearFirst ? choose([...near].reverse()) : null;
    const best = local?.resolved ? local : (choose(far) ?? local);
    removeLaunch(seq, best!.at);
  };

  // Every slot's first launch waits for its own fuelling after T+0, which the plan's MILP charges at the shortest
  // fuelling of any class the slot flies (`padLevelsOf` in `milp.ts`). So each slot's launch that fuels the fastest,
  // of those as doubled as its first, goes first instead, when that leaves no more launches late across the plan.
  const lateCount = (late: number[][]) => late.reduce((a, positions) => a + positions.length, 0);

  const fastestFirst = () => {
    let lateNow = lateCount(retime(seqs));
    seqs.forEach((seq, k) => {
      // A launch at T+0 in the night goes up there or nowhere, so a slot that starts with one keeps it first.
      if (seq.length < 2 || model.groups[seq[0].g].atStart) return;
      const doubled = (l: Seq[number]) => model.groups[l.g].variant !== 'normal';
      let fastest = 0;
      seq.forEach((l, i) => {
        if (doubled(l) === doubled(seq[0]) && model.groups[l.g].padSeconds < model.groups[seq[fastest].g].padSeconds) {
          fastest = i;
        }
      });
      if (fastest === 0) return;
      const trial = seqs.map(other => other.map(l => ({ ...l })));
      trial[k].unshift(...trial[k].splice(fastest, 1));
      const late = lateCount(retime(trial));
      if (late > lateNow) return;
      seq.unshift(...seq.splice(fastest, 1));
      lateNow = late;
    });
  };

  const total = seqs.reduce((a, seq) => a + seq.length, 0);
  const rounds = (nearFirst: boolean) => {
    for (let round = 0; round <= total + model.slots; round++) {
      const late = retime(seqs);
      if (settleWindow()) continue;
      let first: { k: number; i: number } | null = null;
      late.forEach((positions, k) => {
        const i = positions[0];
        if (i !== undefined && (first === null || seqs[k][i].at < seqs[first.k][first.i].at)) first = { k, i };
      });
      if (first !== null) {
        repair((first as { k: number; i: number }).k, (first as { k: number; i: number }).i, nearFirst);
        continue;
      }
      const over = seqs.findIndex(overHorizon);
      if (over < 0) break;
      dropFrom(over);
    }
  };
  // Which drops a repair tries first is a heuristic either way: those anywhere in the slot can let the rest of it slide
  // a day, taking its nights with it, and those near the late launch can cost a launch where a slide would have cost
  // nothing. Moving the fastest-fuelling launch first is one too: it can move an overnight ship to a morning the slot
  // needed for something else. So the stage runs each way, from the same start, and the judge keeps the better plan,
  // ties to the first.
  const snapshot = () => ({
    seqs: seqs.map(seq => seq.map(l => ({ ...l }))),
    counts: current.slice(),
    stats: { ...stats },
  });
  const restoreSnapshot = (saved: ReturnType<typeof snapshot>) => {
    saved.seqs.forEach((seq, k) => seqs[k].splice(0, seqs[k].length, ...seq.map(l => ({ ...l }))));
    saved.counts.forEach((n, g) => (current[g] = n));
    Object.assign(stats, saved.stats);
  };
  const start = snapshot();
  let kept: { value: number; saved: ReturnType<typeof snapshot> } | null = null;
  for (const [fastest, nearFirst] of [
    [true, false],
    [true, true],
    [false, false],
    [false, true],
  ]) {
    restoreSnapshot(start);
    if (fastest) fastestFirst();
    rounds(nearFirst);
    const value = judged();
    if (kept === null || value > kept.value) kept = { value, saved: snapshot() };
  }
  restoreSnapshot(kept!.saved);

  // The times as the verifier reads them: the pad rule over the plan, then each slot with the start chain read off
  // those times. A fault here is a launch the rounds above could not settle within their bound; it leaves the plan,
  // at the times it has, until the plan verifies. Removing a launch never breaks the pad rule for the rest.
  const timedSlots = () => {
    const pads = seqs.map(seq => seq.map(l => ({ launchAt: l.at, padSeconds: model.groups[l.g].padSeconds })));
    const chained = startChain(pads);
    return { pads, chained };
  };
  for (let guard = 0; guard <= total; guard++) {
    const { pads, chained } = timedSlots();
    if (padFault(pads) !== null) throw new Error(`layout: the pad schedule fails the pad rule: ${padFault(pads)}`);
    let fixed = true;
    for (let k = 0; k < seqs.length && fixed; k++) {
      const timed = (n: number) =>
        seqs[k].slice(0, n).map((l, i) => ({
          launchAt: l.at,
          wakingSeconds: model.groups[l.g].timeSeconds,
          nights: model.groups[l.g].nights,
          doubled: model.groups[l.g].variant !== 'normal',
          ...(optionOf(l.g).atStartSeconds !== undefined && { atStartSeconds: optionOf(l.g).atStartSeconds }),
          eventCopy: menuCopies[model.groups[l.g].members[0]].event,
          overhangCopy: menuCopies[model.groups[l.g].members[0]].overhang,
          startChain: chained[k][i],
        }));
      if (verify(timed(seqs[k].length), sleep, realWindow) === null) continue;
      let n = 1;
      while (n < seqs[k].length && verify(timed(n), sleep, realWindow) === null) n++;
      removeLaunch(seqs[k], n - 1);
      fixed = false;
    }
    if (fixed) break;
  }

  const padded = seqs.map(seq =>
    seq.map(({ g, at }) => {
      const option = model.groups[g].members[0];
      return {
        option,
        optionId: options[option].id,
        launchAt: at,
        wakingSeconds: model.groups[g].timeSeconds,
        nights: model.groups[g].nights,
        doubled: model.groups[g].variant !== 'normal',
      };
    })
  );
  return { counts: current, calendar: padded, stats };
}
