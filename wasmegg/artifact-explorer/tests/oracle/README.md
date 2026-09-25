# Brute-force oracle for the artifact optimizer

An independent correctness harness for `optimizeFull`, whose design is in
[`../../src/lib/OPTIMIZER.md`](../../src/lib/OPTIMIZER.md). The solver is treated as a black
box: nothing here imports its internals, and the three-slot packing feasibility
check is re-derived rather than shared, so the grader and the graded are never
the same code.

Instances are built from real game data — production recipe DAGs, launch options,
and crafting-level legendary probabilities; the generator only chooses the
target(s), the mission subset, the budgets, and the owned inventory. Because they
derive from live loot data, **findings should be reproduced against the loot
snapshot they were found on.**

What this harness asserts is **optimality**: no feasible allocation, found by
exhaustive enumeration of maximal integer allocations, beats the plan by more
than `ORACLE_GAP_TOL`. Enumerating only maximal ones is exact because the objective
is monotone and the feasible region downward-closed. Any gap is re-priced as a
second opinion by handing `optimizeFull` a one-option instance whose single launch
reproduces the winning allocation's drops, and the failure line says whether that
confirmed the gap or suggests the oracle's own model has diverged. A float simplex
ranks candidates during enumeration, for every instance. What backs the asserted
number afterward depends on target count: single-target instances re-price the
winner with an exact BigInt-rational simplex (`rational.ts`), so that assertion
never turns on floating-point drift; multi-target instances have no exact stage
and are asserted from the same float away-step Frank-Wolfe used for ranking,
correct only to `ORACLE_GAP_TOL` (see "The joint evaluator" below).

Feasibility and honesty are **not** checked here — they are the arena's C1 and
C2/C3, which the sweep runs against every solver rather than only the shipped
one. Besides `optimality` the failure kinds are `reconstruction` (the plan could
not be mapped back onto an allocation), `oracle` (the plan _beat_ the exhaustive
best by more than the float ranking slop, which indicts this harness rather than
the solver) and `harness`.

Calibration probes with closed-form answers run first; if those fail, the fuzz
results are void.

## The joint evaluator

`evaluate.ts` solves the true objective directly — no linearized stand-in, no tangent
lines — so it can catch bugs in the solver's tangent approximation instead of
repeating its logic. For a single target this reduces to one LP, solved exactly
(see above). For two or more targets it is an independent implementation of the
same away-step Frank-Wolfe method as `src/lib/solver/evaluator.ts`; see
`src/lib/solver/SPEC.md`'s introduction for the general background. The two
implementations are written separately and neither imports the other, so their
agreement is itself a check; but the joint case is float, correct only to the
tolerances above, not exact the way the single-target LP is.

Two choices are specific to this harness rather than the method in general: the
iteration is seeded at the centroid of the per-target max-craft vertices, because
a single-vertex seed leaves `n-1` targets at zero crafts where `g(0) = -Infinity`
pins the line search; and away steps are used (not plain Frank-Wolfe) because one
target being another's ingredient can put the optimum on a polytope face, where
plain Frank-Wolfe zig-zags instead of converging.

## Running it

```sh
pnpm test          # calibration + smoke tier only (~seconds)
pnpm test:oracle   # + deep campaign, 25 minutes by default
```

| Variable                | Default | Meaning                                                                                                                             |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ORACLE_TIME_BUDGET_MS` | 25 min  | wall-clock budget of the deep campaign                                                                                              |
| `ORACLE_GAP_TOL`        | `1e-3`  | max tolerated optimality gap, in absolute probability                                                                               |
| `ORACLE_SEED_BASE`      | `1000`  | the deep campaign's first seed; change to explore fresh instances. The smoke tier is pinned to seeds 1-3 per family and ignores it. |
| `ORACLE_REPRO`          | —       | `<family>:<seed>`, the fallback when no argv is given to `pnpm repro`                                                               |

The always-on smoke tier asserts only a catastrophic-gap guard (0.05); the deep
campaign asserts the strict tolerance. Every failure line carries the family and
seed for exact reproduction: `pnpm repro <family>:<seed>`.

Instance families: `random-single`, `random-multi` (two targets competing for
shared ingredients), `cheap-filler` (a budget remainder only a cheap mission can
use), `near-tie` (closest fuel costs), `chunky-knapsack` (expensive missions under
a tight budget), `edge` (zero/degenerate budgets, direct legendary drops,
time-bound plans).
