/**
 * Chain comparison: what a similar plan (routeFinder.ts `similarRoutes`) does differently from the
 * plan explored, and where that wins or loses time. Plans of the same number of ascensions line up
 * ascension for ascension, so each one's share of the difference can be read off on its own.
 */
import type { Route, RouteLeg } from './routeFinder';

/** One ascension of both plans side by side. */
export interface LegComparison {
  /** The ascension's number as the player counts it (`offset` added). */
  n: number;
  base: RouteLeg;
  alt: RouteLeg;
  /** Seconds from the previous stop's reaching (or the plan start) to this stop's: the prestige's
   *  wait for the hour, any wait for eggs and the ascension itself. These add up to the plan's time. */
  baseSeconds: number;
  altSeconds: number;
  /** alt − base: positive is slower. */
  delta: number;
  /** What differs about it, in words. */
  notes: string[];
}

/**
 * Ascensions between two stops both plans share (or the start, or the end): moving a stop only moves
 * time from one ascension into the next, so a change's cost is read over the whole stretch it touches.
 */
export interface Stretch {
  /** TE the stretch starts and ends at (the start TE for the first). */
  from: number;
  to: number;
  legs: LegComparison[];
  /** alt − base over the stretch: positive is slower. */
  delta: number;
}

export interface PlanComparison {
  route: Route;
  /** alt's end − base's end: positive is slower. */
  delta: number;
  /** The strategic differences, in words. */
  changes: string[];
  legs: LegComparison[];
  stretches: Stretch[];
  /** Stop indexes (into `route.chain`) that differ from the base's. */
  changedStops: Set<number>;
}

/** Seconds each leg takes up: from the previous stop's reaching (or `start`) to its own. */
function spans(r: Route, start: number): number[] {
  return r.legs.map((l, i) => l.end - (i ? r.legs[i - 1].end : start));
}

const ord = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const hours = (seconds: number) => {
  const h = Math.round(seconds / 3600);
  return `${h} hour${h === 1 ? '' : 's'}`;
};
const build = (l: RouteLeg) => `${l.sales}-sale${l.tier13 ? ' + T13' : ''}`;
const signed = (d: number) => `${d > 0 ? '+' : '−'}${Math.abs(d)}`;

/** The stops changed, in words: one moved, one dropped for another, all shifted, or each listed. */
function stopChanges(base: number[], alt: number[], at: (i: number) => number): string[] {
  const removed = base.filter(s => !alt.includes(s));
  const added = alt.filter(s => !base.includes(s));
  if (!removed.length && !added.length) return [];
  if (removed.length === 1 && added.length === 1) {
    const [r] = removed;
    const [a] = added;
    if (Math.abs(a - r) <= 8 && base.indexOf(r) === alt.indexOf(a))
      return [`Ascends at ${a} instead of ${r} TE (${signed(a - r)}) on the ${ord(at(alt.indexOf(a)))} ascension`];
    return [`Drops the stop at ${r} TE and adds one at ${a} TE`];
  }
  const moved = base.map((s, i) => alt[i] - s).filter((d, i) => i < base.length - 1);
  const shifts = moved.filter(d => d !== 0);
  if (shifts.length > 1 && shifts.length === moved.length && shifts.every(d => d === shifts[0]))
    return [`Every stop before the last moved ${signed(shifts[0])} TE`];
  if (base.length === alt.length)
    return base.flatMap((s, i) =>
      alt[i] === s ? [] : [`Ascends at ${alt[i]} instead of ${s} TE on the ${ord(at(i))} ascension`]
    );
  return [`Stops at ${alt.join(', ')} instead of ${base.join(', ')}`];
}

/**
 * How `alt` differs from `base` (the same number of ascensions), with each ascension's share of the
 * time. `offset`: ascensions before the first leg (1 when prestiging now ends the one in progress).
 * `show` writes a moment as the answer does.
 */
