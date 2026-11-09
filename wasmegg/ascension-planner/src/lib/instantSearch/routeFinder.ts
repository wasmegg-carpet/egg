/**
 * The fastest route to a target TE, or the highest TE by a date, from a precomputed table: every
 * stop at every TE, any number of ascensions, in a second or two. Ported from AutoAutoAP
 * (github.com/william-egginc/AutoAutoAP, branch ascension-chain-search, src/search/routeFinder.ts)
 * without its "works inside my hours" filter, the player's own first ascension (continue / build-up)
 * or the background wide polish: here every ascension, the first included, is a fresh build from
 * the table.
 *
 * HOW. The state between ascensions is (TE, time, egg counts). An ascension that starts later never
 * ends sooner, and more eggs never make one slower, so an arrival that is no later with at least the
 * counts of another beats it outright. The search is one pass per number of ascensions, keeping at
 * each TE the arrivals nothing beats: the fastest route of every length comes out of the same pass.
 *
 * ON THE HOUR. Each ascension starts at the next whole hour, where the table was simulated, so its
 * time is the simulator's. Inside the weekly Research Sale a start is also priced from its own hour's
 * cell moved by the seconds it is late (`startInSale`), which is exact there, so a route does not
 * wait a week for want of an hour.
 */
import { getNextSaleEnd, isResearchSaleActive } from 'lib/planners/events';
import { countTEThresholdsPassed, TE_BREAKPOINTS } from '@/lib/truthEggs';
import {
  bestTailTo,
  canonicalDelivered,
  exactTE,
  lastWaitEgg,
  pacificHourOfWeek,
  rebase,
  sweepTails,
  type BuildParams,
  type TailSweep,
} from './precomputedLeg';

/** The table as the finder reads it: the builds for a start TE at a Pacific hour of the week.
 *  `shift`: the Clothed TE its rows sit below the TEs asked for (table.ts `shiftedLookup`). */
export type BuildLookup = ((te: number, hour: number) => BuildParams[] | null) & { shift?: number };

export interface RouteLeg {
  /** TE the ascension starts at, and the stop it ascends at. */
  from: number;
  to: number;
  /** TE it actually ends at (above `to` when the build's sale wait overshoots). */
  endTE: number;
  /** Unix seconds. */
  start: number;
  end: number;
  sales: number;
  tier13: boolean;
  /** The delivery rate its waits run at (the build's peak, or the farm in progress's when it
   *  continues), eggs per second. */
  rate: number;
  /** TE with fractions (`exactTE`) when it starts and when its stop is reached. */
  exactFrom: number;
  exactEnd: number;
  /** The first leg only: continuing the ascension in progress instead of prestiging. */
  continued?: boolean;
  /** Its prestige waited for a blocked date or hour to pass (`FindOptions.avoid`); the eggs laid
   *  meanwhile are counted in its start (`holdArrival`). */
  held?: boolean;
  /** Its prestige waited by choice (`FindOptions.waitForEggs`): seconds from the next whole hour after
   *  the last stop to the prestige, the farm laying on meanwhile. */
  waited?: number;
  /** With `waited`: unix second the TE it starts from (`from`) was reached, the last stop or, when the
   *  wait's eggs passed thresholds, the last of them. The wait to tell the player runs from here. */
  waitFrom?: number;
}

export interface Route {
  /** Stops, ending at the target (or, by a date, the highest TE reached). */
  chain: number[];
  legs: RouteLeg[];
  /** Unix second the last stop is reached. */
  end: number;
  seconds: number;
}

export interface FindOptions {
  /** The TE the plan starts from and the unix second it starts. */
  startTE: number;
  start: number;
  /** Eggs delivered per egg at the start (EGG_ORDER); the table's canonical share of `startTE` if
   *  left out. */
  startDelivered?: number[];
  /** The ascension in progress, as a build (lib/instantSearch/currentAscension.ts): then the first
   *  leg to each stop is whichever ends sooner of continuing it (from `start`) and prestiging
   *  (`firstLegOptions`). Without it, the first leg is always a prestige. */
  cont?: BuildParams | null;
  /** The egg the farm in progress is on (EGG_ORDER index): a first prestige that waits credits its
   *  laying there. */
  contEgg?: number;
  /** The target TE (490 for By a date). */
  final: number;
  /** Most ascensions to consider. */
  maxAscensions: number;
  /** Also find the highest TE reachable by this unix second. */
  deadline?: number;
  /** Times no prestige may start in (dates to avoid, blocked hours), sorted and merged
   *  (`mergeBlocked`). A prestige that would start in one waits for the first whole hour after it, as
   *  AutoAutoAP's "works inside my hours" holds a prestige, and the farm lays on meanwhile
   *  (`holdArrival`). Continuing needs no prestige, so it is never held; nor is reaching the last stop. */
  avoid?: Blocked;
  /** Let prestiges wait whole hours when the eggs the farm lays meanwhile (or a better start hour)
   *  make the route end sooner (`waitForEggs` in `polishFound`). */
  waitForEggs?: boolean;
  /** Clothed TE the player's earnings artifacts are below the table's (lib/instantSearch/earningsShift.ts).
   *  The finder doesn't read it: the worker hands it a lookup shifted by it (table.ts `shiftedLookup`). */
  earningsShift?: number;
  /** Told after each number of ascensions is done, for a progress line. */
  onProgress?: (done: number, of: number) => void;
}

/** [start, end) unix-second spans, sorted, none touching another. */
export type Blocked = [number, number][];

