/**
 * The arithmetic that turns a table build (src/buildTable/cell.ts `BuildParams`) into the time to
 * any target TE, ported from AutoAutoAP (github.com/william-egginc/AutoAutoAP, branch
 * ascension-chain-search, src/search/precomputedLeg.ts). Unlike cell.ts's `tailTo`, the tail here also
 * carries the end egg counts forward and can start late into the table's hour, which the route
 * search needs.
 *
 * Kept free of the simulator's shift code so the Chain Finder worker stays small: auto/shifts/
 * te-wait.ts pulls in the engine and the game data, so its `distributeTargetTE` is replaced by
 * `greedyOrder` (the same goal sharing, one TE at a time), and `tailTo` takes `sweepTails`' steps for
 * its one target. Both give the simulator's numbers to the bit; AutoAutoAP's `tailTo` and
 * `canonicalDelivered`, run alongside, agreed on every route tried.
 */
import { getTimezoneOffsetAt, PACIFIC_TIMEZONE } from 'lib/planners/events';
import { TE_BREAKPOINTS } from '@/lib/truthEggs';
import type { BuildParams } from '@/buildTable/cell';
import type { VirtueEgg } from '@/types';

export type { BuildParams };

/** The five eggs in table order (cell.ts `EGG_ORDER`); also the order `delivered` is stored in. */
export const EGG_ORDER: VirtueEgg[] = ['curiosity', 'kindness', 'integrity', 'resilience', 'humility'];

/** The waits after the build, in `allShifts` order (K3, C4, I2, R2, H2). */
const WAIT_ORDER: VirtueEgg[] = ['kindness', 'curiosity', 'integrity', 'resilience', 'humility'];

/**
 * The egg a tail's farm is on when it ends (EGG_ORDER index), AutoAutoAP's `lastWaitEgg`: the last in
 * the waits' order whose count the waits raised, from the counts when K3's wait began to the end;
 * kindness (K3's own) when none was.
 */
export function lastWaitEgg(waitStart: number[], end: number[]): number {
  let egg: VirtueEgg = WAIT_ORDER[0];
  for (const e of WAIT_ORDER) {
    const i = EGG_ORDER.indexOf(e);
    if ((end[i] ?? 0) > (waitStart[i] ?? 0)) egg = e;
  }
  return EGG_ORDER.indexOf(egg);
}

/** Hours in a week: the table's second key. Hour 0 = Monday 00:00 Pacific. */
export const WEEK_HOURS = 168;

export interface Tail {
  /** Seconds from the ascension's start to its end. */
  seconds: number;
  /** TE when it ends. Usually the target; more when K3's wait for the sale overshoots it. */
  endTE: number;
  /** Eggs delivered on each egg when it ends (EGG_ORDER): where the next ascension starts from. */
  delivered: number[];
}

const canonicalCache = new Map<number, number[]>();
/**
 * Eggs delivered per egg (EGG_ORDER) at TE `te`, shared the way the simulator shares a goal, each egg
 * exactly on its threshold: every table build starts from this (cell.ts `canonicalDelivered`).
 */
export function canonicalDelivered(te: number): number[] {
  const hit = canonicalCache.get(te);
  if (hit) return hit;
  const perEgg = [0, 0, 0, 0, 0];
  for (const e of greedyOrder([0, 0, 0, 0, 0], GREEDY_IDX, te)) perEgg[e]++;
  const out = perEgg.map(n => (n > 0 ? TE_BREAKPOINTS[n - 1] : 0));
  canonicalCache.set(te, out);
  return out;
}

/**
 * A table build moved onto real egg counts at the same TE: the eggs the build itself delivers, added
 * to these. The build's own eggs come from earnings, not TE thresholds, so this is exact.
 */
export function rebase(b: BuildParams, te: number, delivered: number[]): BuildParams {
  const canon = canonicalDelivered(te);
  return { ...b, delivered: b.delivered.map((d, i) => delivered[i] + (d - canon[i])) };
}

/**
 * The time from the ascension's start to `target` total TE with this build, or null when the eggs
 * cannot carry that much TE. `lateBy`: seconds into the table's hour it really starts, which moves the
 * sale's end that much sooner.
 */
