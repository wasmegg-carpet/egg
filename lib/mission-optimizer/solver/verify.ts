// The calendar verifier: checks one slot's timeline against the sleep rule and the event window directly. It
// reads launch times, block lengths, whether a launch is doubled and whether the menu could have doubled it, and
// nothing else, and knows nothing of how the layout chose them, so a layout bug cannot agree with itself here. The
// arena keeps its own copy (`tests/arena/calendar.ts`). See SPEC.md sections 10, 12 and 16.

import type { LaunchOption } from '../types';
import { DAY_SECONDS, type SleepWindow } from './types';

// Slack on every comparison, in seconds. Launch times are sums of a few hundred durations on a scale of up to
// a few million seconds, which drift by well under a microsecond; a microsecond is far below anything a
// player could act on, and far above that drift.
export const VERIFY_TOL_SECONDS = 1e-6;

export interface TimedLaunch {
  launchAt: number;
  wakingSeconds: number;
  nights: number;
  // Absent is false.
  doubled?: boolean;
  // For a launch at T+0 in the night the plan starts in, its option's `atStartSeconds`: it may go up at T+0 only,
  // and holds its slot from there for that long, to its landing (SPEC.md section 17). Absent for every other launch.
  atStartSeconds?: number;
  // For a 1x launch, whether the menu holds the same flight as an `event` and as an `overhang` copy
  // (`doubledCopiesOnMenu`). Absent is false, which leaves a 1x launch unchecked against the window.
  eventCopy?: boolean;
  overhangCopy?: boolean;
  // Whether the launch is in the plan's start chain (`startChain`): the launches that go up back to back on the
  // fueling pad from T+0, which the player stays up for (SPEC.md section 18). Absent, the chain is read without the
  // pad, as the launches at T+0 itself, to a microsecond.
  startChain?: boolean;
}

// Per option, for a `normal` one, whether the menu also holds the same flight at 2x as an `event` and as an
// `overhang` option: the same seconds, nights and fuel (in total and per egg), and exactly twice every drop. Read off
// the numbers rather than ids, so it holds for any menu, however it was built. False for a doubled option.
export function doubledCopiesOnMenu(options: readonly LaunchOption[]): { event: boolean; overhang: boolean }[] {
  const entries = (m: ReadonlyMap<unknown, number>, f: number) =>
    [...m]
      .filter(([, q]) => q !== 0)
      .map(([k, q]) => `${String(k)}=${q * f}`)
      .sort()
      .join(',');
  const keyOf = (o: LaunchOption, f: number) =>
    [
      o.actualTime,
      o.nights ?? 0,
      o.actualFuel,
      o.atStartSeconds ?? '',
      entries(o.fuelByEgg, 1),
      entries(o.yieldVector, f),
      entries(o.legendaryYieldVector, f),
    ].join('|');
  const onMenu = { event: new Set<string>(), overhang: new Set<string>() };
  for (const o of options) if (o.variant === 'event' || o.variant === 'overhang') onMenu[o.variant].add(keyOf(o, 1));
  return options.map(o => {
    if ((o.variant ?? 'normal') !== 'normal') return { event: false, overhang: false };
    const key = keyOf(o, 2);
    return { event: onMenu.event.has(key), overhang: onMenu.overhang.has(key) };
  });
}