/** Spans sorted and joined where they touch or overlap. */
export function mergeBlocked(spans: Blocked): Blocked {
  const out: Blocked = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The first moment at or after `t` outside every blocked span (by halving: blocked hours over a
 *  plan's years are a few thousand spans). Spans never touch, so one step out is enough. */
export function nextAllowed(t: number, blocked: Blocked | undefined): number {
  if (!blocked?.length) return t;
  let lo = 0;
  let hi = blocked.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocked[mid][0] <= t) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return at >= 0 && t < blocked[at][1] ? blocked[at][1] : t;
}

/** The farm a stop is reached on: the egg it lays (EGG_ORDER index) and its rate, eggs per second. */
export interface Farm {
  egg: number;
  rate: number;
}

/** The farm a tail leaves laying: the last egg its waits raised (`lastWaitEgg`), at the build's rate. */
function farmAfter(b: BuildParams, end: ArrayLike<number>): Farm {
  return { egg: lastWaitEgg(b.delivered, Array.from(end)), rate: b.peakELR };
}

const teOf = (delivered: number[]) => delivered.reduce((n, d) => n + countTEThresholdsPassed(d), 0);

/**
 * An arrival at a stop reached at `reached`, as the next prestige finds it: on the next whole hour,
 * or, when it must wait for a blocked span, the first whole hour after it (`held`). From the stop's
 * reaching to the prestige the farm lays on at its rate on the egg it is on, and those eggs carry
 * into the next ascension (`rebase`), with any TE they make. (AutoAutoAP leaves out the wait for the
 * next whole hour; this credits it.) No silo cap: the player is assumed to keep the farm running.
 *
 * `extra`: seconds the prestige also waits by choice past the next whole hour (then past any blocked
 * span it lands in), credited the same way; then `held` too.
 */
export function holdArrival(
  reached: number,
  delivered: number[],
  farm: Farm | null,
  avoid: Blocked | undefined,
  extra = 0
): { held: boolean; at: number; delivered: number[]; te: number } {
  const at = prestigeAt(extra > 0 ? nextHour(reached) + extra : reached, avoid);
  const eggs = laidOn(delivered, farm, at - reached);
  return { held: at > nextHour(reached), at, delivered: eggs, te: teOf(eggs) };
}

/** `delivered` after the farm lays on `seconds` more (unchanged without a farm). */
function laidOn(delivered: number[], farm: Farm | null | undefined, seconds: number): number[] {
  if (!farm || !(farm.rate > 0) || !(seconds > 0)) return delivered;
  const eggs = [...delivered];
  eggs[farm.egg] += farm.rate * seconds;
  return eggs;
}

/** When a prestige ready at `t` starts: the next whole hour, or the first whole hour after the
 *  blocked span it falls in. */
function prestigeAt(t: number, blocked: Blocked | undefined): number {
  let at = nextHour(t);
  // Rounding up to the hour can land in a span that starts within the hour: go again until it doesn't.
  for (;;) {
    const next = nextHour(nextAllowed(at, blocked));
    if (next === at) return at;
    at = next;
  }
}

export interface FoundRoutes {
  /** The fastest to `final` overall, and for each number of ascensions (index = ascensions). */
  best: Route | null;
  byAscensions: (Route | null)[];
  /** With `deadline`: the route to the highest TE in time, overall and for each count. */
  byDate: Route | null;
  byDateByAscensions: (Route | null)[];
  /** Routes the search weighed: every arrival offered after each ascension, kept or beaten. */
  checked: number;
}

/** The next whole hour at or after `t`. Pacific hours begin on UTC hour boundaries. */
export function nextHour(t: number): number {
  return Math.ceil(t / 3600) * 3600;
}

/** Purchases must end this long before the sale does to count as inside it. */
const SALE_MARGIN = 60;

/**
 * Inside the Research Sale, a start priced from its own hour's cell, moved the seconds it is late,
 * for each build whose purchases still finish before this sale ends. Exact: such a build lies wholly
 * inside one sale window, where nothing depends on the clock but the sale's end.
 */
function startInSale(table: BuildLookup, te: number, t: number): { lateBy: number; builds: BuildParams[] } | null {
  const cell = Math.floor(t / 3600) * 3600;
  const lateBy = t - cell;
  if (!(lateBy > 0) || !isResearchSaleActive(cell) || !isResearchSaleActive(t)) return null;
  const left = getNextSaleEnd(t) - t;
  // A sale lasts a day; anything longer means the end found was the next week's.
  if (!(left > 0 && left <= 86400)) return null;
  const builds = (table(te, pacificHourOfWeek(cell)) ?? []).filter(b => b.waitStart <= left - SALE_MARGIN);
  return builds.length ? { lateBy, builds } : null;
}

/** One ascension from `te` at `t` to `target`: from the next whole hour's cell, `farm` laying on
 *  until then, or from this hour's inside the sale, at once; whichever ends sooner. `from` and
 *  `startDelivered`: the TE and counts the chosen build starts from. */
export function priceLeg(
  table: BuildLookup,
  te: number,
  t: number,
  delivered: number[],
  target: number,
  avoid?: Blocked,
  farm?: Farm | null
): {
  start: number;
  end: number;
  endTE: number;
  delivered: number[];
  build: BuildParams;
  from: number;
  startDelivered: number[];
} | null {
  const options: { start: number; lateBy: number; builds: BuildParams[]; te: number; eggs: number[] }[] = [];
  const at = prestigeAt(t, avoid);
  const onEggs = laidOn(delivered, farm, at - t);
  const onTE = Math.max(te, teOf(onEggs));
  const raw = table(onTE, pacificHourOfWeek(at));
  if (raw?.length) options.push({ start: at, lateBy: 0, builds: raw, te: onTE, eggs: onEggs });
  const late = at !== t && nextAllowed(t, avoid) === t ? startInSale(table, te, t) : null;
  if (late) options.push({ start: t, ...late, te, eggs: delivered });
  let best: ReturnType<typeof priceLeg> = null;
  for (const o of options) {
    if (target <= o.te) continue;
    const tail = bestTailTo(
      o.builds.map(b => rebase(b, o.te, o.eggs)),
      target,
      o.lateBy
    );
    if (tail && (!best || o.start + tail.seconds < best.end))
      best = {
        start: o.start,
        end: o.start + tail.seconds,
        endTE: tail.endTE,
        delivered: tail.delivered,
        build: tail.build,
        from: o.te,
        startDelivered: o.eggs,
      };
  }
  return best;
}

interface Label {
  id: number;
  /** When the next prestige can start: the stop's reaching, or after a hold the prestige moment. */
  time: number;
  /** Eggs delivered per egg then: the next build is moved onto these (`rebase`). */
  delivered: number[];
  prev: Label | null;
  leg: RouteLeg | null;
  /** The next prestige waited for a blocked span (`holdArrival`): its leg is marked held. */
  heldNext?: boolean;
  /** The farm the stop was reached on, laying until the next prestige (`holdArrival`). */
  farm?: Farm;
}

/**
 * Where a stop reached at `end` leaves the route for its next ascension (`holdArrival`): as reached,
 * or, when the next prestige must wait, at the prestige moment with the farm's extra eggs (and the
 * TE they make, which can be more). Null when the wait itself reaches the target: the direct leg to
 * it covers that. With a wait that adds TE, `terminal` is the stop as reached, for By a date to end
 * on (the held arrival is filed at the higher TE and its leg still says what was reached when).
 */
export function settleArrival(
  endTE: number,
  end: number,
  eggs: number[],
  farm: Farm,
  top: number,
  avoid: Blocked | undefined
): { te: number; time: number; delivered: number[]; heldNext: boolean; terminal: boolean } | null {
  const reached = Math.min(endTE, top);
  if (reached >= top || !avoid?.length) return { te: reached, time: end, delivered: eggs, heldNext: false, terminal: false };
  const h = holdArrival(end, eggs, farm, avoid);
  if (!h.held) return { te: reached, time: end, delivered: eggs, heldNext: false, terminal: false };
  if (h.te >= top) return null;
  return { te: h.te, time: h.at, delivered: h.delivered, heldNext: true, terminal: h.te > reached };
}

/** The build that reaches `target` soonest (least time, the first of equals). */
function fastest(sweeps: TailSweep[], builds: BuildParams[], target: number) {
  let best: { sweep: TailSweep; build: BuildParams; i: number } | null = null;
  for (let j = 0; j < sweeps.length; j++) {
    const sw = sweeps[j];
    const i = target - sw.from;
    if (i < 0 || i >= sw.seconds.length) continue;
    const sec = sw.seconds[i];
    if (Number.isNaN(sec)) continue;
    if (!best || sec < best.sweep.seconds[best.i]) best = { sweep: sw, build: builds[j], i };
  }
  return best;
}

/**
 * Differences too small to matter between two arrivals: a minute, and a few tens of seconds' eggs at
 * peak delivery. Without the slack, near-copies that differ by a few billion eggs each "beat" one
 * another and nothing is ever discarded.
 */
const TIME_SLACK = 60;
const EGG_SLACK = 1e14;

function dominates(a: { time: number; delivered: number[] }, b: { time: number; delivered: number[] }): boolean {
  if (a.time > b.time + TIME_SLACK) return false;
  for (let i = 0; i < a.delivered.length; i++) if (a.delivered[i] < b.delivered[i] - EGG_SLACK) return false;
  return true;
}

/** Arrivals kept per (TE, ascensions). */
const KEEP = 6;

/**
 * The highest stop worth ascending at on the way to a later target. Past about TE 340 a build already
 * reaches the full laying rate, so another ascension there only adds a prestige and a rebuild
 * (AutoAutoAP measured no fastest route with a stop above 338 over 650 routes). A route can still END
 * above it. For maxed earnings artifacts: weaker artifacts reach that rate its shift later (`usefulStopMax`).
 */
export const USEFUL_STOP_MAX = 360;

/** `USEFUL_STOP_MAX` for a table read with weaker earnings artifacts (`BuildLookup.shift`). */
export function usefulStopMax(table: BuildLookup): number {
  return USEFUL_STOP_MAX + Math.ceil(table.shift ?? 0);
}

type Kept<T> = T & { time: number; delivered: number[] };

/** Add to an earliest-first list, keeping only the unbeaten and at most KEEP. */
function keepUnbeaten<T>(list: Kept<T>[] | undefined, item: Kept<T>): Kept<T>[] {
  if (!list) return [item];
  if (list.some(l => dominates(l, item))) return list;
  const kept = list.filter(l => !dominates(item, l));
  let at = kept.findIndex(l => l.time > item.time);
  if (at < 0) at = kept.length;
  kept.splice(at, 0, item);
  if (kept.length > KEEP) kept.length = KEEP;
  return kept;
}

/**
 * Sweeps kept across a search's steps (the same counts at the same TE and hour come back at other
 * numbers of ascensions), held to a memory budget, least recently used out first.
 */
export class SweepCache {
  private map = new Map<string, TailSweep>();
  private bytes = 0;
  constructor(private readonly maxBytes = 512 * 1024 * 1024) {}
  get(key: string): TailSweep | undefined {
    const sw = this.map.get(key);
    if (sw) {
      this.map.delete(key);
      this.map.set(key, sw);
    }
    return sw;
  }
  set(key: string, sweep: TailSweep): void {
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.bytes;
      this.map.delete(key);
    }
    this.map.set(key, sweep);
    this.bytes += sweep.bytes;
    for (const [k, sw] of this.map) {
      if (this.bytes <= this.maxBytes || k === key) break;
      this.map.delete(k);
      this.bytes -= sw.bytes;
    }
  }
}