export function tailTo(p: BuildParams, target: number, lateBy = 0): Tail | null {
  // `sweepTails` for the one target, without its arrays: the same steps in the same order, so the
  // same numbers to the bit (precomputedLeg.spec.ts). The route finder's hold pass prices many.
  const d = p.delivered;
  let now = 0;
  for (let e = 0; e < 5; e++) now += countTE(d[e] || 0);
  const m = Math.max(0, target - now);
  const all = greedyOrder(d, GREEDY_IDX, m);
  if (m > all.length) return null;
  let needK = 0;
  for (let i = 0; i < m; i++) if (all[i] === KIND) needK++;
  const rate = p.peakELR;
  const dk0 = d[KIND] || 0;
  let kWait = Math.max(0, p.saleEnd - lateBy - p.waitStart);
  if (needK > 0) {
    const tw = teWait(dk0, rate, needK);
    if (!Number.isFinite(tw)) return null;
    kWait = Math.max(kWait, tw);
  }
  const kEggs = kWait > 0 ? dk0 + rate * kWait : dk0;
  let t = p.waitStart;
  if (kWait > 0) t += kWait;
  let total = countTE(kEggs);
  const othersNow = now - countTE(dk0);
  const left = target - total - othersNow;
  if (left > m - needK) return null;
  const need = [0, 0, 0, 0, 0];
  for (let i = 0, k = 0; i < all.length && k < left; i++) {
    if (all[i] === KIND) continue;
    need[all[i]]++;
    k++;
  }
  const delivered = [0, 0, 0, 0, 0];
  delivered[KIND] = kEggs;
  for (const e of OTHERS_IDX) {
    const de = d[e] || 0;
    const tw = need[e] > 0 ? teWait(de, rate, need[e]) : 0;
    if (!Number.isFinite(tw)) return null;
    if (need[e] > 0 && tw > 0) t += tw;
    delivered[e] = need[e] > 0 && tw > 0 ? de + rate * tw : de;
    total += countTE(delivered[e]);
  }
  return total >= target ? { seconds: t, endTE: total, delivered } : null;
}

/** The fastest of a start's builds to `target` (least time, the first of equals), or null. */
export function bestTailTo(builds: BuildParams[], target: number, lateBy = 0): (Tail & { build: BuildParams }) | null {
  let best: (Tail & { build: BuildParams }) | null = null;
  for (const b of builds) {
    const t = tailTo(b, target, lateBy);
    if (t && (!best || t.seconds < best.seconds)) best = { ...t, build: b };
  }
  return best;
}

/** `distributeTargetTE`'s own egg order, which breaks ties, as EGG_ORDER positions. */
const GREEDY_IDX = [0, 2, 3, 4, 1];
/** The four eggs after kindness, in the order they wait (C4, I2, R2, H2), as EGG_ORDER positions. */
const OTHERS_IDX = [0, 2, 3, 4];
const KIND = 1;
const MAX_TE = TE_BREAKPOINTS.length;

