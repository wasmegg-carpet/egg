// The day structure a sleep-aware problem is cut from, and the per-day fit rows' coefficients. See SPEC.md
// section 10.

import { DAY_SECONDS, type SleepWindow } from './types';

// One slot's horizon as the layout and the fit rows see it: `nights` sleep windows, each closing a waking
// window of `wakingSeconds`, then a trailing partial day of `tailSeconds` (0 for a whole-day horizon). Times are
// on the player's regular day, from the wake-up at or before the plan's start (SPEC.md section 17): the plan runs
// from `wakeOffsetSeconds` to `horizonSeconds`, and the first `wakeOffsetSeconds` of the first waking window are a
// busy block no launch can use. With the plan starting at wake-up, the offset is 0 and these are the plan's own
// seconds.
export interface DaySchedule {
  sleepSeconds: number;
  wakingSeconds: number;
  // The end of the plan, on the regular day: `planHorizonSeconds + wakeOffsetSeconds`.
  horizonSeconds: number;
  // The plan's own horizon, `SleepWindow.horizonSeconds`, which the verifier reads.
  planHorizonSeconds: number;
  // The busy block: the waking seconds of the first window spent before the plan starts. The wake offset when the
  // player is awake at the start, 0 when they are in the night.
  wakeOffsetSeconds: number;
  // When the plan starts in the night: what is left of it, `D - x` (SPEC.md section 17), and the schedule is the
  // regular day from the wake-up that ends it, which is `firstNightSeconds` into the plan. 0 otherwise.
  firstNightSeconds: number;
  nights: number;
  // Waking windows the horizon touches, a partial trailing one included: `ceil(H / D)`.
  windows: number;
  tailSeconds: number;
}

// `wakingCapacity` and `nightsPerSlot` are the problem's `timeCapacityPerSlot` and `nightsPerSlot`, which the
// caller derives from the same horizon. Each is also capped by what the horizon itself has room for, so a
// caller whose three fields disagree gets a schedule no larger than any of them says, and the layout never
// places a launch past what the horizon allows. With a wake offset the slot is the regular day's from its
// wake-up: the busy block's seconds join the waking capacity, and its horizon is the plan's plus the offset.
export function daySchedule(sleep: SleepWindow, wakingCapacity: number, nightsPerSlot: number): DaySchedule {
  const wakingSeconds = DAY_SECONDS - sleep.sleepSeconds;
  const wake = sleep.wakeOffsetSeconds ?? 0;
  // In the night at the start, the schedule starts at the next wake-up, with no busy block.
  const firstNightSeconds = wake > wakingSeconds ? DAY_SECONDS - wake : 0;
  const offset = firstNightSeconds > 0 ? 0 : wake;
  const horizonSeconds =
    firstNightSeconds > 0 ? Math.max(0, sleep.horizonSeconds - firstNightSeconds) : sleep.horizonSeconds + offset;
  const nights = Math.max(0, Math.min(nightsPerSlot, Math.floor(horizonSeconds / DAY_SECONDS)));
  const tail = Math.min(
    wakingCapacity + offset - nights * wakingSeconds,
    horizonSeconds - nights * DAY_SECONDS,
    wakingSeconds
  );
  return {
    sleepSeconds: sleep.sleepSeconds,
    wakingSeconds,
    horizonSeconds,
    planHorizonSeconds: sleep.horizonSeconds,
    wakeOffsetSeconds: offset,
    firstNightSeconds,
    nights,
    windows: Math.ceil(horizonSeconds / DAY_SECONDS),
    tailSeconds: Math.max(0, tail),
  };
}

// The largest `q` a fit row is written for. A class that fits more often than this per window still gets a
// row, at `q = FIT_Q_CAP`: `u^(q)` is a valid inequality for every `q`, it is only weaker for a small one.
export const FIT_Q_CAP = 96;

// Within this of a whole number, `(q + 1) * x` is read as one: `x` is a float quotient, and a launch exactly
// `W / (q + 1)` long must take the branch that is exact there rather than the step just below it.
export const FIT_INTEGER_TOL = 1e-9;

// The `q` values the fit rows are written for: one per distinct `floor(W / seconds)` among daytime classes
// with a duration, capped at `FIT_Q_CAP`, ascending. A class that does not fit a window at all gives 0 and
// no row.
export function fitQs(
  classSeconds: readonly number[],
  classNights: readonly number[],
  wakingSeconds: number
): number[] {
  const qs = new Set<number>();
  for (let c = 0; c < classSeconds.length; c++) {
    if (classNights[c] !== 0 || !(classSeconds[c] > 0)) continue;
    const q = Math.min(Math.floor(wakingSeconds / classSeconds[c] + FIT_INTEGER_TOL), FIT_Q_CAP);
    if (q >= 1) qs.add(q);
  }
  return [...qs].sort((a, b) => a - b);
}

