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
than `ORACLE_GAP_TOL`. Any gap is re-priced through the solver's own value
function as a second opinion, and the failure line says whether that confirmed
the gap or suggests the oracle's own model has diverged. A float simplex ranks
candidates; an exact BigInt-rational simplex (`rational.ts`) produces the
asserted numbers, so the assertion never turns on floating-point drift.

Feasibility and honesty are **not** checked here — they are the arena's C1 and
C2/C3, which the sweep runs against every solver rather than only the shipped
one. The remaining failure kinds are `reconstruction` (the plan could not be
mapped back onto an allocation) and `harness`.

Calibration probes with closed-form answers run first; if those fail, the fuzz
results are void.

## The joint evaluator

`evaluate.ts` solves the true objective directly — no LP relaxation, no tangent
lines — so it can catch bugs in the solver's tangent approximation instead of
repeating its logic. The method is **away-step Frank-Wolfe** over the craft
polytope. Away steps rather than plain Frank-Wolfe because plain FW converges at
`O(1/k)` and zig-zags badly when the optimum lies in the interior of a polytope
face, which happens whenever one target is another's ingredient; retreating from
the worst active vertex restores effectively linear convergence. The iteration is
seeded at the centroid of the per-target max-craft vertices rather than at an LP
vertex, because a vertex seed leaves `n-1` targets at zero crafts where
`g(0) = -Infinity` pins the line search.

## Running it

```sh
pnpm test          # calibration + smoke tier only (~seconds)
pnpm test:oracle   # + deep campaign, 25 minutes by default
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `ORACLE_TIME_BUDGET_MS` | 25 min | wall-clock budget of the deep campaign |
| `ORACLE_GAP_TOL` | `1e-3` | max tolerated optimality gap, in absolute probability |
| `ORACLE_SEED_BASE` | `1000` | first seed; change to explore fresh instances |
| `ORACLE_REPRO` | — | `<family>:<seed>`, the fallback when no argv is given to `pnpm repro` |

The always-on smoke tier asserts only a catastrophic-gap guard (0.05); the deep
campaign asserts the strict tolerance. Every failure line carries the family and
seed for exact reproduction: `pnpm repro <family>:<seed>`.

Instance families: `random-single`, `random-multi` (two targets competing for
shared ingredients), `cheap-filler` (a budget remainder only a cheap mission can
use), `near-tie` (closest fuel costs), `chunky-knapsack` (expensive missions under
a tight budget), `edge` (zero/degenerate budgets, direct legendary drops,
time-bound plans).
