// The app's sleep model: a day is a waking window followed by a sleep window, the plan starts some time after a
// wake-up (at it, by default), and sleep forbids launching and nothing else. `optimizeFull` uses it to turn a wall-clock horizon and a menu
// into the sleep-aware problem `solver/SPEC.md` sections 9 and 10 describe.
//
// Deliberately not shared with the arena, which keeps its own copy of the same rule
// (`tests/arena/sleep.ts`) so that the planner's menu is judged by something other than itself;
// `tests/unit/sleep.spec.ts` holds the two to the same answers. Kept free of the loot dataset so the worker
// bundle can import it.

import { DAY_SECONDS } from './solver/types';

// The longest sleep window the app will plan around. The solver takes anything under a day; past this the
// waking window is too short for a day of launches to mean much.
export const MAX_SLEEP_SECONDS = 16 * 3600;

// A sleep setting as the solver may be handed it: 0 for anything that is not a usable window (absent,
// non-finite, non-positive), and never more than `MAX_SLEEP_SECONDS`.
export function sleepSecondsOf(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, MAX_SLEEP_SECONDS);
}

// A wake offset as the solver may be handed it, for a player who sleeps `sleep` seconds a day: the seconds since
// they last woke up, at the plan's start. 0 for anything that is not a usable offset (absent, non-finite,
// non-positive, a day or more, which no regular schedule has) and with no sleep window, where there is no wake-up
// to count from. Up to the waking window the player is awake at the start; past it they are up only to launch,
// and asleep until the next wake-up (`solver/SPEC.md` section 17).
export function wakeOffsetSecondsOf(value: number | undefined, sleep: number): number {
  if (!(sleep > 0) || value === undefined || !Number.isFinite(value) || value <= 0 || value >= DAY_SECONDS) return 0;
  return value;
}

// The seconds left of the night the plan starts in, when it starts in one: `D - x` for an offset past the waking
// window, 0 otherwise.
export function firstNightSecondsOf(sleep: number, wakeOffset: number): number {
  return sleep > 0 && wakeOffset > DAY_SECONDS - sleep && wakeOffset < DAY_SECONDS ? DAY_SECONDS - wakeOffset : 0;
}

// What one slot of horizon `horizon` offers once the player sleeps `sleep` seconds a day: `nights` whole
// sleep windows, and the waking seconds around them. A trailing partial night is unused, and a trailing
// partial day contributes at most one waking window. A plan starting `wakeOffset` seconds after a wake-up runs
// from there on the player's regular day. Awake at the start (an offset up to the waking window): the first waking
// window has that much less left, and the nights fall where the regular day puts them. In the night: nothing but
// the launches at T+0 until the next wake-up, `D - wakeOffset` in, and from there a plan starting at wake-up; the
// night the plan starts in is not one of `nights`, and only a launch at T+0 flies through it (`startVariants`,
// `solver/SPEC.md` section 17).
export interface SleepCapacity {
  wakingSecondsPerSlot: number;
  nightsPerSlot: number;
}

export function sleepCapacity(horizon: number, sleep: number, wakeOffset = 0): SleepCapacity {
  const waking = DAY_SECONDS - sleep;
  const firstNight = firstNightSecondsOf(sleep, wakeOffset);
  const busy = firstNight > 0 ? 0 : wakeOffset;
  const h = Math.max(0, (Number.isFinite(horizon) && horizon > 0 ? horizon : 0) - firstNight) + busy;
  const days = Math.floor(h / DAY_SECONDS);
  return {
    wakingSecondsPerSlot: days * waking + Math.min(h - days * DAY_SECONDS, waking) - busy,
    nightsPerSlot: days,
  };
}

// The fields a variant is built from; generic so display-only fields ride along untouched.
export interface SleepVariantSource {
  id: string;
  // Already `max(rawTime, launch period)`: the effort floor applies to every variant, overnight ones included.
  actualTime: number;
  nights?: number;
}