// A class's coefficient in fit row `q`. Daytime: Fekete and Schepers' dual feasible function `u^(q)` of
// `x = seconds / W`, which is `x` where `(q + 1) * x` is whole and `floor((q + 1) * x) / q` elsewhere, so the
// launches flown inside any one waking window sum to at most 1. Overnight over `m` nights: `m - 1`, the
// waking windows it flies straight through, which no daytime launch can use. A zero-second daytime launch
// takes no room and costs 0.
export function fitCoefficient(seconds: number, nights: number, wakingSeconds: number, q: number): number {
  if (nights > 0) return nights - 1;
  if (!(seconds > 0)) return 0;
  const x = seconds / wakingSeconds;
  const y = (q + 1) * x;
  return Math.abs(y - Math.round(y)) <= FIT_INTEGER_TOL ? x : Math.floor(y) / q;
}

// The latest moment at or before `t` (seconds from wake-up on day 0) at which the player is awake: `t` itself
// when it falls in a waking window, the bedtime before it when it falls in a night. Every launch happens while
// awake, so a launch at or before `t` is at or before this. See SPEC.md section 13.
export function lastWakingInstant(t: number, wakingSeconds: number): number {
  const day = Math.floor(t / DAY_SECONDS);
  return day * DAY_SECONDS + Math.min(t - day * DAY_SECONDS, wakingSeconds);
}

// The waking seconds in `[0, t]`: each whole day's waking window, and as much of the last one as `t` reaches.
export function wakingSecondsBefore(t: number, wakingSeconds: number): number {
  const day = Math.floor(t / DAY_SECONDS);
  return day * wakingSeconds + Math.min(t - day * DAY_SECONDS, wakingSeconds);
}

// The 2x window as the window rows read it under a sleep window (SPEC.md section 14): `latest`, the last waking
// instant at or before its end; the `nights` that fall wholly before that instant; the waking seconds before it,
// `waking`, which is `latest - nights * S`; and `partial`, the part of the waking window `latest` falls in that
// lies before it (a whole waking window when the window closes in a night). On the regular day from the wake-up at
// or before the plan's start (SPEC.md section 17): the window closes at `eventWindowSeconds + wakeOffset`, and the
// waking seconds are the plan's, after the busy block; `partial` still counts the busy block when the window closes
// on the first day, which is how the window's fit rows read it. With no offset every figure is the plan's own.
export interface WindowShape {
  latest: number;
  nights: number;
  waking: number;
  partial: number;
}

export function windowShape(eventWindowSeconds: number, wakingSeconds: number, wakeOffset = 0): WindowShape {
  const latest = lastWakingInstant(eventWindowSeconds + wakeOffset, wakingSeconds);
  const nights = Math.floor(latest / DAY_SECONDS);
  return {
    latest,
    nights,
    waking: wakingSecondsBefore(latest, wakingSeconds) - wakeOffset,
    partial: latest - nights * DAY_SECONDS,
  };
}

// The fewest waking seconds a block of `block` seconds can hold when it starts awake at or after `earliest` and at
// or before `latest`: what a doubled launch, which must go up inside the window, takes out of its slot's waking
// seconds at the least (SPEC.md section 14). `earliest` is the plan's start on the regular day, its wake offset
// (section 17). The waking seconds of `[t, t + block]` are piecewise linear in `t`, so the least is at a start the
// window allows that is also a wake-up, a bedtime, `latest`, `earliest`, or a start that puts the block's end on a
// wake-up or a bedtime.
export function leastWakingIn(block: number, latest: number, wakingSeconds: number, earliest = 0): number {
  const D = DAY_SECONDS;
  const held = (t: number) => wakingSecondsBefore(t + block, wakingSeconds) - wakingSecondsBefore(t, wakingSeconds);
  const starts = [earliest, latest];
  for (let day = 0; day * D <= latest; day++) starts.push(day * D, day * D + wakingSeconds);
  for (let day = Math.max(0, Math.floor(block / D) - 1); day * D <= latest + block; day++) {
    starts.push(day * D - block, day * D + wakingSeconds - block);
  }
  let least = Infinity;
  for (const raw of starts) {
    // Read to a microsecond, so a start float arithmetic puts a hair outside the window or past bedtime still
    // counts; held there, it differs from the exact start's by as little.
    if (!(raw >= earliest - WINDOW_TOL && raw <= latest + WINDOW_TOL)) continue;
    const t = Math.min(Math.max(raw, earliest), latest);
    if (t - Math.floor(t / D) * D > wakingSeconds + WINDOW_TOL) continue;
    least = Math.min(least, held(t));
  }
  return least;
}

// Slack on `leastWakingIn`'s starts, and what a doubled launch's charge is rounded down by so that it never
// exceeds the least exactly (SPEC.md section 14): a microsecond, the verifier's own tolerance.
export const WINDOW_TOL = 1e-6;
