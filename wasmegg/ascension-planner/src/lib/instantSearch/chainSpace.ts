/**
 * Chain explorer: every chain with the explored route's number of ascensions that ends within a
 * slack of it, priced the way the finder prices a route, for the player to filter down (by time, TE
 * between prestiges, days a prestige should fall near) until a few are left.
 *
 * HOW. A depth-first walk over the stops, each ascension from the arrival the last one left
 * (`legsFrom`, so held prestiges and the sale's late starts are as the finder has them), dropping a
 * partial chain as soon as even the fastest finish from where it stands would be too late. That
 * fastest finish (`chainBounds`) comes from `LegHours`: for each start TE, hour of the week and stop,
 * the quickest any build in the table gets there.
 *
 * WAITS. Prestiges never wait by choice here: finding a chain's waits (`holdRoute`) takes milliseconds,
 * too slow for tens of thousands of chains. They are found for the few the filters leave
 * (routeFinder.ts `chainPricer`).
 */
import { canonicalDelivered, pacificHourOfWeek, sweepTails } from './precomputedLeg';
import {
  firstLegOptions,
  legsFrom,
  priceLeg,
  settleArrival,
  SweepCache,
  type Arrival,
  type BuildLookup,
  type FindOptions,
  type Route,
} from './routeFinder';

/**
 * The quickest one ascension from each start TE, at each Pacific hour of the week, to each stop above
 * it: the fastest build in the table's cell from the TE's canonical counts, in whole hours rounded
 * down (`Uint16`, so the whole table's fits in about 23 MB). Row `(te, hour)` starts at
 * `(offsets[te - from] + hour * (top - te))`, stop `te + 1 + k` at `k`. Filled one TE at a time
 * (`fillLegHours`), since the whole table's sweeps take seconds.
 */
export interface LegHours {
  from: number;
  to: number;
  top: number;
  offsets: Int32Array;
  hours: Uint16Array;
  /** TEs filled so far, from `to` down. */
  filledDownTo: number;
}

const WEEK = 168;
const NEVER = 0xffff;

export function createLegHours(from: number, to: number, top: number): LegHours {
  const offsets = new Int32Array(to - from + 1);
  let size = 0;
  for (let te = from; te <= to; te++) {
    offsets[te - from] = size;
    size += WEEK * Math.max(0, top - te);
  }
  return { from, to, top, offsets, hours: new Uint16Array(size).fill(NEVER), filledDownTo: to + 1 };
}

/** Fill the next TE down (`legHours.filledDownTo - 1`). False when all are done. */
export function fillLegHours(lh: LegHours, table: BuildLookup): boolean {
  const te = lh.filledDownTo - 1;
  if (te < lh.from) return false;
  const width = lh.top - te;
  const base = lh.offsets[te - lh.from];
  for (let hour = 0; hour < WEEK; hour++) {
    const row = base + hour * width;
    for (const b of table(te, hour) ?? []) {
      const sw = sweepTails(b, lh.top, 0, te + 1);
      for (let i = 0; i < sw.seconds.length; i++) {
        const k = sw.from + i - te - 1;
        if (k < 0 || k >= width || !(sw.seconds[i] >= 0)) continue;
        const h = Math.min(NEVER - 1, Math.floor(sw.seconds[i] / 3600));
        if (h < lh.hours[row + k]) lh.hours[row + k] = h;
      }
    }
  }
  lh.filledDownTo = te;
  return true;
}

/**
 * Seconds per ascension left that the bound gives away. A finish from above the canonical counts (an
 * arrival's eggs past its last threshold) can beat the canonical one, and the hours are rounded: on
 * every 3-ascension chain within 6 days of 226 → 490, the bound came within 1.4 hours of the real
 * finish half the time and was above it by an hour at most.
 */
const MARGIN = 3600;

