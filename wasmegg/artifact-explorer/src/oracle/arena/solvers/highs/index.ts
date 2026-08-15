// highs: the shipped planner, entered into the arena as a candidate. A shim and nothing else — the solver
// it wraps lives in `src/lib/solver/` because it is production code. See `src/lib/solver/SPEC.md` for the
// method. This is the only file under `solvers/` allowed to import `src/lib/solver/*`; the wasm module is
// awaited at import time because `Planner` is synchronous.

import { loadHighs } from '@/lib/solver/highs';
import { DEFAULT_TUNING, solveWith } from '@/lib/solver/oa';
import type { ArenaSolver, PlanProblem, PlanResult } from '../../contract';

const solve = await loadHighs();

export const highs: ArenaSolver = {
  id: 'highs',
  description: 'MILP over slots and crafts, outer-approximated objective, solved by HiGHS (WebAssembly)',
  plan: (problem: PlanProblem): PlanResult => solveWith(problem, solve, DEFAULT_TUNING, { report: true }),
};
