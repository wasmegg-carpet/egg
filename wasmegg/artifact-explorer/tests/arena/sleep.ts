// The arena's sleep model: a day is a waking window `W` followed by a sleep window `S`, the plan starts `x` seconds
// after a wake-up (0 by default), and sleep forbids launching and nothing else. Owned by the harness and never shared with
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

// With a wake offset `x` the slot is `[x, x + H]` on the player's regular day, whose wake-ups are at `k * D`: the
// waking seconds are those of `[0, x + H]` less the `x` already spent awake before the plan, and the whole nights
// are those that end by `x + H` (none can start before `x`, which is at most `W`).
export function sleepCapacity(horizon: number, sleep: number, wake = 0): SleepCapacity {
  const waking = DAY_SECONDS - sleep;
  const h = Number.isFinite(horizon) && horizon > 0 ? horizon : 0;
  const end = wake + h;
  const n = Math.floor(end / DAY_SECONDS);
  const rho = end - n * DAY_SECONDS;
  return { wakingSecondsPerSlot: n * waking + Math.min(rho, waking) - wake, nightsPerSlot: n };
}

// The wake offset an instance is stated with: seconds since the player last woke up, at the plan's start. 0 with
// no sleep, where there is no day to be into. Only the awake case is stated so far: an offset past the waking
// window (the player is up in the night at the plan's start) is read as bedtime, `W`, the same placeholder the
// planner's boundary applies, until the night case is modelled on both sides.
export function wakeOffsetOf(wake: number, sleep: number): number {
  if (!(sleep > 0) || !(wake > 0)) return 0;
  if (!Number.isFinite(wake) || wake >= DAY_SECONDS) {
    throw new Error(`wake offset must be in [0, ${DAY_SECONDS}) seconds, got ${wake}`);
  }
  return Math.min(wake, DAY_SECONDS - sleep);
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
