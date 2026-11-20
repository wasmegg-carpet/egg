// The fueling pad's schedule: when each launch of a laid-out plan goes up, once every launch has to be fueled on the
// game's one pad first (SPEC.md section 18). The layout lays each slot out as if fueling took no time; this re-times
// the whole plan, every slot keeping its order, with each launch at the first instant its slot, the pad and the
// player allow. What it cannot keep (a doubled launch carried past the 2x window's close, a slot carried past the
// horizon) the caller settles, as it settles a layout; the times themselves always keep the pad rule, the sleep rule
// and each slot's order, by construction. It reads plan seconds only: the regular day enters through the wake offset,
// as it does in the verifier (`verify.ts`).

import { DAY_SECONDS, type SleepWindow } from './types';

// Slack on the scheduler's own comparisons. Ten times inside the verifier's `VERIFY_TOL_SECONDS`, as the layout's is.
const PAD_TOL = 1e-7;

// One launch of a slot as the scheduler reads it.
export interface PadItem {
  // Seconds the pad takes to fuel it.
  padSeconds: number;
  // Seconds it holds its slot from its launch, as the verifier times it.
  block: number;
  // When the layout had it go up, on the plan's clock. The scheduler reads it only to break ties between slots,
  // never as a launch time.
  launchAt: number;
  // Doubled: it must still go up by the 2x window's close to keep its yield.
  doubled: boolean;
  // A T+0 variant: it may go up only in the start chain.
  startVariant: boolean;
}

export interface PadTimes {
  // Per slot, per launch, its launch time.
  launchAt: number[][];
  // Per slot, per launch, whether it is in the start chain (`verify.ts`, `startChain`).
  chain: boolean[][];
  // Per slot, the launches that went up past their latest start (`latestStarts`): from each of them on, the slot no
  // longer ends by the horizon in its order, so it has to lose a launch.
  late: number[][];
}

// The plan's day as the scheduler reads it: the verifier's (`timelineOf`), its time of day `wakeOffsetSeconds` ahead
// of the plan's clock. With no sleep every instant is awake.
interface Clock {
  awakeFrom(t: number): number;
  latestAwake(t: number): number;
}

function clockOf(sleep: SleepWindow): Clock {
  const S = sleep.sleepSeconds;
  const W = DAY_SECONDS - S;
  const x = sleep.wakeOffsetSeconds ?? 0;
  const dayOf = (t: number) => Math.floor((t + x + PAD_TOL) / DAY_SECONDS);
  if (!(S > 0)) return { awakeFrom: t => t, latestAwake: t => t };
  const timeOfDay = (t: number) => t + x - dayOf(t) * DAY_SECONDS;
  return {
    awakeFrom: t => (timeOfDay(t) <= W + PAD_TOL ? t : (dayOf(t) + 1) * DAY_SECONDS - x),
    // The latest waking instant at or before `t`: `t` itself, or the bedtime before it when it falls in a night.
    latestAwake: t => (timeOfDay(t) <= W + PAD_TOL ? t : t - (timeOfDay(t) - W)),
  };
}

// Per slot, per launch, the latest it can go up with the rest of the slot, in its order and each at the first waking
// instant the block before it leaves, still ending by the horizon (`latest`), and the same before it is rounded down
// to a waking instant (`raw`), which binds instead for a launch in the start chain, which the player is up for. Exact,
// not a heuristic: a later start never makes a later launch go up earlier, and a block that ends by `t` lets the next
// launch go up by `t` exactly when `t` is a waking instant. With `window`, the same with every doubled launch also
// going up by the window's close, which is the latest that keeps it doubled.
function latestStarts(
  seq: readonly PadItem[],
  clock: Clock,
  horizon: number,
  window: number | null
): { raw: number[]; latest: number[] } {
  const n = seq.length;
  const raw = new Array<number>(n);
  const latest = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    raw[i] = (i + 1 < n ? latest[i + 1] : horizon) - seq[i].block;
    if (window !== null && seq[i].doubled) raw[i] = Math.min(raw[i], window);
    latest[i] = clock.latestAwake(raw[i]);
  }
  return { raw, latest };
}

