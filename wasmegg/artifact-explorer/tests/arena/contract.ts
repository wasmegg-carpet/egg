// The one seam the invariant harness solves through: a candidate sees `PlanProblem` and returns
// `PlanResult`, and the harness never reads its internals or trusts a number it reports. See ARENA.md.

export type { PlanProblem, PlanReport, PlanResult } from 'lib/mission-optimizer/solver/types';

import type { PlanProblem, PlanResult } from 'lib/mission-optimizer/solver/types';

// Every plan is packed into this many concurrent mission slots, each holding `timeCapacityPerSlot` seconds of
// flight (waking seconds, and `nightsPerSlot` sleep windows besides, when the problem has a sleep window).
// It is a property of the game, not of any solver, so it is stated here.
export const NUM_SLOTS = 3;

export type Planner = (problem: PlanProblem) => PlanResult;

export interface ArenaSolver {
  // Stable id used on the command line and in result files.
  id: string;
  // One line for the scorecard.
  description: string;
  plan: Planner;
  // Whether `plan` honours `PlanProblem.nightsPerSlot` and `LaunchOption.nights`. Absent or false, the
  // harness never hands this candidate a problem with a sleep window: instances with one, and A10-sleep,
  // are reported as skipped for it rather than solved, failed or passed.
  sleepAware?: boolean;
  // Whether `plan` honours `PlanProblem.eventWindowSeconds` and `LaunchOption.variant`, and returns a `calendar`
  // for a problem with a window. Absent or false, instances with a window, and A11-window, are skipped for it.
  windowAware?: boolean;
  // Whether it does so on a problem that also has a sleep window. Absent or false, an instance with both, and
  // A10-sleep or A11-window on an instance with the other, are skipped for it.
  windowWithSleepAware?: boolean;
  // Whether `plan` honours `PlanProblem.fuelingRate`, the one fueling pad every launch queues for, and returns a
  // `calendar` whose times keep it. Absent or false, instances with a pad are skipped for it.
  padAware?: boolean;
}

// What a candidate declares it can be handed; the skips above are decided from this alone.
export type Capabilities = Pick<ArenaSolver, 'sleepAware' | 'windowAware' | 'windowWithSleepAware' | 'padAware'>;

// Why an instance with this sleep and window is not handed to a candidate with these capabilities, or undefined
// when it is.
export function unsupported(
  can: Capabilities,
  inst: { sleepSeconds: number; eventWindowSeconds: number; fuelingRate?: number }
): string | undefined {
  const sleep = inst.sleepSeconds > 0;
  const window = inst.eventWindowSeconds > 0;
  if (inst.fuelingRate !== undefined && !can.padAware) return 'fueling pad on, candidate not pad-aware';
  if (sleep && !can.sleepAware) return 'sleep window on, candidate not sleep-aware';
  if (window && !can.windowAware) return '2x window on, candidate not window-aware';
  if (sleep && window && !can.windowWithSleepAware)
    return 'sleep and 2x window both on, candidate supports one at a time';
  return undefined;
}