export interface Arrival {
  id: number;
  te: number;
  time: number;
  delivered: number[];
  /** The stop it ascended at (absent at the start). */
  stop?: number;
  /** Its prestige already waited for a blocked span (`settleArrival`). */
  held?: boolean;
  farm?: Farm;
}

interface Candidate {
  from: number;
  te: number;
  time: number;
  delivered: number[];
  leg: RouteLeg;
  heldNext?: boolean;
  farm?: Farm;
}

/** What `legsFrom` hands over for each stop: the leg, the farm it leaves laying, and where the route
 *  stands for its next prestige (`settleArrival`). `eggs` is reused between calls: copy to keep it. */
export interface LegOffer {
  leg: RouteLeg;
  farm: Farm;
  eggs: number[];
  settled: NonNullable<ReturnType<typeof settleArrival>>;
}

/**
 * Every stop above an arrival, one ascension on: from the table's builds for its TE and start hour
 * moved onto its egg counts (or at once inside the sale, whichever ends sooner), each told to `visit`.
 * `keepHighEnds`: offer stops above `usefulStopMax` that are not `top` too. `highest`: offer no stop
 * above it (the sweeps stop there too, which is most of the work).
 */
export function legsFrom(
  table: BuildLookup,
  top: number,
  keepHighEnds: boolean,
  item: Arrival,
  cache: SweepCache,
  avoid: Blocked | undefined,
  visit: (offer: LegOffer) => void,
  highest = top
): void {
  const reach = Math.min(top, highest);
  const sweepOf = (b: BuildParams, key: string, lateBy: number, lowest: number): TailSweep => {
    let sw = cache.get(key);
    if (!sw) {
      sw = sweepTails(b, reach, lateBy, lowest);
      cache.set(key, sw);
    }
    return sw;
  };
  const scratch = [0, 0, 0, 0, 0];
  const stopMax = usefulStopMax(table);
  if (item.stop !== undefined && item.stop > stopMax) return;
  const te = item.te;
  const startAt = prestigeAt(item.time, avoid);
  // Held here only at the plan start; later holds were settled on arrival (`settleArrival`).
  const held = item.held || startAt !== nextHour(item.time);
  // On the hour, the farm lays on until the prestige (a held arrival is there already); inside the
  // sale, the build can start at once.
  const onEggs = laidOn(item.delivered, item.farm, startAt - item.time);
  const onTE = Math.max(te, teOf(onEggs));
  const raw = table(onTE, pacificHourOfWeek(startAt)) ?? [];
  // At once inside the sale, unless that moment is an avoided one.
  const late =
    startAt !== item.time && nextAllowed(item.time, avoid) === item.time ? startInSale(table, te, item.time) : null;
  if (!raw.length && !late) return;
  const builds = raw.map(b => rebase(b, onTE, onEggs));
  const exactOn = exactTE(onEggs);
  const exactLate = exactTE(item.delivered);
  const countsKey = `${onTE}|${startAt}|${onEggs.join(',')}|${reach}|`;
  const sweeps = builds.map((b, j) => sweepOf(b, countsKey + j, 0, onTE + 1));
  const lateBuilds = late ? late.builds.map(b => rebase(b, te, item.delivered)) : [];
  const lateKey = `${te}|${item.time}|${item.delivered.join(',')}|${reach}|late|`;
  const lateSweeps = lateBuilds.map((b, j) => sweepOf(b, lateKey + j, late!.lateBy, te + 1));
  for (let target = te + 1; target <= reach; target++) {
    // A stop above the cap that is not the target leads nowhere (it is never continued from).
    if (target > stopMax && target < top && !keepHighEnds) continue;
    const onHour = fastest(sweeps, builds, target);
    const early = late ? fastest(lateSweeps, lateBuilds, target) : null;
    const takeEarly =
      !!early && (!onHour || item.time + early.sweep.seconds[early.i] < startAt + onHour.sweep.seconds[onHour.i]);
    const pick = takeEarly ? early : onHour;
    if (!pick) continue;
    const { sweep, build, i } = pick;
    const legStart = takeEarly ? item.time : startAt;
    const end = legStart + sweep.seconds[i];
    const endTE = sweep.endTE[i];
    sweep.deliveredInto(i, scratch);
    const leg: RouteLeg = {
      from: takeEarly ? te : onTE,
      to: target,
      endTE,
      start: legStart,
      end,
      sales: build.sales,
      tier13: build.tier13,
      rate: build.peakELR,
      exactFrom: takeEarly ? exactLate : exactOn,
      exactEnd: exactTE(scratch),
      ...(held && !takeEarly ? { held: true } : {}),
    };
    const farm = farmAfter(build, scratch);
    const settled = settleArrival(endTE, end, scratch.slice(), farm, top, avoid);
    if (settled) visit({ leg, farm, eggs: scratch, settled });
  }
}