/**
 * `bound(r, te, at)`: at least how long, seconds, from arriving at `te` at unix second `at` to reaching
 * `final` in `r` more ascensions, each to a higher stop (Infinity when it cannot be done).
 *
 * Worked backwards over (TE, hour of the week) from `final`, every prestige allowed to wait for a later
 * hour. Waiting is a choice no chain here makes, so this is only looser for it, and it makes arriving
 * sooner never worse: the fastest build to each stop is all `LegHours` has to keep.
 */
export function chainBounds(
  lh: LegHours,
  lowest: number,
  final: number,
  legs: number,
  margin = MARGIN
): (r: number, te: number, at: number) => number {
  const lo = Math.max(lowest, lh.from);
  const span = final - lo;
  // waitable[r][(te - lo) * WEEK + hour]: hours, from a prestige at `hour` that may wait.
  const waitable: Float64Array[] = [];
  for (let r = 1; r < legs; r++) {
    const prev = waitable[r - 2];
    const cur = new Float64Array(span * WEEK).fill(Infinity);
    for (let te = final - 1; te >= lo; te--) {
      if (te > lh.to) continue;
      const width = lh.top - te;
      const base = lh.offsets[te - lh.from];
      for (let hour = 0; hour < WEEK; hour++) {
        const row = base + hour * width;
        let best = Infinity;
        if (r === 1) {
          const h = lh.hours[row + final - te - 1];
          if (h !== NEVER) best = h;
        } else {
          for (let s = te + 1; s < final; s++) {
            const h = lh.hours[row + s - te - 1];
            if (h === NEVER || h >= best) continue;
            const rest = prev[(s - lo) * WEEK + ((hour + h) % WEEK)];
            if (h + rest < best) best = h + rest;
          }
        }
        cur[(te - lo) * WEEK + hour] = best;
      }
      // Waiting an hour is always allowed: twice round the week settles it.
      const row = (te - lo) * WEEK;
      for (let pass = 0; pass < 2; pass++)
        for (let hour = WEEK - 1; hour >= 0; hour--) {
          const next = cur[row + ((hour + 1) % WEEK)] + 1;
          if (next < cur[row + hour]) cur[row + hour] = next;
        }
    }
    waitable.push(cur);
  }
  return (r, te, at) => {
    if (r === 0) return te >= final ? 0 : Infinity;
    if (te >= final) return Infinity;
    if (te < lo) return 0;
    // From the hour the arrival falls in: a prestige then (inside the sale) or later.
    const cell = Math.floor(at / 3600) * 3600;
    const hours = waitable[r - 1][(te - lo) * WEEK + pacificHourOfWeek(cell)];
    return hours === Infinity ? Infinity : Math.max(0, cell - at + hours * 3600 - margin * r);
  };
}

/** The chains found, soonest end first. */
export interface ChainSpace {
  /** Ascensions per chain (legs), and the stop they all end at. */
  legs: number;
  final: number;
  count: number;
  /** `count * legs`: each chain's stops. */
  stops: Int16Array;
  /** `count * legs`: when each ascension's prestige starts (NaN for continuing the one in progress). */
  prestiges: Float64Array;
  /** Unix second each chain reaches its last stop. */
  ends: Float64Array;
  /** Everything ending by this was looked for. */
  limit: number;
  /** Stopped at `cap` chains or `budgetMs`: there are more. */
  capped: boolean;
  /** The TE between prestiges and the windows searched (`SpaceFilter`'s, applied while searching). */
  minGap: number;
  maxGap: number;
  windows: [number, number][];
  /** Partial chains walked. */
  walked: number;
}

/** Most chains kept, and the longest a search may take: past these the filters have to narrow the
 *  question first. */
export const SPACE_CAP = 300_000;
export const SPACE_BUDGET_MS = 20_000;

