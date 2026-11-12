# The solver arena

A fixed set of correctness invariants, a fixed judge, and a one-function seam
where you plug in a mission planner. The point is to let several very different
optimisation methodologies be tried against the same bar without any of them
being able to move the bar.

To write a candidate you need the contract (`contract.ts`), the objective
(`lib/mission-optimizer/OPTIMIZER.md`), and the rules below. You do not need to read the
harness, and you must not import it.

## The problem

Pick how many of each available mission to launch, so as to maximise the
probability of getting a legendary of **every** target artifact.

| field                 | meaning                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options`             | the menu of launches, already enumerated from the player's ships, research and effort level. Your allocation is indexed against this array, in this order. |
| `dag`                 | the recipe graph for the targets: what crafts into what, how many of each ingredient a craft consumes, and each node's legendary craft chance.             |
| `targets`             | the desired artifact node ids.                                                                                                                             |
| `fuelCapacity`        | total fuel for the whole plan.                                                                                                                             |
| `timeCapacityPerSlot` | seconds available **per slot**. Waking seconds only, when the problem has a sleep window.                                                                  |
| `nightsPerSlot`       | optional; whole sleep windows available per slot. **Absent means no sleep window** and is every problem unless sleep is switched on (see **Sleep**).       |
| `sleep`               | optional; `{ sleepSeconds, horizonSeconds }`, the day the night budget is cut from. Present exactly when `nightsPerSlot` is (see **Sleep**).               |
| `slots`               | how many missions can be in flight at once. Always 3.                                                                                                      |
| `ownedStock`          | copies of each node the player already owns.                                                                                                               |
| `craftBudget`         | optional golden-egg cap on the plan's crafts, with a unit price per node. Absent on every generated instance; only **A9** supplies one.                    |

Each option's `actualTime` is the seconds it charges its slot; with a sleep
window, an option may also carry `nights`, the sleep windows it flies through
(absent or 0 is a daytime launch).

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

- **Nights**, when `nightsPerSlot` is present. Each slot then holds at most
  `timeCapacityPerSlot` waking seconds **and** at most `nightsPerSlot` nights,
  so packing is a two-resource 3-way bin packing: a group must fit both at once,
  and neither total fitting says the plan packs. A launch with `actualTime` 0
  and `nights` 1 (a short ship launched at bedtime) is not free: it uses a night.
  Only a launch costing neither is free.

- **Real days**, when `sleep` is present. A sleep-aware candidate returns
  `calendar` beside its allocation: per slot, its launches in launch order, each
  `{ option, optionId, launchAt }` (`launchAt` in seconds from wake-up on day 0;
  further fields are allowed and ignored). The harness verifies it
  (`calendar.ts`) against its own menu and its own statement of the day, never
  against figures the candidate wrote down: each launch occupies its slot for the
  menu's `actualTime + nights * sleepSeconds`, must start while the player is
  awake (time of day at most `W`), may not start before the previous launch in
  its slot is free, and the slot must be free again by `horizonSeconds`; the
  calendar's launches per option must equal the allocation exactly. Tolerance
  one microsecond. A sleep-on plan with no calendar fails.

The harness decides this with its own packer (`pack-feasibility.ts`:
`packFeasible`, and `packFeasibleNights` once any launch in the plan spends a
night; a plan of daytime launches is judged by the one-dimensional rule exactly
as before), which imports nothing and which no candidate may import. With a
sleep window both the packer and the calendar verifier run, and C1 needs both:
the packer checks the budgets the problem states, the calendar that the plan
fits real days. The checks that build plans of their own (M3's union, D1/D2's
neighbours) still accept one by the packer alone, since the harness has no
layout of its own; an "improvement" they find may be one no real day holds,
which is a soft finding, not a gate. Returning an infeasible plan
is a hard failure, not a low score.

**The golden egg budget is not part of this.** Missions cost no golden eggs, so
no allocation can breach `craftBudget` and there is nothing here for a
feasibility check to test. It binds on the craft split, which the judge chooses
for itself, so the judge solves its craft polytope (`lib/mission-optimizer/solver/SPEC.md`'s
introduction defines this feasible set, there called the conservation polytope)
with the budget row in it, and a candidate that ignored the cap simply scores
worse. That is why the budget
appears under **A9** and has no C1 twin. Generated instances carry no budget; A9
introduces one as a perturbation, the way the other A checks perturb fuel and
time, so every recorded sweep result still measures the problems it always did.

Prices are the harness's own, derived from the game's price curve in `harness.ts`
rather than shared with `optimizer-cost.ts`: a pricing helper used by both the
planner and its judge would agree with itself no matter what it computed.

## Sleep

A day is a waking window `W` followed by a sleep window `S` (`W + S = D =
86400`), the same every day, shared by all three slots, and the plan starts at
wake-up. Sleep forbids launching and nothing else: ships fly and land through
the night. `S = 0` is the arena as it always was.

`sleep.ts` (imports nothing; harness-owned like the packer) turns the menu the
instance already enumerates into the menu a sleeping player has. With `d` an
option's `actualTime`, already `max(rawTime, launch period)` so the effort floor
applies to every variant:

- a **daytime** variant, when `d <= W`: `actualTime d`, `nights 0`, same `id`;
- an **overnight** variant for each `m` from `max(1, ceil((d - W) / D))` to
  `floor(d / D) + 1`: `actualTime max(d - m*S, (m - 1)*W)`, `nights m`, id
  suffixed `~night<m>`. Zero-second overnight variants are normal.

`rawTime` and everything else are kept. Variants are split before any menu
perturbation, so B1 shuffles and B6 duplicates variants. With horizon `H`
(the instance's `timeCapacityPerSlot`), `n = floor(H / D)`, `rho = H - n*D`:
the problem's `timeCapacityPerSlot` becomes `n*W + min(rho, W)` waking seconds
and `nightsPerSlot` is `n` (a trailing partial night is unused), and `sleep` is
`{ sleepSeconds: S, horizonSeconds: H }`. With `S = 0` the menu and the problem
are exactly today's: no variant, no `nights` field, no `nightsPerSlot` or
`sleep` key, and no calendar is asked for.

**Instances.** `generateInstance` draws a window from 0, 4, 6, 8, 10 or 12
hours, **last** in its RNG sequence, so every other field of every seed is what
it always was. `ARENA_SLEEP` decides whether it is used: unset, every instance
sleeps 0 and the arena is unchanged; a number of hours (`ARENA_SLEEP=8`) puts
that window on every instance; `draw` uses each seed's drawn window.

**Candidates declare sleep support** with `sleepAware: true` on their
`ArenaSolver` entry (`contract.ts`). A candidate without it is never handed a
problem with a sleep window: an instance with one is reported as skipped (not
solved, not clean, not failed, left out of quality and latency and of the
head-to-head), and **A10-sleep** is reported as skipped on every instance. The
scorecard prints both.

## Rules

- **Do not import the harness.** Not `evaluate.ts`, `pack-feasibility.ts`,
  `invariants.ts`, `harness.ts`, `instances.ts`, `scorecard.ts`, `sleep.ts` or
  `calendar.ts`.
  `independence.spec.ts` enforces this. Deriving your own copy of the objective
  or of a packing routine is fine and expected — sharing the harness's is not,
  because then the grader and the candidate are the same code.
- **Re-derive everything: no value import from `lib/mission-optimizer` or `tests/unit`.**
  `import type` is fine and is how you read the problem at all; the bare `lib`
  workspace package (egg, ship and artifact enums and tables) is game data rather
  than solver code and stays available. Calling into the incumbent's LP, tangent
  grid, packer or search would measure the incumbent's method wearing a different
  hat. `tests/unit` is barred for the same reason and not as tidiness:
  `spec-helpers.ts` there calls `optimizeFull`, so it is a second door onto the
  planner.

  There is one exception, encoded by name in `independence.spec.ts`:
  `solvers/highs/index.ts` is a shim around `lib/mission-optimizer/solver/`, the planner the
  app itself runs, so that one file may import `lib/mission-optimizer/solver/` and nothing else
  out of `lib/mission-optimizer`. It buys nothing else — it still may not touch the judge, the
  feasibility rule or the checks. Note the direction that leaves: production
  calls the same `solveWith` on the same loaded module the shim does, so the
  shipped planner and the measured one are one code path. A candidate importing
  `lib/mission-optimizer` would close that loop the other way and measure the app grading
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

| group                      | asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C0** contract            | the returned allocation has one entry per option, and every entry is a non-negative whole number                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **C1** feasibility         | the plan fits the fuel tank and packs into the slots (waking seconds and nights both, with a sleep window); with a sleep window, also that the returned calendar verifies                                                                                                                                                                                                                                                                                                                                                                  |
| **C2/C3** honesty          | the probability you report is the one the judge computes for the allocation you returned, and your per-target factors multiply to it (opt-in)                                                                                                                                                                                                                                                                                                                                                                                              |
| **A1-A10** monotonicity    | relaxing the problem cannot make your answer worse. More fuel, more time, more ships on the menu, more inventory, more zero-g research (so more capacity per mission), a higher crafting level, a shorter launch-period floor, one fewer target, a larger golden egg budget (**A9**, ending with the cap removed entirely), a shorter sleep window (**A10-sleep**: 12, 10, 8, 6, 4 hours, then none; sleep-aware candidates only, skipped otherwise): each is solved alongside the original, and the relaxed solve must not score below it |
| **B1-B6** invariance       | restating the same problem must not move the answer at all. Shuffling the menu, reversing the target list, multiplying every fuel cost and the tank by the same constant, appending a duplicate of an option already on the menu, or simply solving twice. There is no B4 and never was; the ids are the arena's public vocabulary, so the slot stays vacant rather than renumbering.                                                                                                                                                      |
| **M1-M3** cross-path       | the joint answer must not beat the product of the per-target optima (M1); a solo solve of one target must reach at least what the joint plan already reaches on that target (M2); and the joint answer must not lose to the union of per-target plans solved on split budgets (M3; options are matched on ship, target, nights and charge, so sleep variants stay apart)                                                                                                                                                                   |
| **D1/D2** local optimality | your plan cannot be improved by a small edit to itself. D1 tries every _pair_ — remove up to 2 launches of one option, add up to 2 of another — and D2 tries two such pairs at once. Deep tier only. Each also reports a `-inconclusive` variant when the search spends its evaluation budget without finding an improving move: no answer rather than a pass.                                                                                                                                                                             |

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
ARENA_SLEEP=8 ARENA=sweep pnpm arena        # an 8-hour sleep window on every instance
ARENA_INSTANCES=80 ARENA_SEED_BASE=9000 ARENA=sweep pnpm arena
pnpm arena:check                            # independence guard only
```