/**
 * Carry each arrival one ascension further (`legsFrom`), keeping per end TE only what nothing beats.
 */
function expandArrivals(
  table: BuildLookup,
  top: number,
  keepHighEnds: boolean,
  items: Arrival[],
  cache: SweepCache,
  avoid?: Blocked
): { candidates: Candidate[]; terminals: Candidate[] } {
  const lists = new Map<number, Candidate[]>();
  const terminals: Candidate[] = [];
  const beaten = (te: number, time: number, eggs: number[]): boolean => {
    const list = lists.get(te);
    if (!list) return false;
    for (const l of list) {
      if (l.time > time + TIME_SLACK) continue;
      let all = true;
      for (let e = 0; e < 5; e++) {
        if (l.delivered[e] < eggs[e] - EGG_SLACK) {
          all = false;
          break;
        }
      }
      if (all) return true;
    }
    return false;
  };

  for (const item of items)
    legsFrom(table, top, keepHighEnds, item, cache, avoid, ({ leg, farm, eggs, settled }) => {
      if (settled.terminal)
        terminals.push({ from: item.id, te: Math.min(leg.endTE, top), time: leg.end, delivered: eggs.slice(), leg });
      if (beaten(settled.te, settled.time, settled.delivered)) return;
      lists.set(
        settled.te,
        keepUnbeaten(lists.get(settled.te), {
          from: item.id,
          te: settled.te,
          time: settled.time,
          delivered: settled.delivered,
          leg,
          farm,
          ...(settled.heldNext ? { heldNext: true } : {}),
        })
      );
    });
  return { candidates: [...lists.keys()].sort((a, b) => a - b).flatMap(te => lists.get(te)!), terminals };
}

/** Continue is not a candidate past this on the way to a later stop (AutoAutoAP's
 *  CONTINUE_MAX_SECONDS): a year on one farm is not a plan. Continuing to where the route ends is
 *  always kept, however long, so the 1-ascension row says what not prestiging at all would take. */
export const CONTINUE_MAX_SECONDS = 183 * 86400;

/** The first ascension to one stop: where it ends, when, and whether it continued or prestiged. */
export interface FirstLeg {
  /** The TE it starts at: the start TE, or more when a waiting first prestige's eggs made more. */
  from: number;
  /** That TE with fractions (`exactTE`). */
  exactFrom: number;
  to: number;
  endTE: number;
  start: number;
  end: number;
  /** Eggs delivered per egg when it ends (EGG_ORDER). */
  delivered: number[];
  continued: boolean;
  sales: number;
  tier13: boolean;
  held?: boolean;
  /** The farm it leaves laying (`farmAfter`). */
  farm: Farm;
}

/**
 * The first ascension to every stop above `startTE`, both ways (after AutoAutoAP's `firstLegOptions`):
 * continuing the one in progress, from `start`, and a fresh build from the table moved onto the real
 * egg counts, on the next whole hour (or at once inside the sale, whichever ends sooner).
 *
 * Both are kept, because they count differently: prestiging now ends the ascension in progress, so
 * it is an ascension of its own (`findRoutes` files a prestige-first route one count higher), where
 * continuing it to the stop is that same ascension.
 */