/** `countTEThresholdsPassed` by halving. */
function countTE(d: number): number {
  let lo = 0;
  let hi = MAX_TE;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (d >= TE_BREAKPOINTS[mid]) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * TE with a fraction: the TE the eggs have passed, plus how far the egg nearest its next threshold
 * is toward it. Never a whole TE more than is earned (summing every egg's fraction would be). For
 * showing how far past a stop a route is, never for the search.
 */
export function exactTE(delivered: ArrayLike<number>): number {
  let te = 0;
  let nearest = 0;
  for (let e = 0; e < 5; e++) {
    const d = delivered[e] || 0;
    const n = countTE(d);
    te += n;
    if (n < MAX_TE) {
      const from = n > 0 ? TE_BREAKPOINTS[n - 1] : 0;
      nearest = Math.max(nearest, Math.min(1, Math.max(0, d - from) / (TE_BREAKPOINTS[n] - from)));
    }
  }
  return te + Math.min(nearest, 0.999);
}

/** `timeToEarnTE`, the same arithmetic. */
function teWait(d: number, rate: number, n: number): number {
  if (n <= 0) return 0;
  if (rate <= 0) return Infinity;
  const target = countTE(d) + n;
  if (target > MAX_TE) return Infinity;
  return Math.max(0, (TE_BREAKPOINTS[target - 1] - d) / rate + 0.001);
}

/**
 * The order `distributeTargetTE` hands out TEs one at a time from these counts (cheapest next
 * threshold first, ties to its own egg order), among `eggs` only, up to `max` of them.
 */
function greedyOrder(delivered: ArrayLike<number>, eggs: number[], max: number): Int8Array {
  const targets = [0, 0, 0, 0, 0];
  const at = [0, 0, 0, 0, 0];
  for (let e = 0; e < 5; e++) {
    at[e] = delivered[e] || 0;
    targets[e] = countTE(at[e]);
  }
  const order = GREEDY_IDX.filter(e => eggs.includes(e));
  const out = new Int8Array(max);
  let n = 0;
  while (n < max) {
    let best = -1;
    let bestCost = Infinity;
    for (const e of order) {
      const t = targets[e];
      if (t >= MAX_TE) continue;
      const cost = Math.max(0, TE_BREAKPOINTS[t] - at[e]);
      if (cost < bestCost) {
        bestCost = cost;
        best = e;
      }
    }
    if (best < 0) break;
    targets[best]++;
    at[best] = TE_BREAKPOINTS[targets[best] - 1];
    out[n++] = best;
  }
  return out.subarray(0, n);
}

/** A sweep's objects and array headers beyond the arrays' own bytes, for the cache's budget. */
const SWEEP_OVERHEAD = 4500;

/** Every target's tail from one build at once (`sweepTails`); index = target - `from`. */
export interface TailSweep {
  from: number;
  to: number;
  /** Seconds to each target; NaN where it cannot be reached. */
  seconds: Float64Array;
  endTE: Int16Array;
  /** The end egg counts for index `i` (EGG_ORDER), written into `out`. */
  deliveredInto(i: number, out: number[] | Float64Array): void;
  /** About what it holds in memory, bytes. */
  bytes: number;
}

/**
 * `tailTo` for every target from `lowest` (default: one above where the counts stand) up to `top` in
 * one pass, the same numbers to the last bit. The goal-sharing `tailTo` redoes per target hands out
 * TEs cheapest first, so it is worked out once: kindness's share of a goal m TEs up is how many of the
 * first m go to kindness, and the other four take the first TEs of the same order without kindness.
 */
export function sweepTails(p: BuildParams, top: number, lateBy = 0, lowest?: number): TailSweep {
  const d = p.delivered;
  const c = [0, 0, 0, 0, 0];
  let now = 0;
  for (let e = 0; e < 5; e++) {
    c[e] = countTE(d[e] || 0);
    now += c[e];
  }
  const from = Math.min(now + 1, lowest ?? now + 1);
  const to = Math.max(from - 1, top);
  const n = to - from + 1;
  const seconds = new Float64Array(Math.max(0, n)).fill(NaN);
  const endTE = new Int16Array(Math.max(0, n));
  // Worked out here rather than in a closure over this function's arrays, which would keep them all.
  const ends = new Float64Array(5 * Math.max(0, n));
  if (n <= 0) return { from, to, seconds, endTE, deliveredInto: () => {}, bytes: SWEEP_OVERHEAD };

  const span = Math.max(0, to - now);
  const all = greedyOrder(d, GREEDY_IDX, span);
  // Leaving kindness out does not reorder the rest: each egg's thresholds are its own.
  const others = all.filter(e => e !== KIND);
  // kind[m]: kindness's TEs among the first m; per[e * (L + 1) + m]: egg e's among the first m of theirs.
  const kind = new Int16Array(all.length + 1);
  for (let i = 0; i < all.length; i++) kind[i + 1] = kind[i] + (all[i] === KIND ? 1 : 0);
  const L = others.length;
  const per = new Int16Array(5 * (L + 1));
  for (let i = 0; i < L; i++) {
    for (const e of OTHERS_IDX) per[e * (L + 1) + i + 1] = per[e * (L + 1) + i] + (others[i] === e ? 1 : 0);
  }
  const othersNow = c[0] + c[2] + c[3] + c[4];
  const saleEnd = p.saleEnd - lateBy;
  const rate = p.peakELR;
  const dk0 = d[KIND] || 0;
  const mandatory = Math.max(0, saleEnd - p.waitStart);

  // Each (egg, count asked of it) is worked out once; every target adds them up in the same order.
  const kWait = new Float64Array(all.length + 1).fill(NaN);
  const kEggs = new Float64Array(all.length + 1);
  const kTE = new Int16Array(all.length + 1);
  const kindFor = (need: number): boolean => {
    if (!Number.isNaN(kWait[need])) return Number.isFinite(kWait[need]);
    let wait = mandatory;
    if (need > 0) {
      const tw = teWait(dk0, rate, need);
      if (!Number.isFinite(tw)) {
        kWait[need] = Infinity;
        return false;
      }
      wait = Math.max(wait, tw);
    }
    kWait[need] = wait;
    kEggs[need] = wait > 0 ? dk0 + rate * wait : dk0;
    kTE[need] = countTE(kEggs[need]);
    return true;
  };
  const oWait = new Float64Array(5 * (L + 1)).fill(NaN);
  const oEggs = new Float64Array(5 * (L + 1));
  const oTE = new Int16Array(5 * (L + 1));
  const otherFor = (e: number, need: number): boolean => {
    const at = e * (L + 1) + need;
    if (!Number.isNaN(oWait[at])) return Number.isFinite(oWait[at]);
    const de = d[e] || 0;
    const tw = need > 0 ? teWait(de, rate, need) : 0;
    if (!Number.isFinite(tw)) {
      oWait[at] = Infinity;
      return false;
    }
    oWait[at] = tw;
    oEggs[at] = need > 0 && tw > 0 ? de + rate * tw : de;
    oTE[at] = countTE(oEggs[at]);
    return true;
  };

  for (let target = from; target <= to; target++) {
    const m = Math.max(0, target - now);
    if (m > all.length) break;
    // K3: the later of the sale ending and kindness's share.
    const needK = kind[m];
    if (!kindFor(needK)) continue;
    let t = p.waitStart;
    if (kWait[needK] > 0) t += kWait[needK];
    // C4, I2, R2, H2: the rest of the goal, with kindness where it ended.
    const left = target - kTE[needK] - othersNow;
    if (left > L) continue;
    let ok = true;
    let total = kTE[needK];
    for (const e of OTHERS_IDX) {
      const need = left > 0 ? per[e * (L + 1) + left] : 0;
      if (!otherFor(e, need)) {
        ok = false;
        break;
      }
      const at = e * (L + 1) + need;
      if (need > 0 && oWait[at] > 0) t += oWait[at];
      total += oTE[at];
    }
    if (!ok || total < target) continue;
    const i = target - from;
    seconds[i] = t;
    endTE[i] = total;
    for (const e of OTHERS_IDX) ends[i * 5 + e] = oEggs[e * (L + 1) + (left > 0 ? per[e * (L + 1) + left] : 0)];
    ends[i * 5 + KIND] = kEggs[needK];
  }
  // A target it can't reach reads as the counts asked of nothing.
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(seconds[i])) continue;
    for (const e of OTHERS_IDX) ends[i * 5 + e] = oEggs[e * (L + 1)];
    ends[i * 5 + KIND] = kEggs[0];
  }
  return {
    from,
    to,
    seconds,
    endTE,
    deliveredInto: deliveredFrom(ends),
    bytes: SWEEP_OVERHEAD + seconds.byteLength + endTE.byteLength + ends.byteLength,
  };
}