// The first rule the slot breaks, or null. The rule: every launch happens while the player is awake (its time
// of day at most `W`), each launch waits for the one before it to finish its block (`wakingSeconds + nights *
// S`, which covers the flight and the effort floor alike), the last block ends inside the horizon, and a launch
// is doubled if and only if it goes up inside the event window: a doubled launch at `launchAt` at most
// `eventWindowSeconds` (no window, no doubled launch), and no 1x launch inside it that the menu could have flown
// doubled. Of the launches inside, the last one could be the slot's `overhang` and the earlier ones `event`
// launches, so the last is held to its `overhang` copy and the others to their `event` copies (SPEC.md section
// 16). A 1x launch is held to this only a microsecond clear of the window's edge, where a doubled one is admitted
// a microsecond past it, so no launch at the edge has to be both. A problem without a sleep window is checked as
// one with `sleepSeconds` 0 and its slot as the horizon. Every time is the plan's own, from t = 0; the time of day
// alone is read on the player's regular day, `wakeOffsetSeconds` later, since the plan starts that long after a
// wake-up (SPEC.md section 17), and nothing may go up before t = 0. The player is up for the plan's start chain, the
// launches that go up back to back on the fueling pad from t = 0 (`startChain`; without the pad, those at t = 0
// itself): a launch in it is admitted asleep, which a plan that starts in the night (an offset past the waking
// window), or one the pad carries past bedtime, needs, and no other launch in a night is. A launch of a T+0 variant
// goes up in that chain, in the night the plan starts in, and nowhere else, and holds its slot from there to its
// landing, `atStartSeconds` later. The pad itself is the plan's rule, not one slot's (`padFault`).
export function slotFault(launches: readonly TimedLaunch[], sleep: SleepWindow, eventWindowSeconds = 0): string | null {
  const waking = DAY_SECONDS - sleep.sleepSeconds;
  const offset = sleep.wakeOffsetSeconds ?? 0;
  const firstNight = offset > waking ? DAY_SECONDS - offset : 0;
  const inside = (l: TimedLaunch) => eventWindowSeconds > 0 && l.launchAt < eventWindowSeconds - VERIFY_TOL_SECONDS;
  // The last launch that may be doubled, which is the one that could be the overhang.
  let lastInside = -1;
  launches.forEach(
    (l, i) => eventWindowSeconds > 0 && l.launchAt <= eventWindowSeconds + VERIFY_TOL_SECONDS && (lastInside = i)
  );
  let free = 0;
  for (let i = 0; i < launches.length; i++) {
    const { launchAt, wakingSeconds, nights } = launches[i];
    if (!Number.isFinite(launchAt) || !(wakingSeconds >= 0) || !Number.isInteger(nights) || nights < 0) {
      return `launch ${i} is malformed (at ${launchAt}, ${wakingSeconds}s waking, ${nights} night(s))`;
    }
    if (launchAt < free - VERIFY_TOL_SECONDS) {
      return i === 0
        ? `launch 0 at ${launchAt}s is before the plan starts`
        : `launch ${i} at ${launchAt}s overlaps the previous block, which ends at ${free}s`;
    }
    // Read so that a time a hair under midnight-plus-a-day counts as wake-up, not as the end of the night.
    const sinceWake = launchAt + offset;
    const day = Math.floor((sinceWake + VERIFY_TOL_SECONDS) / DAY_SECONDS);
    const timeOfDay = sinceWake - day * DAY_SECONDS;
    const chained = launches[i].startChain ?? Math.abs(launchAt) <= VERIFY_TOL_SECONDS;
    const atStart = firstNight > 0 && chained;
    if (timeOfDay > waking + VERIFY_TOL_SECONDS && !chained) {
      return `launch ${i} at ${launchAt}s is ${timeOfDay}s into day ${day}, after bedtime at ${waking}s`;
    }
    const startCharge = launches[i].atStartSeconds;
    if (startCharge !== undefined && !atStart) {
      return `launch ${i} at ${launchAt}s is a T+0 launch, flown ${firstNight > 0 ? 'later' : 'with no night at the start'}`;
    }
    if (launches[i].doubled) {
      if (!(eventWindowSeconds > 0)) return `launch ${i} at ${launchAt}s is doubled with no 2x window`;
      if (launchAt > eventWindowSeconds + VERIFY_TOL_SECONDS) {
        return `launch ${i} at ${launchAt}s is doubled, but the 2x window closes at ${eventWindowSeconds}s`;
      }
    } else if (inside(launches[i]) && (i === lastInside ? launches[i].overhangCopy : launches[i].eventCopy)) {
      return `launch ${i} at ${launchAt}s is flown at 1x inside the 2x window, which closes at ${eventWindowSeconds}s`;
    }
    free = launchAt + (startCharge ?? wakingSeconds + nights * sleep.sleepSeconds);
  }
  if (free > sleep.horizonSeconds + VERIFY_TOL_SECONDS) {
    return `the last block ends at ${free}s, past the ${sleep.horizonSeconds}s horizon`;
  }
  return null;
}

// One launch as the fueling pad sees it: when it goes up, and how long the pad takes to fuel it (`padSecondsOf`).
export interface PadLaunch {
  launchAt: number;
  padSeconds: number;
}

// Every launch of the plan in the order the pad serves them, which is launch order: a ship fueled on the pad goes up
// before the next one is fueled. Launches at one instant are taken longest fueling first, the one order in which the
// pad can have served them if any order can (every launch after the first at that instant must fuel in no time).
function padOrder(slots: readonly (readonly PadLaunch[])[]): { k: number; i: number; launch: PadLaunch }[] {
  return slots
    .flatMap((launches, k) => launches.map((launch, i) => ({ k, i, launch })))
    .sort(
      (a, b) =>
        a.launch.launchAt - b.launch.launchAt || b.launch.padSeconds - a.launch.padSeconds || a.k - b.k || a.i - b.i
    );
}

// Per slot, per launch, whether it is in the plan's start chain: the launches that go up back to back on the pad from
// t = 0, with the pad never idle, so that each goes up at the fuellings so far summed, `T + f1`, `T + f1 + f2`, and on.
// The player stays up for exactly that chain (SPEC.md section 18). Without the pad every fuelling takes no time and
// the chain is the launches at t = 0.
export function startChain(slots: readonly (readonly PadLaunch[])[]): boolean[][] {
  const out = slots.map(launches => launches.map(() => false));
  let chained = 0;
  for (const { k, i, launch } of padOrder(slots)) {
    chained += launch.padSeconds;
    if (Math.abs(launch.launchAt - chained) > VERIFY_TOL_SECONDS) break;
    out[k][i] = true;
  }
  return out;
}

// The first launch the fueling pad could not have fueled in time, or null. The rule: one pad for every slot, empty at
// t = 0, fuelling one ship at a time, the next one from the moment the one before it goes up; so in launch order the
// first launch goes up at least its own fuelling after t = 0, and each later one at least its own fuelling after the
// one before it (SPEC.md section 18). Every slot's own rules are `slotFault`'s.
export function padFault(slots: readonly (readonly PadLaunch[])[]): string | null {
  let previous = 0;
  for (const { k, i, launch } of padOrder(slots)) {
    const { launchAt, padSeconds } = launch;
    if (!Number.isFinite(launchAt) || !(padSeconds >= 0) || !Number.isFinite(padSeconds)) {
      return `slot ${k} launch ${i} is malformed for the pad (at ${launchAt}, ${padSeconds}s fuelling)`;
    }
    if (launchAt < previous + padSeconds - VERIFY_TOL_SECONDS) {
      return (
        `slot ${k} launch ${i} at ${launchAt}s needs ${padSeconds}s on the fueling pad, ` +
        `which is not free until the launch before it at ${previous}s`
      );
    }
    previous = launchAt;
  }
  return null;
}