export function firstLegOptions(table: BuildLookup, o: FindOptions & { cont: BuildParams }): FirstLeg[] {
  const te = o.startTE;
  const delivered = o.startDelivered ?? canonicalDelivered(te);
  // A first prestige that waits: the farm in progress lays on meanwhile (`holdArrival`), so the fresh
  // build starts from those eggs, at the TE they make.
  const farm = o.contEgg !== undefined ? { egg: o.contEgg, rate: o.cont.peakELR } : null;
  const hold = holdArrival(o.start, delivered, farm, o.avoid);
  const freshAt = hold.at;
  const held = hold.held;
  // The farm in progress lays on until the prestige, on the hour or after a blocked span.
  const freshTE = Math.max(te, hold.te);
  const freshEggs = hold.delivered;
  const fresh = (table(freshTE, pacificHourOfWeek(freshAt)) ?? []).map(b => rebase(b, freshTE, freshEggs));
  const freshSweeps = fresh.map(b => sweepTails(b, o.final, 0, freshTE + 1));
  const late =
    freshAt !== o.start && nextAllowed(o.start, o.avoid) === o.start ? startInSale(table, te, o.start) : null;
  const lateFresh = late ? late.builds.map(b => rebase(b, te, delivered)) : [];
  const lateSweeps = lateFresh.map(b => sweepTails(b, o.final, late!.lateBy, te + 1));
  const contSweep = sweepTails(o.cont, o.final, 0, te + 1);

  const out: FirstLeg[] = [];
  for (let target = te + 1; target <= o.final; target++) {
    const options: FirstLeg[] = [];
    const add = (
      sw: TailSweep,
      i: number,
      start: number,
      continued: boolean,
      b: BuildParams,
      from: number,
      startEggs: number[]
    ) => {
      const eggs = [0, 0, 0, 0, 0];
      sw.deliveredInto(i, eggs);
      options.push({
        from,
        exactFrom: exactTE(startEggs),
        to: target,
        endTE: sw.endTE[i],
        start,
        end: start + sw.seconds[i],
        delivered: eggs,
        continued,
        sales: b.sales,
        tier13: b.tier13,
        ...(held && !continued && start === freshAt ? { held: true } : {}),
        farm: farmAfter(b, eggs),
      });
    };
    const onHour = fastest(freshSweeps, fresh, target);
    if (onHour) add(onHour.sweep, onHour.i, freshAt, false, onHour.build, freshTE, freshEggs);
    const now = late ? fastest(lateSweeps, lateFresh, target) : null;
    if (now) add(now.sweep, now.i, o.start, false, now.build, te, delivered);
    // The sooner prestige: on the hour, or at once inside the sale.
    const f = options.reduce<FirstLeg | null>((a, x) => (!a || x.end < a.end ? x : a), null);
    const ci = target - contSweep.from;
    const contSeconds = ci >= 0 && ci < contSweep.seconds.length ? contSweep.seconds[ci] : NaN;
    let c: FirstLeg | null = null;
    // Where the route can end: the target, or by a date anything reached in time.
    const routeEnd = target === o.final || (o.deadline !== undefined && o.start + contSeconds <= o.deadline);
    if (contSeconds <= CONTINUE_MAX_SECONDS || (routeEnd && Number.isFinite(contSeconds))) {
      const before = options.length;
      add(contSweep, ci, o.start, true, o.cont, te, delivered);
      c = options[before];
    }
    if (f) out.push(f);
    if (c) out.push(c);
  }
  return out;
}

/**
 * The fastest route to `final` with each number of ascensions, and the fastest overall; with a
 * deadline, also the highest TE reached in time for each count and overall.
 */
export function findRoutes(table: BuildLookup, o: FindOptions): FoundRoutes {
  const K = o.maxAscensions;
  const top = o.final;
  const keepHighEnds = o.deadline !== undefined;
  const cache = new SweepCache();
  let nextId = 0;
  const byId = new Map<number, Label>();
  const label = (l: Omit<Label, 'id'>): Label => {
    const made = { ...l, id: nextId++ };
    byId.set(made.id, made);
    return made;
  };
  // arrivals[k].get(te): the arrivals at TE `te` after k ascensions, earliest first.
  const arrivals: Map<number, Label[]>[] = Array.from({ length: K + 1 }, () => new Map());
  arrivals[0].set(o.startTE, [
    label({ time: o.start, delivered: o.startDelivered ?? canonicalDelivered(o.startTE), prev: null, leg: null }),
  ]);
  let checked = 0;
  const relax = (k: number, te: number, l: Omit<Label, 'id'>) => {
    checked++;
    const list = arrivals[k].get(te);
    if (list?.some(x => dominates(x, l))) return;
    arrivals[k].set(te, keepUnbeaten(list, label(l)));
  };
  // By a date: stops reached before a wait that added TE, ends only (`settleArrival`).
  const terminals: Label[][] = Array.from({ length: K + 1 }, () => []);

  for (let k = 0; k < K; k++) {
    o.onProgress?.(k, K);
    if (k === 0 && o.cont) {
      const start = arrivals[0].get(o.startTE)![0];
      // The ascension in progress is the first: continuing it to a stop is one ascension; prestiging it
      // now ends it, and the fresh build to the stop is a second.
      for (const f of firstLegOptions(table, { ...o, cont: o.cont })) {
        const k1 = f.continued ? 1 : 2;
        if (k1 > K) continue;
        const leg = firstLeg(f);
        const settled = settleArrival(f.endTE, f.end, f.delivered, f.farm, top, o.avoid);
        if (!settled) continue;
        if (settled.terminal && keepHighEnds) {
          checked++;
          terminals[k1].push(label({ time: f.end, delivered: f.delivered, prev: start, leg }));
        }
        relax(k1, settled.te, {
          time: settled.time,
          delivered: settled.delivered,
          prev: start,
          leg,
          farm: f.farm,
          ...(settled.heldNext ? { heldNext: true } : {}),
        });
      }
      continue;
    }
    const items: Arrival[] = [];
    for (const te of [...arrivals[k].keys()].filter(te => te < top).sort((a, b) => a - b))
      for (const l of arrivals[k].get(te)!)
        items.push({
          id: l.id,
          te,
          time: l.time,
          delivered: l.delivered,
          ...(l.leg ? { stop: l.leg.to } : {}),
          ...(l.heldNext ? { held: true } : {}),
          ...(l.farm ? { farm: l.farm } : {}),
        });
    if (!items.length) break;
    const { candidates, terminals: ends } = expandArrivals(table, top, keepHighEnds, items, cache, o.avoid);
    for (const c of candidates)
      relax(k + 1, c.te, {
        time: c.time,
        delivered: c.delivered,
        prev: byId.get(c.from) ?? null,
        leg: c.leg,
        ...(c.farm ? { farm: c.farm } : {}),
        ...(c.heldNext ? { heldNext: true } : {}),
      });
    if (keepHighEnds) {
      checked += ends.length;
      for (const c of ends)
        terminals[k + 1].push(label({ time: c.time, delivered: c.delivered, prev: byId.get(c.from) ?? null, leg: c.leg }));
    }
  }
  o.onProgress?.(K, K);

  // A route ends when its last stop is reached (`leg.end`), not when a held prestige after it could start.
  const routeTo = (last: Label): Route => {
    const legs: RouteLeg[] = [];
    for (let l: Label | null = last; l?.leg; l = l.prev) legs.unshift(l.leg);
    const end = last.leg!.end;
    return { chain: legs.map(l => l.to), legs, end, seconds: end - o.start };
  };
  const byAscensions = Array.from({ length: K + 1 }, (_, k) => {
    const last = k ? arrivals[k].get(top)?.[0] : undefined;
    return last ? routeTo(last) : null;
  });
  const best = byAscensions.reduce<Route | null>((a, r) => (r && (!a || r.end < a.end) ? r : a), null);

  let byDate: Route | null = null;
  const byDateByAscensions: (Route | null)[] = Array.from({ length: K + 1 }, () => null);
  if (o.deadline !== undefined) {
    let overall: { te: number; end: number; label: Label } | null = null;
    for (let k = 1; k <= K; k++) {
      // Each arrival as reached: its leg's TE and time (a held arrival is filed by what its wait made).
      let mine: { te: number; end: number; label: Label } | null = null;
      for (const l of [...[...arrivals[k].values()].flat(), ...terminals[k]]) {
        const te = Math.min(l.leg!.endTE, top);
        const end = l.leg!.end;
        if (end > o.deadline) continue;
        if (!mine || te > mine.te || (te === mine.te && end < mine.end)) mine = { te, end, label: l };
      }
      if (!mine) continue;
      byDateByAscensions[k] = routeTo(mine.label);
      if (!overall || mine.te > overall.te || (mine.te === overall.te && mine.end < overall.end)) overall = mine;
    }
    byDate = overall ? routeTo(overall.label) : null;
  }
  return { best, byAscensions, byDate, byDateByAscensions, checked };
}