/** `deliveredInto` in a scope of its own, so it keeps `ends` and nothing else. */
function deliveredFrom(ends: Float64Array): TailSweep['deliveredInto'] {
  return (i, out) => {
    for (let e = 0; e < 5; e++) out[e] = ends[i * 5 + e];
  };
}

const offsetByDay = new Map<number, number | null>();
const offsetAtDayStart = new Map<number, number>();
const offsetByHour = new Map<number, number>();
function dayStartOffset(day: number): number {
  let o = offsetAtDayStart.get(day);
  if (o === undefined) {
    o = getTimezoneOffsetAt(PACIFIC_TIMEZONE, day * 86400);
    offsetAtDayStart.set(day, o);
  }
  return o;
}
/** Pacific's offset from UTC, asked of the (slow) date formatter once per day, and per hour only on
 *  the two days a year it changes. */
function pacificOffset(unixSeconds: number): number {
  const day = Math.floor(unixSeconds / 86400);
  let whole = offsetByDay.get(day);
  if (whole === undefined) {
    const a = dayStartOffset(day);
    const b = dayStartOffset(day + 1);
    whole = a === b ? a : null;
    offsetByDay.set(day, whole);
  }
  if (whole !== null) return whole;
  const h = Math.floor(unixSeconds / 3600);
  let offset = offsetByHour.get(h);
  if (offset === undefined) {
    offset = getTimezoneOffsetAt(PACIFIC_TIMEZONE, h * 3600);
    offsetByHour.set(h, offset);
  }
  return offset;
}

/** The Pacific hour of the week an instant falls in, 0 = Monday 00:00 Pacific. */
export function pacificHourOfWeek(unixSeconds: number): number {
  const local = unixSeconds + pacificOffset(unixSeconds);
  // 1970-01-01 was a Thursday: shift so the week starts on Monday.
  const hours = Math.floor(local / 3600) + 3 * 24;
  return ((hours % WEEK_HOURS) + WEEK_HOURS) % WEEK_HOURS;
}