export function comparePlans(
  base: Route,
  alt: Route,
  start: number,
  offset: number,
  show: (unix: number) => string
): PlanComparison {
  const at = (i: number) => i + 1 + offset;
  const bs = spans(base, start);
  const as = spans(alt, start);
  const changes = stopChanges(base.chain, alt.chain, at);
  const legs: LegComparison[] = [];
  const builds: string[] = [];
  const waits: string[] = [];
  const waited: [number, number][] = [];
  for (let i = 0; i < Math.min(base.legs.length, alt.legs.length); i++) {
    const b = base.legs[i];
    const a = alt.legs[i];
    const notes: string[] = [];
    if (a.from !== b.from) notes.push(`starts at ${a.from} TE instead of ${b.from}`);
    if (a.to !== b.to) notes.push(`ascends at ${a.to} instead of ${b.to}`);
    if (Math.abs(a.start - b.start) >= 3600) notes.push(`builds from ${show(a.start)} instead of ${show(b.start)}`);
    if (a.sales !== b.sales || a.tier13 !== b.tier13) {
      notes.push(`${build(a)} build instead of ${build(b)}`);
      if (a.sales !== b.sales)
        builds.push(
          `The ${ord(at(i))} ascension's build catches ${a.sales} research sale${a.sales === 1 ? '' : 's'} instead of ${b.sales}`
        );
      if (a.tier13 !== b.tier13) builds.push(`The ${ord(at(i))} ascension ${a.tier13 ? 'adds' : 'skips'} T13`);
    }
    const aw = a.waited ?? 0;
    const bw = b.waited ?? 0;
    if (Math.round(aw / 3600) !== Math.round(bw / 3600)) {
      waited.push([aw, bw]);
      const was = bw ? hours(bw) : 'none';
      notes.push(aw ? `waits ${hours(aw)} for eggs first (was ${was})` : `prestiges without waiting (was ${was})`);
      waits.push(
        aw
          ? `Waits ${hours(aw)} for eggs before the ${ord(at(i))} ascension instead of ${bw ? hours(bw) : 'not waiting'}`
          : `Prestiges straight into the ${ord(at(i))} ascension instead of waiting ${hours(bw)}`
      );
    }
    if (a.held !== b.held)
      notes.push(a.held ? 'its prestige waits out a blocked time' : 'no longer held by a blocked time');
    legs.push({ n: at(i), base: b, alt: a, baseSeconds: bs[i], altSeconds: as[i], delta: as[i] - bs[i], notes });
  }
  const changedStops = new Set(alt.chain.flatMap((s, i) => (base.chain[i] === s ? [] : [i])));
  // More than two waits changed: say so once, with the hours in all.
  if (waits.length > 2) {
    const sum = (k: 0 | 1) => waited.reduce((n, w) => n + w[k], 0);
    waits.splice(
      0,
      waits.length,
      `Waits for eggs differently before ${waits.length} prestiges (${hours(sum(0))} in all instead of ${hours(sum(1))})`
    );
  }
  const stretches: Stretch[] = [];
  let from = startTE(base);
  let run: LegComparison[] = [];
  for (const [i, l] of legs.entries()) {
    run.push(l);
    if (base.chain[i] !== alt.chain[i] && i < legs.length - 1) continue;
    stretches.push({ from, to: base.chain[i], legs: run, delta: run.reduce((n, x) => n + x.delta, 0) });
    from = base.chain[i];
    run = [];
  }
  return {
    route: alt,
    delta: alt.end - base.end,
    changes: [...changes, ...waits, ...builds],
    legs,
    stretches,
    changedStops,
  };
}

/** The TE a route's first leg starts from. */
const startTE = (r: Route) => r.legs[0]?.from ?? 0;

/** Days to two decimals, signed, for a difference. */
export function deltaDays(seconds: number): string {
  const d = seconds / 86400;
  if (Math.abs(d) < 0.005) return '±0.00 d';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)} d`;
}

/** Under this much, a stretch counts as no different (half an hour). */
const SAME = 1800;

/**
 * Where the difference comes from, in words: the stretches between shared stops that gain or lose the
 * most, largest first, at most `most`; inside one, how its ascensions trade time.
 */
export function speedStory(c: PlanComparison, most = 2): string {
  const big = c.stretches.filter(s => Math.abs(s.delta) >= SAME).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  if (!big.length)
    return Math.abs(c.delta) < SAME
      ? 'Within half an hour of your plan at every stop the two share.'
      : 'The difference is spread thinly over every ascension.';
  const told = big.slice(0, most).map(s => {
    const how = `${Math.abs(s.delta / 86400).toFixed(2)} d ${s.delta > 0 ? 'slower' : 'faster'}`;
    const [first] = s.legs;
    const last = s.legs[s.legs.length - 1];
    if (s.legs.length === 1) return `the ${ord(first.n)} ascension (${s.from} → ${s.to} TE) is ${how}`;
    const trade = s.legs
      .filter(l => Math.abs(l.delta) >= SAME)
      .map(l => `${ord(l.n)} ${deltaDays(l.delta)}`)
      .join(', ');
    return `from ${s.from} to ${s.to} TE (ascensions ${first.n}–${last.n}) it is ${how}${trade ? ` (${trade})` : ''}`;
  });
  const rest =
    big.length > most ? `, and ${big.length - most} more stretch${big.length - most === 1 ? '' : 'es'} differ` : '';
  const text = told.join('; ') + rest;
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}
