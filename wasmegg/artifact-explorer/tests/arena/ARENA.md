# The solver arena

A fixed set of correctness invariants, a fixed judge, and a one-function seam
where you plug in a mission planner. The point is to let several very different
optimisation methodologies be tried against the same bar without any of them
being able to move the bar.

To write a candidate you need the contract (`contract.ts`), the objective
(`src/lib/OPTIMIZER.md`), and the rules below. You do not need to read the
harness, and you must not import it.

## The problem

Pick how many of each available mission to launch, so as to maximise the
probability of getting a legendary of **every** target artifact.

| field | meaning |
| --- | --- |
| `options` | the menu of launches, already enumerated from the player's ships, research and effort level. Your allocation is indexed against this array, in this order. |
| `dag` | the recipe graph for the targets: what crafts into what, how many of each ingredient a craft consumes, and each node's legendary craft chance. |
| `targets` | the desired artifact node ids. |
| `fuelCapacity` | total fuel for the whole plan. |
| `timeCapacityPerSlot` | seconds available **per slot**. |
| `slots` | how many missions can be in flight at once. Always 3. |
| `baseYield` | copies of each node the player already owns. |

You return an `allocation` parallel to `problem.options`, plus an optional
`reported` (see below).

The objective is the **product** over targets of `1 - exp(-s_T)`, not the sum and
not the max. ALL-of rather than ANY-of deliberately: maximising ANY collapses
onto whichever target is cheapest. `tests/oracle/evaluate.ts` is the harness's
independent implementation and is what scores you. It re-optimises the inner
craft split for whatever allocation you hand back, so you are never penalised for
reporting a plan whose craft accounting you did not work out yourself.

### Feasibility

- **Fuel.** `sum_i allocation[i] * options[i].actualFuel <= fuelCapacity`.
- **Packing.** The missions partition into `slots` groups, each with summed
  `actualTime` at most `timeCapacityPerSlot`. This is a genuine 3-way bin
  packing, not a check that the total fits in `3 * timeCapacityPerSlot` — a plan
  can pass the volume bound and still be infeasible.

The harness decides this with its own packer (`pack-feasibility.ts`), which
imports nothing and which no candidate may import. Returning an infeasible plan
is a hard failure, not a low score.

**The golden egg budget is not part of this.** Missions cost no golden eggs, so
no allocation can breach `craftBudget` and there is nothing here for a
feasibility check to test. It binds on the craft split, which the judge chooses
for itself, so the judge solves its craft polytope with the row in it and a
candidate that ignored the cap simply scores worse. That is why the budget
appears under **A9** and has no C1 twin. Generated instances carry no budget; A9
introduces one as a perturbation, the way the other A checks perturb fuel and
time, so every recorded sweep result still measures the problems it always did.

Prices are the harness's own, derived from the game's price curve in `harness.ts`
rather than shared with `optimizer-cost.ts`: a pricing helper used by both the
planner and its judge would agree with itself no matter what it computed.

## Rules

- **Do not import the harness.** Not `evaluate.ts`, `pack-feasibility.ts`,
  `invariants.ts`, `harness.ts`, `instances.ts` or `scorecard.ts`.
  `independence.spec.ts` enforces this. Deriving your own copy of the objective
  or of a packing routine is fine and expected — sharing the harness's is not,
  because then the grader and the candidate are the same code.
- **Re-derive everything: no value import from `src/lib` or `tests/unit`.**
  `import type` is fine and is how you read the problem at all; the bare `lib`
  workspace package (egg, ship and artifact enums and tables) is game data rather
  than solver code and stays available. Calling into the incumbent's LP, tangent
  grid, packer or search would measure the incumbent's method wearing a different
  hat. `tests/unit` is barred for the same reason and not as tidiness:
  `spec-helpers.ts` there calls `optimizeFull`, so it is a second door onto the
  planner.

  There is one exception, encoded by name in `independence.spec.ts`:
  `solvers/highs/index.ts` is a shim around `src/lib/solver/`, the planner the
  app itself runs, so that one file may import `src/lib/solver/` and nothing else
  out of `src/lib`. It buys nothing else — it still may not touch the judge, the
  feasibility rule or the checks. Note the direction that leaves: production
  calls the same `solveWith` on the same loaded module the shim does, so the
  shipped planner and the measured one are one code path. A candidate importing
  `src/lib` would close that loop the other way and measure the app grading
  itself.
- **Be deterministic.** Same problem in, same allocation out. If your method is
  stochastic, seed it from the problem, not from a clock or a global. You do not
  need to memoize: the harness caches plans by problem content.
- **Do not read the seed, the instance label, or anything outside `PlanProblem`**,
  and do not mutate `problem` — it is shared across the checks in a sweep.

### Self-reporting

`reported` is optional and nothing in it is ever used as your score. Supplying it
opts you into **C2-honesty** (your `jointProbability` must match what the judge
computes for your own allocation — failing it means your search is steering by a
number that is not the objective) and **C3-joint-product** (your `perTarget`
factors must multiply to your `jointProbability`).

## What gets measured