/**
 * Every chain of `route`'s number of ascensions, with its first step (continue or prestige), to its
 * last stop, ending by `limit` without waits: under `o`'s filters (avoided times hold prestiges, as in
 * the search), with `minGap` to `maxGap` TE between prestiges (`chainGaps`) and a prestige in each of
 * `windows` (at most 30): these cut the search down as it goes, a window as soon as the chain is past it. Longer plans have far too many chains otherwise: 8 ascensions from 226 to 490 have
 * more than SPACE_CAP within 2 days.
 */
export function enumerateChains(
  table: BuildLookup,
  legHours: LegHours,
  o: FindOptions,
  route: Route,
  limit: number,
  {
    minGap = 1,
    maxGap = Infinity,
    windows = [],
    cap = SPACE_CAP,
    budgetMs = SPACE_BUDGET_MS,
    margin = MARGIN,
    onProgress,
  }: {
    minGap?: number;
    maxGap?: number;
    windows?: [number, number][];
    cap?: number;
    budgetMs?: number;
    margin?: number;
    onProgress?: (found: number) => void;
  } = {}
): ChainSpace {
  const n = route.legs.length;
  const final = route.chain[n - 1];
  const firstContinued = route.legs[0]?.continued === true;
  const bound = chainBounds(legHours, o.startTE, final, n, margin);
  const cache = new SweepCache(64 * 1024 * 1024);
  const stops: number[] = [];
  const prestiges: number[] = [];
  const ends: number[] = [];
  const at = new Array<number>(n).fill(0);
  const when = new Array<number>(n).fill(NaN);
  let walked = 0;
  let capped = false;
  const stopAt = performance.now() + budgetMs;
  const all = (1 << windows.length) - 1;
  /** `mask` with the windows a prestige at `t` falls in. */
  const hit = (mask: number, t: number) => {
    for (let w = 0; w < windows.length; w++) if (t >= windows[w][0] && t < windows[w][1]) mask |= 1 << w;
    return mask;
  };
  /** A window not yet hit that ends before the next prestige can start can no longer be. */
  const missed = (mask: number, next: number) => {
    for (let w = 0; w < windows.length; w++) if (!(mask & (1 << w)) && windows[w][1] <= next) return true;
    return false;
  };
  /** The stops the gaps allow after `prev`, the last stop always. */
  const allowed = (prev: number, stop: number) => stop === final || (stop - prev >= minGap && stop - prev <= maxGap);

  const record = (end: number) => {
    if (ends.length >= cap) {
      capped = true;
      return;
    }
    stops.push(...at);
    prestiges.push(...when);
    ends.push(end);
    if (ends.length % 5000 === 0) onProgress?.(ends.length);
  };
  /** Too late already: even the fastest finish from here misses `limit`. */
  const hopeless = (i: number, te: number, time: number) => time + bound(n - 1 - i, te, time) > limit;

  const walk = (i: number, item: Arrival, mask: number) => {
    if (capped) return;
    if (++walked % 256 === 0 && performance.now() > stopAt) {
      capped = true;
      return;
    }
    const last = i === n - 1;
    if (last) {
      // Only the target is wanted: priced straight there, as the finder prices a chain.
      const pr = priceLeg(table, item.te, item.time, item.delivered, final, o.avoid, item.farm);
      if (!pr || pr.end > limit || hit(mask, pr.start) !== all) return;
      at[i] = final;
      when[i] = pr.start;
      record(pr.end);
      return;
    }
    // No stop past what the gaps allow is offered, nor swept for.
    const highest = Math.min(final - 1, (i ? at[i - 1] : o.startTE) + maxGap);
    legsFrom(
      table,
      final,
      false,
      item,
      cache,
      o.avoid,
      ({ leg, farm, settled }) => {
        // The target is the last stop only (priced above).
        if (capped || leg.to === final || !allowed(i ? at[i - 1] : o.startTE, leg.to)) return;
        at[i] = leg.to;
        when[i] = leg.start;
        if (hopeless(i, settled.te, settled.time)) return;
        const m = hit(mask, leg.start);
        if (missed(m, settled.time)) return;
        walk(
          i + 1,
          {
            id: 0,
            te: settled.te,
            time: settled.time,
            delivered: settled.delivered,
            stop: leg.to,
            farm,
            ...(settled.heldNext ? { held: true } : {}),
          },
          m
        );
      },
      highest
    );
  };

  if (o.cont) {
    // The ascension in progress: continued to its stop, or ended now and a fresh build (as the route).
    for (const f of firstLegOptions(table, { ...o, cont: o.cont })) {
      if (capped) break;
      if (f.continued !== firstContinued || (n === 1) !== (f.to === final) || f.to > final) continue;
      if (!allowed(o.startTE, f.to)) continue;
      at[0] = f.to;
      when[0] = f.continued ? NaN : f.start;
      const m = f.continued ? 0 : hit(0, f.start);
      if (n === 1) {
        if (f.end <= limit && m === all) record(f.end);
        continue;
      }
      const settled = settleArrival(f.endTE, f.end, f.delivered, f.farm, final, o.avoid);
      if (!settled || hopeless(0, settled.te, settled.time) || missed(m, settled.time)) continue;
      walk(
        1,
        {
          id: 0,
          te: settled.te,
          time: settled.time,
          delivered: settled.delivered,
          stop: f.to,
          farm: f.farm,
          ...(settled.heldNext ? { held: true } : {}),
        },
        m
      );
    }
  } else {
    walk(0, { id: 0, te: o.startTE, time: o.start, delivered: o.startDelivered ?? canonicalDelivered(o.startTE) }, 0);
  }

  // Soonest first.
  const order = ends.map((_, i) => i).sort((a, b) => ends[a] - ends[b]);
  const out: ChainSpace = {
    legs: n,
    final,
    count: order.length,
    stops: new Int16Array(order.length * n),
    prestiges: new Float64Array(order.length * n),
    ends: new Float64Array(order.length),
    limit,
    capped,
    minGap,
    maxGap,
    windows,
    walked,
  };
  order.forEach((from, to) => {
    for (let k = 0; k < n; k++) {
      out.stops[to * n + k] = stops[from * n + k];
      out.prestiges[to * n + k] = prestiges[from * n + k];
    }
    out.ends[to] = ends[from];
  });
  return out;
}

