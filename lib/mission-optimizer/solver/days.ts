// The day structure a sleep-aware problem is cut from, and the per-day fit rows' coefficients. See SPEC.md
// section 10.

import { DAY_SECONDS, type SleepWindow } from './types';

// One slot's horizon as the layout and the fit rows see it: `nights` sleep windows, each closing a waking
// window of `wakingSeconds`, then a trailing partial day of `tailSeconds` (0 for a whole-day horizon).
export interface DaySchedule {
  sleepSeconds: number;
  wakingSeconds: number;
  horizonSeconds: number;
  nights: number;
  // Waking windows the horizon touches, a partial trailing one included: `ceil(H / D)`.
  windows: number;
  tailSeconds: number;
}

// `wakingCapacity` and `nightsPerSlot` are the problem's `timeCapacityPerSlot` and `nightsPerSlot`, which the
// caller derives from the same horizon. Each is also capped by what the horizon itself has room for, so a
// caller whose three fields disagree gets a schedule no larger than any of them says, and the layout never
// places a launch past what the horizon allows.
export function daySchedule(sleep: SleepWindow, wakingCapacity: number, nightsPerSlot: number): DaySchedule {
  const wakingSeconds = DAY_SECONDS - sleep.sleepSeconds;
  const horizonSeconds = sleep.horizonSeconds;
  const nights = Math.max(0, Math.min(nightsPerSlot, Math.floor(horizonSeconds / DAY_SECONDS)));
  const tail = Math.min(wakingCapacity - nights * wakingSeconds, horizonSeconds - nights * DAY_SECONDS, wakingSeconds);
  return {
    sleepSeconds: sleep.sleepSeconds,
    wakingSeconds,
    horizonSeconds,
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
const FIT_INTEGER_TOL = 1e-9;

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
