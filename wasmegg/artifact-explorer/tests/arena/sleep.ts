// The arena's sleep model: a day is a waking window `W` followed by a sleep window `S`, the plan starts `x` seconds
// after a wake-up (0 by default), and sleep forbids launching and nothing else, except at T+0 when the plan starts in
// the night. Owned by the harness and never shared with
// `lib/mission-optimizer`, for the same reason the packer is not: a variant rule used by both the planner and its judge
// would agree with itself no matter what it computed. Imports nothing. See ARENA.md, "Sleep".

export const DAY_SECONDS = 86400;

// What one slot of horizon `horizon` offers once the player sleeps `sleep` seconds a day: `nights` whole
// sleep windows, and the waking seconds around them. A trailing partial night is unused, and a trailing
// partial day contributes at most one waking window.
export interface SleepCapacity {
  wakingSecondsPerSlot: number;
  nightsPerSlot: number;
}

// With a wake offset `x` the slot is `[x, x + H]` on the player's regular day, whose wake-ups are at `k * D`. Up to
// the waking window the player is awake from `x`; past it, in the night, nothing but a launch at T+0 can use the
// time before the wake-up at `D` (`startVariants`). So the budget is the waking seconds of `[from, x + H]`, with
// `from` the first of those, and the whole nights inside it.
export function sleepCapacity(horizon: number, sleep: number, wake = 0): SleepCapacity {
  const waking = DAY_SECONDS - sleep;
  const h = Number.isFinite(horizon) && horizon > 0 ? horizon : 0;
  const end = wake + h;
  const from = wake > waking ? DAY_SECONDS : wake;
  const awakeBefore = (t: number) => {
    const n = Math.floor(t / DAY_SECONDS);
    return n * waking + Math.min(t - n * DAY_SECONDS, waking);
  };
  // Nights `[k D + W, (k + 1) D]` with `k D + W >= from`, ending by `end`.
  const firstNight = from > waking ? 1 : 0;
  const nights = Math.max(0, Math.floor(end / DAY_SECONDS) - firstNight);
  return { wakingSecondsPerSlot: Math.max(0, awakeBefore(end) - awakeBefore(from)), nightsPerSlot: nights };
}

// The wake offset an instance is stated with: seconds since the player last woke up, at the plan's start. 0 with
// no sleep, where there is no day to be into. Past the waking window the player is in the night at the start, up
// only to launch at T+0.
export function wakeOffsetOf(wake: number, sleep: number): number {
  if (!(sleep > 0) || !(wake > 0)) return 0;
  if (!Number.isFinite(wake) || wake >= DAY_SECONDS) {
    throw new Error(`wake offset must be in [0, ${DAY_SECONDS}) seconds, got ${wake}`);
  }
  return wake;
}

// The launches at T+0 of a plan that starts in the night (`wake > W`), one per option that lands inside the horizon,
// id suffixed `~start`. Sent at T+0, a launch of charge `d` lands at `x + d` on the regular day and holds its slot
// until then: `atStartSeconds` is `d`. Its slot is next usable at the first waking instant at or after that landing,
// and never before the first wake-up at `D`; call it `R`. From the budget it takes what `[D, min(R, x + H)]` holds:
// those waking seconds (`actualTime`) and those whole nights (`nights`), a night the horizon cuts being no part of
// the budget. None otherwise.
export function startVariants<T extends SleepVariantSource & { atStartSeconds?: number }>(
  options: readonly T[],
  sleep: number,
  wake: number,
  horizon: number
): (T & { nights: number; atStartSeconds: number })[] {
  const waking = DAY_SECONDS - sleep;
  if (!(sleep > 0) || !(wake > waking)) return [];
  const end = wake + horizon;
  const awakeBefore = (t: number) => {
    const n = Math.floor(t / DAY_SECONDS);
    return n * waking + Math.min(t - n * DAY_SECONDS, waking);
  };
  return options
    .filter(o => o.actualTime <= horizon)
    .map(o => {
      const landing = Math.max(DAY_SECONDS, wake + o.actualTime);
      const n = Math.floor(landing / DAY_SECONDS);
      const usable = Math.min(landing - n * DAY_SECONDS <= waking ? landing : (n + 1) * DAY_SECONDS, end);
      return {
        ...o,
        id: `${o.id}~start`,
        actualTime: Math.max(0, awakeBefore(usable) - awakeBefore(DAY_SECONDS)),
        nights: Math.max(0, Math.floor(usable / DAY_SECONDS) - 1),
        atStartSeconds: o.actualTime,
      };
    });
}

export function assertSleepSeconds(sleep: number): void {
  if (!Number.isFinite(sleep) || sleep < 0 || sleep >= DAY_SECONDS) {
    throw new Error(`sleep window must be in [0, ${DAY_SECONDS}) seconds, got ${sleep}`);
  }
}

// The fields a variant is built from. Generic so this file needs no import, not even a type one.
export interface SleepVariantSource {
  id: string;
  // Already `max(rawTime, launch period)`: the effort floor is applied before splitting, to every variant.
  actualTime: number;
  nights?: number;
}

// Splits every option into the ways it can sit against the sleep windows. With charge `d`:
// - a daytime variant, flown inside one waking window: `d` waking seconds, 0 nights, when `d <= W`;
// - an overnight variant for each `m` from `max(1, ceil((d - W) / D))` to `floor(d / D) + 1`:
//   `max(d - m*S, (m - 1)*W)` waking seconds and `m` nights.
// Zero-second overnight variants are ordinary (a short ship launched at bedtime) and still cost a night.
// `sleep = 0` returns `options` itself, untouched: no variant, no `nights` field, today's menu exactly.
export function sleepVariants<T extends SleepVariantSource>(options: readonly T[], sleep: number): readonly T[] {
  assertSleepSeconds(sleep);
  if (sleep === 0) return options;
  const waking = DAY_SECONDS - sleep;
  const out: T[] = [];
  for (const o of options) {
    const d = o.actualTime;
    if (d <= waking) out.push({ ...o, nights: 0 });
    const lo = Math.max(1, Math.ceil((d - waking) / DAY_SECONDS));
    const hi = Math.floor(d / DAY_SECONDS) + 1;
    for (let m = lo; m <= hi; m++) {
      out.push({
        ...o,
        id: `${o.id}~night${m}`,
        actualTime: Math.max(d - m * sleep, (m - 1) * waking),
        nights: m,
      });
    }
  }
  return out;
}
