// Laying a plan out as each slot's timeline, the calendar every plan is returned with. With a sleep window that
// is real work: per slot, which waking window each daytime launch is flown in and when each overnight ship goes,
// as launch times the verifier then checks, and what does not fit is trimmed, one launch at a time, by the
// solver's own judge (SPEC.md section 10). Without one it is exact and trivial: a slot's launches back to back,
// doubled ones first (SPEC.md section 12).

import type { CapacityVariant, LaunchOption } from '../types';
import type { DaySchedule } from './days';
import { nCol, type Layout } from './milp';
import type { Model } from './model';
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
import { slotFault, type TimedLaunch } from './verify';

// A node limit and never a timeout, for SPEC.md section 7's reason: the layout decides what is trimmed, so a
// clock here would make the plan a function of machine load.
export const LAYOUT_LIMITS: MilpLimits = { maxNodes: 1000, relGap: 1e-6 };

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
}

interface SlotContext {
  classSeconds: readonly number[];
  classNights: readonly number[];
  // Whether a class flies doubled (`event` or `overhang`), which the layout puts first so it starts inside the 2x
  // window (SPEC.md section 13). All false without a window, and then nothing below orders by it.
  doubled: readonly boolean[];
  day: DaySchedule;
  solve: MilpSolve;
  // Drops one launch of one of `candidates` from the plan, chosen by the judge, and returns its class.
  drop: (candidates: readonly number[]) => number;
  stats: LayoutStats;
}

interface ClassLaunch {
  cls: number;
  launchAt: number;
}

// Ordered by flex, alternately largest and smallest so a long landing is followed by a short take-off, and, when
// `smallestLast`, with the smallest held back to the end so nothing lands past the final wake-up into a short tail.
function alternating(conns: Connector[], smallestLast: boolean): Connector[] {
  const sorted = conns.sort((a, b) => a.flex - b.flex || a.cls - b.cls);
  const last = smallestLast ? sorted.shift() : undefined;
  const out: Connector[] = [];
  for (let lo = 0, hi = sorted.length - 1, big = true; lo <= hi; big = !big)
    out.push(big ? sorted[hi--] : sorted[lo++]);
  if (last) out.push(last);
  return out;
}

// Each overnight launch, then null connectors until the nights sum to the slot's, in `alternating` order. With
// `doubledFirst`, the doubled overnight ships go first, alternating among themselves from the largest flex (the
// one that can take off earliest in its day), and everything else follows in the usual order, so the ships that
// must start inside the 2x window take the first nights (SPEC.md section 13). A heuristic either way: another
// order may place more, which makes what this layout places a lower bound on what fits, never an over-statement.
export function connectorsOf(
  counts: readonly number[],
  ctx: Pick<SlotContext, 'classSeconds' | 'classNights' | 'day'> & Partial<Pick<SlotContext, 'doubled'>>,
  doubledFirst = false
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
  const doubled = all.filter(isDoubled);
  if (doubled.length === 0) return alternating(all, true);
  const rest = all.filter(conn => !isDoubled(conn));
  if (rest.length === 0) return alternating(doubled, true);
  return [...alternating(doubled, false), ...alternating(rest, true)];
}

// Segment `j` is the waking time between connector `j - 1` landing and connector `j` leaving; the last one is
// the trailing partial day.
function capacityOf(j: number, conns: readonly Connector[], day: DaySchedule): number {
  return j < conns.length ? day.wakingSeconds : day.tailSeconds;
}

// Each connector's head, given the daytime seconds `used` in each segment, or the first segment that cannot
// hold its share. Taking every head as large as its segment allows is exact rather than greedy: a larger head
// only shortens the landing that the next segment has to absorb.
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
    const h = Math.min(conn.flex, W, W - after - used[j]);
    if (h < lo - LAYOUT_TOL) return { heads, fail: j };
    const head = Math.max(h, lo);
    heads.push(head);
    after = conn.flex - head;
  }
  if (after + used[conns.length] > day.tailSeconds + LAYOUT_TOL) return { heads, fail: conns.length };
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

