// highs: the shipped planner, entered into the arena as a candidate. A shim and nothing else — the solver
// it wraps lives in `lib/mission-optimizer/solver/` because it is production code. See `lib/mission-optimizer/solver/SPEC.md` for the
// method. This is the only file under `solvers/` allowed to import `lib/mission-optimizer/solver/*`; the wasm module is
// awaited at import time because `Planner` is synchronous.

import { loadHighs } from 'lib/mission-optimizer/solver/highs';
import { DEFAULT_TUNING, solveWith } from 'lib/mission-optimizer/solver/solve';
import type { ArenaSolver, PlanProblem, PlanResult } from '../../contract';

const solve = await loadHighs();

export const highs: ArenaSolver = {
  id: 'highs',
  description: 'MILP over slots and crafts, outer-approximated objective, solved by HiGHS (WebAssembly)',
  plan: (problem: PlanProblem): PlanResult => solveWith(problem, solve, DEFAULT_TUNING, { report: true }),
  // The solver budgets `nightsPerSlot` per slot (`lib/mission-optimizer/solver/SPEC.md` section 9), so sleep-on instances
  // and A10-sleep are solved for it.
  sleepAware: true,
  // The window rows and the back-to-back calendar (sections 11 and 12), and with a sleep window the wall-clock
  // rows, doubled-first layout and demotion of section 13.
  windowAware: true,
  windowWithSleepAware: true,
  // Every calendar re-timed on the one fueling pad, and verified against it (section 18).
  padAware: true,
};
