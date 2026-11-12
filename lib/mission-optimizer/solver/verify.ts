// The calendar verifier: checks one slot's timeline against the sleep rule directly. It reads launch times and
// block lengths and nothing else, and knows nothing of how the layout chose them, so a layout bug cannot agree
// with itself here. The arena keeps its own copy (`tests/arena/calendar.ts`). See SPEC.md section 10.

import { DAY_SECONDS, type SleepWindow } from './types';

// Slack on every comparison, in seconds. Launch times are sums of a few hundred durations on a scale of up to
// a few million seconds, which drift by well under a microsecond; a microsecond is far below anything a
// player could act on, and far above that drift.
export const VERIFY_TOL_SECONDS = 1e-6;

export interface TimedLaunch {
  launchAt: number;
  wakingSeconds: number;
  nights: number;
}

// The first rule the slot breaks, or null. The rule: every launch happens while the player is awake (its time
// of day at most `W`), each launch waits for the one before it to finish its block (`wakingSeconds + nights *
// S`, which covers the flight and the effort floor alike), and the last block ends inside the horizon.
export function slotFault(launches: readonly TimedLaunch[], sleep: SleepWindow): string | null {
  const waking = DAY_SECONDS - sleep.sleepSeconds;
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
    const day = Math.floor((launchAt + VERIFY_TOL_SECONDS) / DAY_SECONDS);
    const timeOfDay = launchAt - day * DAY_SECONDS;
    if (timeOfDay > waking + VERIFY_TOL_SECONDS) {
      return `launch ${i} at ${launchAt}s is ${timeOfDay}s into day ${day}, after bedtime at ${waking}s`;
    }
    free = launchAt + wakingSeconds + nights * sleep.sleepSeconds;
  }
  if (free > sleep.horizonSeconds + VERIFY_TOL_SECONDS) {
    return `the last block ends at ${free}s, past the ${sleep.horizonSeconds}s horizon`;
  }
  return null;
}
