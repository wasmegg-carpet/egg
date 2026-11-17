// The app's sleep model: a day is a waking window followed by a sleep window, the plan starts at wake-up, and
// sleep forbids launching and nothing else. `optimizeFull` uses it to turn a wall-clock horizon and a menu
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

// What one slot of horizon `horizon` offers once the player sleeps `sleep` seconds a day: `nights` whole
// sleep windows, and the waking seconds around them. A trailing partial night is unused, and a trailing
// partial day contributes at most one waking window.
export interface SleepCapacity {
  wakingSecondsPerSlot: number;
  nightsPerSlot: number;
}

export function sleepCapacity(horizon: number, sleep: number): SleepCapacity {
  const waking = DAY_SECONDS - sleep;
  const h = Number.isFinite(horizon) && horizon > 0 ? horizon : 0;
  const days = Math.floor(h / DAY_SECONDS);
  return { wakingSecondsPerSlot: days * waking + Math.min(h - days * DAY_SECONDS, waking), nightsPerSlot: days };
}

// The fields a variant is built from; generic so display-only fields ride along untouched.
export interface SleepVariantSource {
  id: string;
  // Already `max(rawTime, launch period)`: the effort floor applies to every variant, overnight ones included.
  actualTime: number;
  nights?: number;
}

// Every way each option can sit against the sleep windows. With charge `d`, waking window `W` and day `D`:
// - a daytime variant, flown inside one waking window: `d` waking seconds and no night, when `d <= W`;
// - an overnight variant for each number of nights `m` it can span, `max(1, ceil((d - W) / D))` to
//   `floor(d / D) + 1`: `max(d - m * sleep, (m - 1) * W)` waking seconds and `m` nights.
// A zero-second overnight variant is ordinary (a short ship launched at bedtime) and still costs its night.
// Overnight ids get a `~night<m>` suffix so every variant stays addressable; the daytime variant keeps the
// option's own id.
export function sleepVariants<T extends SleepVariantSource>(options: readonly T[], sleep: number): T[] {
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