// Lexicographic: T+0 variants outside the start chain, then launches past the latest start that keeps their slot
// whole, then past the one that also keeps their doubled launches doubled, then the seconds past it, then the launch
// times summed, which puts what can go now first and the shorter fuelling first among equals.
type Score = [number, number, number, number, number];

function better(a: Score, b: Score): boolean {
  for (let i = 0; i < a.length; i++) {
    const tol = i < 3 ? 0.5 : PAD_TOL;
    if (a[i] < b[i] - tol) return true;
    if (a[i] > b[i] + tol) return false;
  }
  return false;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest])
  );
}

// Times every launch of the plan. Each slot keeps its order; launches are taken one at a time, each next one chosen
// among the slots' next launches, which are what the pad can fuel next, by trying every order of those few and
// keeping the first launch of the best (`Score`). The chosen launch goes up at the first instant its slot is free,
// the pad has fueled it and the player is awake: in the start chain when its slot is free by the time the pad has
// fueled it and the pad has not been idle since T+0, awake or not, and otherwise at the first waking instant from
// then. So the times keep, by construction, the pad rule (each launch at least its fuelling after the one before),
// the slot rule (each launch once the block before it has ended) and the sleep rule (awake, or in the chain).
export function schedulePad(slots: readonly (readonly PadItem[])[], sleep: SleepWindow, window: number): PadTimes {
  const clock = clockOf(sleep);
  const horizon = sleep.horizonSeconds;
  const whole = slots.map(seq => latestStarts(seq, clock, horizon, null));
  const doubled = slots.map(seq => latestStarts(seq, clock, horizon, window > 0 ? window : null));
  const launchAt = slots.map(seq => new Array<number>(seq.length).fill(0));
  const chain = slots.map(seq => new Array<boolean>(seq.length).fill(false));
  const late: number[][] = slots.map(() => []);
  const next = slots.map(() => 0);
  const free = slots.map(() => 0);
  let previous = 0;
  let chainOpen = true;

  // Where slot `k`'s next launch goes up when the pad last launched at `prev`, and whether that is in the start chain.
  const place = (k: number, prev: number, open: boolean) => {
    const item = slots[k][next[k]];
    const fueled = prev + item.padSeconds;
    if (open && free[k] <= fueled + PAD_TOL) return { at: fueled, inChain: true };
    return { at: clock.awakeFrom(Math.max(free[k], fueled)), inChain: false };
  };
  const past = (due: { raw: number[]; latest: number[] }, k: number, at: number, inChain: boolean) =>
    at - (inChain ? due.raw[next[k]] : due.latest[next[k]]);

  for (;;) {
    const heads = slots
      .map((seq, k) => k)
      .filter(k => next[k] < slots[k].length)
      .sort((a, b) => slots[a][next[a]].launchAt - slots[b][next[b]].launchAt || a - b);
    if (heads.length === 0) break;
    let best: { score: Score; first: number } | null = null;
    for (const order of heads.length === 1 ? [heads] : permutations(heads)) {
      const score: Score = [0, 0, 0, 0, 0];
      let prev = previous;
      let open = chainOpen;
      for (const k of order) {
        const { at, inChain } = place(k, prev, open);
        if (slots[k][next[k]].startVariant && !inChain) score[0]++;
        if (past(whole[k], k, at, inChain) > PAD_TOL) score[1]++;
        const over = past(doubled[k], k, at, inChain);
        if (over > PAD_TOL) {
          score[2]++;
          score[3] += over;
        }
        score[4] += at;
        open = open && inChain;
        prev = at;
      }
      if (best === null || better(score, best.score)) best = { score, first: order[0] };
    }
    const k = best!.first;
    const { at, inChain } = place(k, previous, chainOpen);
    const i = next[k];
    launchAt[k][i] = at;
    chain[k][i] = inChain;
    if (past(whole[k], k, at, inChain) > PAD_TOL) late[k].push(i);
    chainOpen = chainOpen && inChain;
    previous = at;
    free[k] = at + slots[k][i].block;
    next[k]++;
  }
  return { launchAt, chain, late };
}