export function firstLeg(f: FirstLeg): RouteLeg {
  return {
    from: f.from,
    to: f.to,
    endTE: f.endTE,
    start: f.start,
    end: f.end,
    sales: f.sales,
    tier13: f.tier13,
    rate: f.farm.rate,
    exactFrom: f.exactFrom,
    exactEnd: exactTE(f.delivered),
    ...(f.continued ? { continued: true } : {}),
    ...(f.held ? { held: true } : {}),
  };
}

/** Where a route stands before its next ascension, as `priceChain` walks it. */
interface ChainState {
  /** When the last stop was reached (the plan start, before the first ascension). */
  t: number;
  te: number;
  eggs: number[];
  /** The farm the last stop was reached on, for a waiting prestige's eggs. */
  farm: Farm | null;
  legs: RouteLeg[];
}

/** One ascension priced (`priceStep`): where it leaves the route, and its leg. */
interface Step {
  t: number;
  te: number;
  eggs: number[];
  farm: Farm;
  leg: RouteLeg;
}

/**
 * Steps already priced, shared by every route `polishFound` works on: the hold pass tries each wait
 * at each stop and walks the rest of the route again, often from the same arrival. Cleared, not
 * trimmed, at its cap; a search fills it in seconds.
 */
class StepMemo {
  private map = new Map<string, Step | null>();
  constructor(private readonly max = 200_000) {}
  get(key: string): Step | null | undefined {
    return this.map.get(key);
  }
  set(key: string, step: Step | null): void {
    if (this.map.size >= this.max) this.map.clear();
    this.map.set(key, step);
  }
}

/** How a chain is priced: the search's options, the first legs when there is an ascension in
 *  progress, and which kind of first step (a prestige-first and a continue-first route are different
 *  numbers of ascensions). */
interface ChainPricing {
  table: BuildLookup;
  o: FindOptions;
  firstLegs: FirstLeg[] | null;
  firstContinued: boolean;
  memo?: StepMemo;
}

function startState(o: FindOptions): ChainState {
  return { t: o.start, te: o.startTE, eggs: o.startDelivered ?? canonicalDelivered(o.startTE), farm: null, legs: [] };
}

/** The farm the ascension in progress lays on, when its egg is known. */
function contFarm(o: FindOptions): Farm | null {
  return o.cont && o.contEgg !== undefined ? { egg: o.contEgg, rate: o.cont.peakELR } : null;
}

/** Whether ascension `i` starts with a prestige that can wait for eggs: any after the first, and the
 *  first when it ends the ascension in progress on a known farm. */
function canWait(p: ChainPricing, i: number): boolean {
  return i > 0 || (!!p.firstLegs && !p.firstContinued && !!contFarm(p.o));
}

/**
 * Ascension `i` of a chain, to `target`, from where the route stands: the first from `firstLegs` when
 * there is an ascension in progress, else a prestige on the hour (or late inside the sale). A prestige
 * after a stop that must wait for a blocked span credits the farm's laying (`settleArrival`), and one
 * that waits `hours` by choice does the same. Null when the stop is not above the TE reached by then.
 */