// Largest first, each into the earliest segment that takes it with the overnight chain still standing. Exact
// in seconds, and when it places everything it is optimal and no MILP is needed.
function greedyFill(
  conns: readonly Connector[],
  daytime: readonly number[],
  counts: readonly number[],
  ctx: SlotContext
): Placement {
  const segments = conns.length + 1;
  const used = new Array<number>(segments).fill(0);
  return daytime.map(c => {
    const s = ctx.classSeconds[c];
    const row = new Array<number>(segments).fill(0);
    let remaining = counts[c];
    for (let j = 0; j < segments && remaining > 0; j++) {
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
// waking time placed.
function layoutMilp(
  conns: readonly Connector[],
  daytime: readonly number[],
  counts: readonly number[],
  ctx: SlotContext,
  margin: number
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
  daytime.forEach((c, d) => {
    const s = ctx.classSeconds[c];
    for (let j = 0; j < segments; j++) {
      const col = d * segments + j;
      columnUpper[col] = Math.min(counts[c], Math.floor(capacityOf(j, conns, ctx.day) / s + 1e-9));
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
  margin: number
): Placement | null {
  const { model, upper } = layoutMilp(conns, daytime, counts, ctx, margin);
  ctx.stats.layoutSolves++;
  const solution = ctx.solve(model, LAYOUT_LIMITS);
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

// Lays one slot's launches (`demand`, per class) out on its days. Launches it cannot place are dropped through
// `ctx.drop`; what comes back is every launch kept, in launch order, and the per-class counts of those.
function layOutSlot(demand: readonly number[], ctx: SlotContext): { launches: ClassLaunch[]; placed: number[] } {
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
  // doubled ship the two are one order, tried once.
  const zeros = new Array<number>(day.nights + 2).fill(0);
  const standing = (): Connector[] | null => {
    const first = connectorsOf(counts, ctx, true);
    if (chainHeads(first, zeros, day).fail < 0) return first;
    if (!counts.some((n, c) => n > 0 && ctx.classNights[c] > 0 && ctx.doubled[c])) return null;
    const usual = connectorsOf(counts, ctx);
    return chainHeads(usual, zeros, day).fail < 0 ? usual : null;
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
    dropOvernight(fixes.length > 0 ? fixes : candidates);
  }
  const conns = standing()!;
  const segments = conns.length + 1;

  // Longest first, the greedy's packing order; with doubled classes on the slot, doubled ones first, so they take
  // the earliest segments, unless the usual order alone places more (SPEC.md section 13).
  const byLength = counts
    .flatMap((n, c) => (n > 0 && ctx.classNights[c] === 0 && ctx.classSeconds[c] > 0 ? [c] : []))
    .sort((a, b) => ctx.classSeconds[b] - ctx.classSeconds[a] || a - b);
  const daytime = byLength.some(c => ctx.doubled[c])
    ? [...byLength.filter(c => ctx.doubled[c]), ...byLength.filter(c => !ctx.doubled[c])]
    : byLength;
  let placed = greedyFill(conns, daytime, counts, ctx);
  const complete = (p: Placement) => daytime.every((c, d) => p[d].reduce((a, n) => a + n, 0) === counts[c]);
  if (!complete(placed) && daytime !== byLength) {
    const usual = greedyFill(conns, byLength, counts, ctx);
    const reindexed = daytime.map(c => usual[byLength.indexOf(c)]);
    if (placedSeconds(reindexed, daytime, ctx) > placedSeconds(placed, daytime, ctx)) placed = reindexed;
  }
  if (!complete(placed)) {
    let solved = solveLayout(conns, daytime, counts, ctx, 0);
    if (solved && !standsExactly(solved, conns, daytime, ctx)) {
      ctx.stats.marginResolves++;
      const again = solveLayout(conns, daytime, counts, ctx, MARGIN_SECONDS);
      solved = again && standsExactly(again, conns, daytime, ctx) ? again : repair(solved, conns, daytime, ctx);
    }
    if (solved && placedSeconds(solved, daytime, ctx) > placedSeconds(placed, daytime, ctx)) placed = solved;
  }

  // Whatever is not placed leaves the plan, one launch at a time, each the one the judge misses least.
  daytime.forEach((c, d) => {
    const left = counts[c] - placed[d].reduce((a, n) => a + n, 0);
    for (let i = 0; i < left; i++) counts[ctx.drop([c])]--;
  });

  const { heads, fail } = chainHeads(conns, usedOf(placed, daytime, ctx, segments), day);
  if (fail >= 0) throw new Error(`layout: segment ${fail} over-full after placement`);

  const launches: ClassLaunch[] = [];
  // A zero-second daytime launch takes no time at all; it goes at the very start.
  counts.forEach((n, c) => {
    if (ctx.classNights[c] === 0 && !(ctx.classSeconds[c] > 0))
      for (let i = 0; i < n; i++) launches.push({ cls: c, launchAt: 0 });
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
    let offset = after;
    for (const d of launchOrder) {
      const c = daytime[d];
      for (let i = 0; i < placed[d][j]; i++) {
        launches.push({ cls: c, launchAt: dayStart + offset });
        offset += ctx.classSeconds[c];
      }
    }
    if (j < conns.length) {
      const conn = conns[j];
      if (conn.cls !== NULL_CONNECTOR) launches.push({ cls: conn.cls, launchAt: dayStart + W - heads[j] });
      after = conn.flex - heads[j];
      startDay += conn.nights;
    }
  }
  return { launches, placed: counts };
}

// What one slot's timeline is verified against. Without a sleep window: no sleep, and the slot itself as the
// horizon, so the verifier's rules reduce to launches going up back to back inside the slot (SPEC.md section 12).
export function timelineOf(model: Model): SleepWindow {
  return model.day
    ? { sleepSeconds: model.day.sleepSeconds, horizonSeconds: model.day.horizonSeconds }
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
  verify: SlotVerifier = slotFault
): PlanLayout {
  const day = model.day;
  const sleep = timelineOf(model);
  const window = model.eventWindowSeconds;
  const current = counts.slice();
  const stats: LayoutStats = {
    launchesTrimmed: 0,
    overnightTrimmed: 0,
    layoutSolves: 0,
    marginResolves: 0,
    verifierRetries: 0,
    ...(day !== null && window > 0 && { launchesDemoted: 0 }),
  };
  const groupsOf: number[][] = Array.from({ length: layout.classes }, () => []);
  for (let g = 0; g < layout.groups; g++) groupsOf[layout.classOf[g]].push(g);

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
      const key = `${layout.classSeconds[l.cls]}/${layout.classNights[l.cls]}`;
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
      const late = positions.slice(0, doubled.length).filter(i => launches[i].launchAt > window + LAYOUT_TOL).length;
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

  // The slot columns and the group totals are tied by the class rows, so after rounding they agree; were they
  // ever not to, a slot launch with no group behind it is taken off the latest slot, and a group launch with
  // no slot behind it is trimmed.
  const demand: number[][] = Array.from({ length: model.slots }, (_, k) =>
    Array.from({ length: layout.classes }, (_, c) => {
      const v = columnValues[nCol(layout, c, k)];
      return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
    })
  );
  for (let c = 0; c < layout.classes; c++) {
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
      launchAt: l.launchAt,
      wakingSeconds: layout.classSeconds[l.cls],
      nights: layout.classNights[l.cls],
      doubled: layout.classVariant[l.cls] !== 'normal',
    }));
  const bySlot: ClassLaunch[][] = [];
  for (let k = 0; k < model.slots && day === null; k++) {
    const launches = backToBack(demand[k], layout);
    const fault = verify(timedOf(launches), sleep, window);
    if (fault !== null) throw new Error(`layout: slot ${k} laid back to back fails verification: ${fault}`);
    bySlot.push(launches);
  }
  const ctx: SlotContext | null = day && {
    classSeconds: layout.classSeconds,
    classNights: layout.classNights,
    doubled: layout.classVariant.map(v => v !== 'normal'),
    day,
    solve,
    drop,
    stats,
  };
  for (let k = 0; k < model.slots && ctx !== null; k++) {
    let want = demand[k];
    for (;;) {
      const launches = settle(layOutSlot(want, ctx).launches);
      if (verify(timedOf(launches), sleep, window) === null) {
        bySlot.push(launches);
        break;
      }
      stats.verifierRetries++;
      const placed = new Array<number>(layout.classes).fill(0);
      for (const l of launches) placed[l.cls]++;
      const present = placed.flatMap((n, c) => (n > 0 ? [c] : []));
      if (present.length === 0) throw new Error(`layout: slot ${k} fails verification with nothing left in it`);
      want = placed;
      want[drop(present)]--;
    }
  }

  // Each class's launches go to its groups in group order, slot by slot; a group's launches are all flown as
  // its first member, as `emit` reports them.
  const left = current.slice();
  const next = new Array<number>(layout.classes).fill(0);
  const calendar = bySlot.map(launches =>
    launches.map(l => {
      const members = groupsOf[l.cls];
      while (next[l.cls] < members.length && left[members[next[l.cls]]] === 0) next[l.cls]++;
      if (next[l.cls] >= members.length) throw new Error(`layout: class ${l.cls} has more launches than its groups`);
      const g = members[next[l.cls]];
      left[g]--;
      const option = model.groups[g].members[0];
      return {
        option,
        optionId: options[option].id,
        launchAt: l.launchAt,
        wakingSeconds: layout.classSeconds[l.cls],
        nights: layout.classNights[l.cls],
        doubled: layout.classVariant[l.cls] !== 'normal',
      };
    })
  );
  if (left.some(n => n !== 0)) throw new Error('layout: some group launches have no place on the calendar');
  return { counts: current, calendar, stats };
}