| variable          | default                | meaning                                                |
| ----------------- | ---------------------- | ------------------------------------------------------ |
| `ARENA`           | `smoke`                | tier; also the switch that makes the suite run at all  |
| `ARENA_INSTANCES` | 4 smoke / 40 otherwise | instance count                                         |
| `ARENA_SEED_BASE` | 2000                   | first seed                                             |
| `SOLVER`          | whole roster           | run one entry                                          |
| `ARENA_SLEEP`     | unset (no sleep)       | hours of sleep on every instance, or `draw`; see Sleep |
| `ARENA_GATE`      | —                      | `all` promotes every invariant to a hard failure       |

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

**Cost.** Minutes per instance, almost all of it solver runtime: `invariants.spec.ts`
puts the four-instance smoke tier at about 12 minutes, and the forty-instance sweep
scales from there. The deep tier adds substantially more. Over the default seed base
(2000-2039) instances carry 63 to 289 options and 1 to 4 targets.

## The roster

`highs` — the shipped planner, `lib/mission-optimizer/solver/SPEC.md`. Sleep-aware: it
budgets nights per slot (that file's section 9), lays each plan out on real days
and trims what does not fit (section 10), so A10-sleep runs for it on every
instance, `ARENA_SLEEP` or not, and its sleep-on plans are checked by their
calendar. It also reports `layoutStats`, which the scorecard sums over fresh
solves into one `layout` line for sleep-on runs; that line is the candidate's
own account and nothing gates on it.

The arena is not a bake-off between methodologies. It is the bar a change to the
shipped planner has to clear before it lands. A proposed change may be registered
alongside it for as long as it takes to decide, since the harness already runs
every entry over the same instances against the same judge and prints the
head-to-head — A/B'ing a tuning costs one line in `registry.ts` rather than a
bespoke script. Such an entry ships or it is deleted; the roster is not where
alternatives accumulate. It is one row for that reason and not because nothing
has been tried: the shipped single-pass tuning was chosen over five registered
arms, and all five were deleted once it was.