function priceStep(p: ChainPricing, s: ChainState, i: number, target: number, hours: number): Step | null {
  const { o } = p;
  if (i === 0 && p.firstLegs && !(hours > 0 && !p.firstContinued)) {
    const f = p.firstLegs.find(x => x.to === target && x.continued === p.firstContinued);
    return f ? { t: f.end, te: f.endTE, eggs: f.delivered, farm: f.farm, leg: firstLeg(f) } : null;
  }
  let { t, te, eggs } = s;
  let held = false;
  let waited = 0;
  let waitFrom = 0;
  const farm = i === 0 ? contFarm(o) : s.farm;
  if (hours > 0 && !farm) return null;
  if ((i > 0 || hours > 0) && farm) {
    const h = holdArrival(t, eggs, farm, o.avoid, hours * 3600);
    if (h.held) {
      if (hours > 0) {
        waited = h.at - nextHour(t);
        // Only the farm's egg gains while it waits, from the stop's reaching (as `holdArrival` credits).
        const e0 = eggs[farm.egg];
        const n0 = countTEThresholdsPassed(e0);
        const n1 = countTEThresholdsPassed(h.delivered[farm.egg]);
        waitFrom = n1 > n0 ? t + (TE_BREAKPOINTS[n1 - 1] - e0) / farm.rate : t;
      } else held = true;
      t = h.at;
      eggs = h.delivered;
      te = Math.max(te, h.te);
    }
  }
  if (target <= te) return null;
  // Not held: the farm lays on until the prestige on the next whole hour (`priceLeg`).
  const pr = priceLeg(p.table, te, t, eggs, target, o.avoid, farm);
  if (!pr) return null;
  const leg: RouteLeg = {
    from: pr.from,
    to: target,
    endTE: pr.endTE,
    start: pr.start,
    end: pr.end,
    sales: pr.build.sales,
    tier13: pr.build.tier13,
    rate: pr.build.peakELR,
    exactFrom: exactTE(pr.startDelivered),
    exactEnd: exactTE(pr.delivered),
    ...(waited > 0 ? { waited, waitFrom } : held || pr.start > nextHour(t) ? { held: true } : {}),
  };
  return { t: pr.end, te: pr.endTE, eggs: pr.delivered, farm: farmAfter(pr.build, pr.delivered), leg };
}

/** `priceStep`, remembered in `p.memo` when there is one. */
function stepChain(p: ChainPricing, s: ChainState, i: number, target: number, hours: number): ChainState | null {
  let step: Step | null | undefined;
  if (p.memo) {
    const key = `${i === 0}|${p.firstContinued}|${target}|${hours}|${s.t}|${s.te}|${s.eggs.join(',')}|${s.farm?.egg}|${s.farm?.rate}`;
    step = p.memo.get(key);
    if (step === undefined) {
      step = priceStep(p, s, i, target, hours);
      p.memo.set(key, step);
    }
  } else step = priceStep(p, s, i, target, hours);
  return step && { t: step.t, te: step.te, eggs: step.eggs, farm: step.farm, legs: [...s.legs, step.leg] };
}

const routeOf = (o: FindOptions, chain: number[], s: ChainState): Route => ({
  chain: [...chain],
  legs: s.legs,
  end: s.t,
  seconds: s.t - o.start,
});

/** `chain` priced the way `findRoutes` prices a route (`priceStep`), each prestige waiting
 *  `holds[i]` whole hours by choice. Null when a stop is not above the TE reached by then. */
function priceChain(p: ChainPricing, chain: number[], holds?: number[]): Route | null {
  let s: ChainState | null = startState(p.o);
  for (const [i, target] of chain.entries()) {
    s = stepChain(p, s, i, target, holds?.[i] ?? 0);
    if (!s) return null;
  }
  return routeOf(p.o, chain, s);
}

/**
 * A local search around one route: each stop before the last moved by up to 2 TE, then each pair of
 * neighbouring stops by one together, keeping any route `ok` accepts that ends sooner, until nothing
 * improves. The finder can prune a route that a later, better-aligned start makes faster; this finds
 * such a neighbour in milliseconds, and never returns anything slower. Each prestige keeps its wait
 * (`holds`) as its stop moves.
 */
function polishRoute(p: ChainPricing, route: Route, ok: (r: Route) => boolean, holds?: number[]): Route {
  let best = route;
  const tryChain = (c: number[]): boolean => {
    const r = priceChain(p, c, holds);
    if (!r || !ok(r) || !(r.end < best.end - 60)) return false;
    best = r;
    return true;
  };
  for (let round = 0; round < 20; round++) {
    let improved = false;
    for (let i = 0; i < best.chain.length - 1; i++) {
      for (let d = -2; d <= 2; d++) {
        if (!d) continue;
        const c = [...best.chain];
        c[i] += d;
        if (tryChain(c)) improved = true;
      }
    }
    for (let i = 0; i + 1 < best.chain.length - 1; i++) {
      for (const [a, b] of [
        [1, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
      ]) {
        const c = [...best.chain];
        c[i] += a;
        c[i + 1] += b;
        if (tryChain(c)) improved = true;
      }
    }
    if (!improved) break;
  }
  return best;
}

/** Longest a prestige may wait by choice: a week, every hour of it a different table cell. */
export const MAX_WAIT_HOURS = 168;

/** `a` is no later than `b`, with at least its eggs on every egg and a farm at least as fast on the
 *  same egg: whatever follows `b`, `a` can do as well. */
function beats(a: ChainState, b: ChainState): boolean {
  if (a.t > b.t) return false;
  if (a.farm && b.farm && (a.farm.egg !== b.farm.egg || a.farm.rate < b.farm.rate)) return false;
  for (let e = 0; e < 5; e++) if (a.eggs[e] < b.eggs[e]) return false;
  return true;
}

/**
 * The waits that make a route end soonest: for each prestige in turn, every whole number of hours up
 * to MAX_WAIT_HOURS, the farm laying on meanwhile (`holdArrival`), the other prestiges' waits kept,
 * until no wait improves. Any saving counts; of equal ends the shorter wait wins.
 *
 * Kept quick two ways. Only the ascensions from the waiting prestige on are priced again. And of the
 * waits at one prestige, only those whose next stop no other reaches sooner with more eggs (`beats`)
 * are priced to the route's end.
 */
function holdRoute(
  p: ChainPricing,
  route: Route,
  ok: (r: Route) => boolean,
  start: number[]
): { route: Route; holds: number[] } {
  const chain = route.chain;
  const n = chain.length;
  const holds = [...start];
  // states[i]: where the route stands before ascension i, with the waits chosen so far.
  const states: ChainState[] = [startState(p.o)];
  const restate = (from: number): boolean => {
    for (let j = from; j < n; j++) {
      const s = stepChain(p, states[j], j, chain[j], holds[j]);
      if (!s) return false;
      states[j + 1] = s;
    }
    return true;
  };
  if (!restate(0)) return { route, holds: start };
  let best = routeOf(p.o, chain, states[n]);
  const walk = (from: number, s: ChainState): ChainState | null => {
    let at: ChainState | null = s;
    for (let j = from; j < n && at; j++) at = stepChain(p, at, j, chain[j], holds[j]);
    return at;
  };

  for (let round = 0; round < 4; round++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      if (!canWait(p, i)) continue;
      const tried: { h: number; s: ChainState }[] = [];
      for (let h = 0; h <= MAX_WAIT_HOURS; h++) {
        if (h === holds[i]) continue;
        const s = stepChain(p, states[i], i, chain[i], h);
        if (s && !beats(states[i + 1], s)) tried.push({ h, s });
      }
      const last = i === n - 1;
      let pick: { h: number; route: Route } | null = null;
      for (const c of tried) {
        if (!last && tried.some(b => b !== c && beats(b.s, c.s) && (b.h < c.h || !beats(c.s, b.s)))) continue;
        const end = last ? c.s : walk(i + 1, c.s);
        if (!end) continue;
        const r = routeOf(p.o, chain, end);
        if (r.end < (pick?.route.end ?? best.end) - 1 && ok(r)) pick = { h: c.h, route: r };
      }
      if (!pick) continue;
      holds[i] = pick.h;
      restate(i);
      best = pick.route;
      improved = true;
    }
    if (!improved) break;
  }
  return { route: best, holds };
}