export interface SpaceFilter {
  /** The latest a chain may end, unix second (your plan's end plus the days slower allowed). */
  limit: number;
  /** TE between consecutive stops, the start TE to the first included and the final ascension left
   *  out (its jump to the target is always the biggest). */
  minGap: number;
  maxGap: number;
  /** Unix-second spans [start, end): each needs at least one prestige inside it. */
  windows: [number, number][];
}

/** The TE gaps `SpaceFilter` reads from a chain's stops: from `startTE`, the last stop left out. */
export function chainGaps(stops: ArrayLike<number>, startTE: number): number[] {
  const gaps: number[] = [];
  for (let k = 0; k + 1 < stops.length; k++) gaps.push(stops[k] - (k ? stops[k - 1] : startTE));
  return gaps;
}

/** The chains `f` lets through, as indexes into `space`, soonest first. */
export function filterSpace(space: ChainSpace, startTE: number, f: SpaceFilter): number[] {
  const n = space.legs;
  const out: number[] = [];
  for (let c = 0; c < space.count; c++) {
    // Sorted: everything after is later still.
    if (space.ends[c] > f.limit) break;
    let ok = true;
    for (let k = 0; k + 1 < n && ok; k++) {
      const gap = space.stops[c * n + k] - (k ? space.stops[c * n + k - 1] : startTE);
      if (gap < f.minGap || gap > f.maxGap) ok = false;
    }
    for (const [a, b] of f.windows) {
      if (!ok) break;
      let hit = false;
      for (let k = 0; k < n && !hit; k++) {
        const t = space.prestiges[c * n + k];
        hit = t >= a && t < b;
      }
      ok = hit;
    }
    if (ok) out.push(c);
  }
  return out;
}
