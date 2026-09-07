// The one seam the invariant harness solves through: a candidate sees `PlanProblem` and returns
// `PlanResult`, and the harness never reads its internals or trusts a number it reports. See ARENA.md.

export type { PlanProblem, PlanReport, PlanResult } from '@/lib/solver/types';

import type { PlanProblem, PlanResult } from '@/lib/solver/types';

// Every plan is packed into this many concurrent mission slots, each holding `timeCapacityPerSlot` seconds of
// flight. It is a property of the game, not of any solver, so it is stated here.
export const NUM_SLOTS = 3;

export type Planner = (problem: PlanProblem) => PlanResult;

export interface ArenaSolver {
  // Stable id used on the command line and in result files.
  id: string;
  // One line for the scorecard.
  description: string;
  plan: Planner;
}