/**
 * A wait whose eggs pass TE thresholds (the next ascension starts above the stop) earns those TE on
 * one egg only, where the ascension itself, going on to a higher stop, earns them cheapest first. So
 * try each such stop raised by the TE its wait made, down to one, with every wait found again
 * (`holdRoute`): the first that ends no later is taken. Polishing can't find it, since it moves a
 * stop with the waits kept as they are, and the wait it needs is shorter.
 */
function raiseStops(
  p: ChainPricing,
  route: Route,
  ok: (r: Route) => boolean,
  holds: number[]
): { route: Route; holds: number[] } | null {
  const chain = route.chain;
  for (let i = 0; i + 1 < chain.length; i++) {
    const next = route.legs[i + 1];
    const gained = next.waited ? next.from - route.legs[i].endTE : 0;
    for (let d = gained; d >= 1; d--) {
      const c = [...chain];
      c[i] += d;
      if (c[i] >= c[i + 1]) continue;
      const h = [...holds];
      h[i + 1] = 0;
      const start = priceChain(p, c, h);
      if (!start) continue;
      const found = holdRoute(p, start, ok, h);
      if (found.route.end <= route.end + 1 && ok(found.route)) return found;
    }
  }
  return null;
}

/** The last TE a route reaches. */
export function lastTE(r: Route): number {
  return r.legs[r.legs.length - 1]?.endTE ?? 0;
}

/**
 * `findRoutes`' answer with each route polished, and the overall picks made again from them. With
 * `waitForEggs`, each route's prestiges also wait where that ends it sooner (`holdRoute`), and the
 * stops are polished again around those waits until neither changes. `onProgress` is told after each
 * route.
 */
export function polishFound(
  table: BuildLookup,
  o: FindOptions,
  found: FoundRoutes,
  onProgress?: (done: number, of: number) => void
): FoundRoutes {
  const firstLegs = o.cont ? firstLegOptions(table, { ...o, cont: o.cont }) : null;
  const memo = o.waitForEggs ? new StepMemo() : undefined;
  const total =
    found.byAscensions.filter(r => r).length + (o.deadline !== undefined ? found.byDateByAscensions.filter(r => r).length : 0);
  let done = 0;
  const improve = (route: Route, ok: (r: Route) => boolean): Route => {
    const p: ChainPricing = { table, o, firstLegs, firstContinued: route.legs[0]?.continued === true, memo };
    let best = polishRoute(p, route, ok);
    if (o.waitForEggs) {
      let holds = best.chain.map(() => 0);
      for (let pass = 0; pass < 4; pass++) {
        const held = holdRoute(p, best, ok, holds);
        holds = held.holds;
        const polished = polishRoute(p, held.route, ok, holds);
        const raised = raiseStops(p, polished, ok, holds);
        best = raised?.route ?? polished;
        if (raised) holds = raised.holds;
        else if (polished === held.route) break;
      }
    }
    onProgress?.(++done, total);
    return best;
  };
  const byAscensions = found.byAscensions.map(r => (r ? improve(r, () => true) : r));
  const best = byAscensions.reduce<Route | null>((a, r) => (r && (!a || r.end < a.end) ? r : a), null);
  if (o.deadline === undefined) return { ...found, best, byAscensions };
  const deadline = o.deadline;
  const byDateByAscensions = found.byDateByAscensions.map(r =>
    r ? improve(r, c => c.end <= deadline && lastTE(c) >= lastTE(r)) : r
  );
  const byDate = byDateByAscensions.reduce<Route | null>(
    (a, r) => (r && (!a || lastTE(r) > lastTE(a) || (lastTE(r) === lastTE(a) && r.end < a.end)) ? r : a),
    null
  );
  return { ...found, best, byAscensions, byDate, byDateByAscensions };
}

/** Chains of one kind (continuing first, or prestiging) priced under a search's options. */
export interface ChainPricer {
  /** As `findRoutes` prices it, no prestige waiting by choice; null when a stop is not above the TE
   *  reached by then. */
  price(chain: number[]): Route | null;
  /** With `waitForEggs`, its waits found too (`holdRoute`); otherwise `price`. */
  withWaits(chain: number[]): Route | null;
}

/** A `ChainPricer`, its first legs worked out once and its steps shared between chains. */
export function chainPricer(table: BuildLookup, o: FindOptions, firstContinued: boolean): ChainPricer {
  const firstLegs = o.cont ? firstLegOptions(table, { ...o, cont: o.cont }) : null;
  const p: ChainPricing = { table, o, firstLegs, firstContinued, memo: new StepMemo() };
  const ok = (r: Route) => o.deadline === undefined || r.end <= o.deadline;
  return {
    price: chain => priceChain(p, chain),
    withWaits(chain) {
      const r = priceChain(p, chain);
      if (!r || !o.waitForEggs) return r;
      return holdRoute(p, r, ok, chain.map(() => 0)).route;
    },
  };
}