// Every way each option can sit against the sleep windows. With charge `d`, waking window `W` and day `D`:
// - a daytime variant: `d` waking seconds and no night, when `d <= W` (usually flown inside one waking window, but
//   one that goes up before bedtime may land in the night: its block is still `d`);
// - an overnight variant for each number of nights `m` it can span, `max(1, ceil((d - W) / D))` to
//   `floor(d / D) + 1`: `max(d - m * sleep, (m - 1) * W)` waking seconds and `m` nights.
// A zero-second overnight variant is ordinary (a short ship launched at bedtime) and still costs its night.
// Overnight ids get a `~night<m>` suffix so every variant stays addressable; the daytime variant keeps the
// option's own id. With no sleep (`sleep` 0, or anything that is not positive) this returns `options` itself,
// untouched: no variant, no `nights` field, today's menu exactly, as the arena's copy and `capacityVariants` do.
// Splitting a menu against a zero-length night would instead offer every option a phantom overnight twin.
export function sleepVariants<T extends SleepVariantSource>(options: readonly T[], sleep: number): readonly T[] {
  if (!(sleep > 0)) return options;
  const waking = DAY_SECONDS - sleep;
  const variants: T[] = [];
  for (const option of options) {
    const d = option.actualTime;
    if (d <= waking) variants.push({ ...option, nights: 0 });
    const fewest = Math.max(1, Math.ceil((d - waking) / DAY_SECONDS));
    const most = Math.floor(d / DAY_SECONDS) + 1;
    for (let m = fewest; m <= most; m++) {
      variants.push({
        ...option,
        id: `${option.id}~night${m}`,
        actualTime: Math.max(d - m * sleep, (m - 1) * waking),
        nights: m,
      });
    }
  }
  return variants;
}

// The fields a T+0 variant is built from.
export interface StartVariantSource extends SleepVariantSource {
  atStartSeconds?: number;
}

// With the plan starting in the night (`firstNightSecondsOf` > 0, `F` of it left), each option once more as a launch
// at T+0, the one instant before the next wake-up the player is up to launch. With charge `d` it holds its slot to its
// landing, `d` from T+0, which has to be inside the horizon `horizon`, and `atStartSeconds` is `d`. What it takes from
// the slot after the first wake-up is everything before the first waking instant at or after its landing, `R`, on
// the regular day from that wake-up: the waking seconds before `R`, `actualTime`, and the whole nights before it that
// the slot's budget counts, `nights` (a night the horizon cuts is not in the budget, `sleepCapacity`). Back before
// the wake-up, it takes nothing. One variant per option, not one per night count: a launch whose start is fixed takes
// exactly this, and a variant charging less would over-promise and one charging more would under-promise. The id gets
// a `~start` suffix. None without such a night.
export function startVariants<T extends StartVariantSource>(
  options: readonly T[],
  sleep: number,
  wakeOffset: number,
  horizon: number
): (T & { nights: number; atStartSeconds: number })[] {
  const firstNight = firstNightSecondsOf(sleep, wakeOffset);
  if (!(firstNight > 0)) return [];
  const waking = DAY_SECONDS - sleep;
  const after = Math.max(0, horizon - firstNight);
  // Waking seconds before `t` on the regular day from the first wake-up.
  const wakingBefore = (t: number) => {
    const day = Math.floor(t / DAY_SECONDS);
    return day * waking + Math.min(t - day * DAY_SECONDS, waking);
  };
  return options.flatMap(option => {
    const d = option.actualTime;
    if (!(d <= horizon)) return [];
    const landing = Math.max(0, d - firstNight);
    const day = Math.floor(landing / DAY_SECONDS);
    const free = landing - day * DAY_SECONDS <= waking ? landing : (day + 1) * DAY_SECONDS;
    const until = Math.min(free, after);
    return [
      {
        ...option,
        id: `${option.id}~start`,
        actualTime: wakingBefore(until),
        nights: Math.floor(until / DAY_SECONDS),
        atStartSeconds: d,
      },
    ];
  });
}