**Correctness**, as invariant violations. Every invariant is a property that
holds without knowing the optimum, so none needs a reference answer:

| group | asserts |
| --- | --- |
| **C0** contract | the returned allocation has one entry per option, and every entry is a non-negative whole number |
| **C1** feasibility | the plan fits the fuel tank and packs into the slots |
| **C2/C3** honesty | the probability you report is the one the judge computes for the allocation you returned, and your per-target factors multiply to it (opt-in) |
| **A1-A9** monotonicity | relaxing the problem cannot make your answer worse. More fuel, more time, more ships on the menu, more inventory, a higher crafting level, a shorter launch-period floor, one fewer target, a larger golden egg budget (**A9**, ending with the cap removed entirely): each is solved alongside the original, and the relaxed solve must not score below it |
| **B1-B6** invariance | restating the same problem must not move the answer at all. Shuffling the menu, reversing the target list, multiplying every fuel cost and the tank by the same constant, appending a duplicate of an option already on the menu, or simply solving twice. There is no B4 and never was; the ids are the arena's public vocabulary, so the slot stays vacant rather than renumbering. |
| **M1-M3** cross-path | the joint answer must not beat the product of the per-target optima (M1); a solo solve of one target must reach at least what the joint plan already reaches on that target (M2); and the joint answer must not lose to the union of per-target plans solved on split budgets (M3) |
| **D1/D2** local optimality | your plan cannot be improved by a small edit to itself. D1 tries every *pair* — remove up to 2 launches of one option, add up to 2 of another — and D2 tries two such pairs at once. Deep tier only. Each also reports a `-inconclusive` variant when the search spends its evaluation budget without finding an improving move: no answer rather than a pass. |

**Quality**, as the judged joint probability on the unperturbed instance,
reported in log10 and compared head-to-head. This is the only relative measure.
**Latency**, as median/p90/max of a single solve.

### Comparisons are in log space

A four-target plan on a mediocre fleet lands around `1e-13`. The tolerance is an
absolute number of **nats** on `log(joint)`, so a drop from `1e-13` to `1e-14` is
2.30 nats and reads exactly as loudly as `0.5 -> 0.05`. Probability zero is
`-Infinity`, so returning nothing where another solver returns `1e-13` is a
failure rather than a rounding artefact.

## Running it

```sh
pnpm arena                                  # smoke: 4 instances, whole roster
ARENA=sweep pnpm arena                      # 40 instances, cheap checks
ARENA=deep pnpm arena                       # + D1/D2 local optimality
SOLVER=my-solver ARENA=sweep pnpm arena     # one entry
ARENA_INSTANCES=80 ARENA_SEED_BASE=9000 ARENA=sweep pnpm arena
pnpm arena:check                            # independence guard only
```

| variable | default | meaning |
| --- | --- | --- |
| `ARENA` | `smoke` | tier; also the switch that makes the suite run at all |
| `ARENA_INSTANCES` | 4 smoke / 40 otherwise | instance count |
| `ARENA_SEED_BASE` | 2000 | first seed |
| `SOLVER` | whole roster | run one entry |
| `ARENA_GATE` | — | `all` promotes every invariant to a hard failure |

The sweep is opt-in and `pnpm test` does not run it: every tier here is minutes
at best. `vitest.config.ts` drops `invariants.spec.ts` from the selection when
`ARENA` is unset, so the default suite does not even pay to import the roster's
wasm. `arena:check` is static and fast, so the independence guard does run with
the rest of the tests. Per-solver JSON lands in `results/<solver-id>.json`, which
is gitignored — every sweep rewrites it, so re-run rather than expecting a
committed reference.

**Gating.** `C0-contract`, `C1-feasibility` and `C1-inconclusive` hard-fail: a
plan that is not a plan is broken outright, and that is not a matter of degree.
`C1-inconclusive` is the harness's own packer exhausting its node budget rather
than a verdict on the plan — it gates all the same, because that budget is sized
so it does not happen, but it is counted separately so the scorecard never reads
a judge timeout as an infeasible plan. Every other invariant is reported rather
than thrown, because what the arena measures is how far a candidate is from
holding them — a suite that aborts on the first monotonicity wobble stops
producing a scorecard and starts producing a stack trace.

**Cost.** A 40-instance cheap sweep is at least 15 minutes, heavily dependent on
solver runtime; the deep tier adds substantially more. Instances range from 63 to
285 options and from 1 to 4 targets.

## The roster

`highs` — the shipped planner, `src/lib/solver/SPEC.md`.

The arena is not a bake-off between methodologies. It is the bar a change to the
shipped planner has to clear before it lands. A proposed change may be registered
alongside it for as long as it takes to decide, since the harness already runs
every entry over the same instances against the same judge and prints the
head-to-head — A/B'ing a tuning costs one line in `registry.ts` rather than a
bespoke script. Such an entry ships or it is deleted; the roster is not where
alternatives accumulate. It is one row for that reason and not because nothing
has been tried: the shipped single-pass tuning was chosen over five registered
arms, and all five were deleted once it was.
