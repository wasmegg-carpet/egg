// Laying a sleep-aware plan out on real days: per slot, which waking window each daytime launch is flown in
// and when each overnight ship goes, as launch times the verifier then checks. What does not fit is trimmed,
// one launch at a time, by the solver's own judge. See SPEC.md section 10.

import type { LaunchOption } from '../types';
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

// Each overnight launch, then null connectors until the nights sum to the slot's. Ordered by flex,
// alternately largest and smallest so a long landing is followed by a short take-off, with the smallest last
// so nothing lands past the final wake-up into a short tail. A heuristic: another order may place more,
// which makes what this layout places a lower bound on what fits, never an over-statement.
export function connectorsOf(
  counts: readonly number[],
  ctx: Pick<SlotContext, 'classSeconds' | 'classNights' | 'day'>
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
  const sorted = all.sort((a, b) => a.flex - b.flex || a.cls - b.cls);
  const last = sorted.shift();
  const out: Connector[] = [];
  for (let lo = 0, hi = sorted.length - 1, big = true; lo <= hi; big = !big)
    out.push(big ? sorted[hi--] : sorted[lo++]);
  if (last) out.push(last);
  return out;
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
  while (nightsOf() > day.nights) dropOvernight(overnight());
  for (;;) {
    const zeros = new Array<number>(day.nights + 2).fill(0);
    if (chainHeads(connectorsOf(counts, ctx), zeros, day).fail < 0) break;
    const candidates = overnight();
    if (candidates.length === 0) throw new Error('layout: a slot with no overnight launch has no room for its nights');
    // Prefer a drop that stands the chain up by itself; failing that, the judge's choice among them all.
    const fixes = candidates.filter(c => {
      counts[c]--;
      const ok = chainHeads(connectorsOf(counts, ctx), zeros, day).fail < 0;
      counts[c]++;
      return ok;
    });
    dropOvernight(fixes.length > 0 ? fixes : candidates);
  }
  const conns = connectorsOf(counts, ctx);
  const segments = conns.length + 1;

  const daytime = counts
    .flatMap((n, c) => (n > 0 && ctx.classNights[c] === 0 && ctx.classSeconds[c] > 0 ? [c] : []))
    .sort((a, b) => ctx.classSeconds[b] - ctx.classSeconds[a] || a - b);
  let placed = greedyFill(conns, daytime, counts, ctx);
  const complete = (p: Placement) => daytime.every((c, d) => p[d].reduce((a, n) => a + n, 0) === counts[c]);
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
  let startDay = 0;
  let after = 0;
  for (let j = 0; j < segments; j++) {
    const dayStart = startDay * DAY_SECONDS;
    let offset = after;
    daytime.forEach((c, d) => {
      for (let i = 0; i < placed[d][j]; i++) {
        launches.push({ cls: c, launchAt: dayStart + offset });
        offset += ctx.classSeconds[c];
      }
    });
    if (j < conns.length) {
      const conn = conns[j];
      if (conn.cls !== NULL_CONNECTOR) launches.push({ cls: conn.cls, launchAt: dayStart + W - heads[j] });
      after = conn.flex - heads[j];
      startDay += conn.nights;
    }
  }
  return { launches, placed: counts };
}

export interface PlanLayout {
  // Per group, the plan that was laid out: the solve's counts less every launch trimmed.
  counts: number[];
  calendar: CalendarLaunch[][];
  stats: LayoutStats;
}

export type SlotVerifier = (launches: readonly TimedLaunch[], sleep: SleepWindow) => string | null;

// Lays the whole plan out slot by slot, from the MILP's own per-slot class columns, which are the packing it
// certified. `judge` scores a vector of group counts (higher is better); every trim decrements the group,
// within the classes allowed, whose loss it misses least. A slot the verifier rejects loses one more launch,
// by the same rule, and is laid out again; an empty slot always verifies, so this ends.
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
  if (day === null) throw new Error('layout: the problem has no sleep window to lay out against');
  const sleep: SleepWindow = { sleepSeconds: day.sleepSeconds, horizonSeconds: day.horizonSeconds };
  const current = counts.slice();
  const stats: LayoutStats = {
    launchesTrimmed: 0,
    overnightTrimmed: 0,
    layoutSolves: 0,
    marginResolves: 0,
    verifierRetries: 0,
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

  const ctx: SlotContext = {
    classSeconds: layout.classSeconds,
    classNights: layout.classNights,
    day,
    solve,
    drop,
    stats,
  };
  const bySlot: ClassLaunch[][] = [];
  for (let k = 0; k < model.slots; k++) {
    let want = demand[k];
    for (;;) {
      const { launches, placed } = layOutSlot(want, ctx);
      const timed = launches.map(l => ({
        launchAt: l.launchAt,
        wakingSeconds: layout.classSeconds[l.cls],
        nights: layout.classNights[l.cls],
      }));
      if (verify(timed, sleep) === null) {
        bySlot.push(launches);
        break;
      }
      stats.verifierRetries++;
      const present = placed.flatMap((n, c) => (n > 0 ? [c] : []));
      if (present.length === 0) throw new Error(`layout: slot ${k} fails verification with nothing left in it`);
      want = placed.slice();
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
      };
    })
  );
  if (left.some(n => n !== 0)) throw new Error('layout: some group launches have no place on the calendar');
  return { counts: current, calendar, stats };
}
