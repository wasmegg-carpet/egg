# The plan as a mixed-integer program

The shipped planner. `optimizer-core.ts` calls `solveWith` from `solve.ts` on a
module loaded by `loadHighs`, and the arena enters the same pair through a shim
(`tests/arena/solvers/highs/`), so the solver users run and the solver the
harness measures are one code path. **The judge** is `evaluator.ts`, this
directory's own re-derivation of the objective; the arena harness has an evaluator
of its own (`tests/oracle/evaluate.ts`), and where that one is meant the text says
so. `tests/arena/ARENA.md` states the problem; this file is the design record
behind the method — the measurements, the constants and the negative results the
model as it stands rests on, written after it, not a specification written before
it.

The whole problem — mission counts per slot, crafts as flow over the conservation
polytope (the feasible set of the craft variables, carved out by linear rows), fuel,
packing — is one **mixed-integer linear program**: a linear program in which some
columns, here the per-slot mission counts, may only take whole numbers. HiGHS solves
it by **branch-and-bound**, repeatedly solving the **LP relaxation** (the same
program with the integrality dropped, whose optimum bounds the true one) and
splitting on a column that came back fractional.

The one thing that cannot be stated as a linear row is the objective's
`log(1 - e^-s)`. It is **concave** — it curves only one way, so every tangent line
to it lies on or above it — which is what makes **outer approximation** available:
hold each target's contribution under a family of its own **tangent cuts**, whose
lower **envelope** is a piecewise-linear over-estimate of the curve — up to section
3's flat cuts, which can sit under it by 1e-12 nats — and solve the resulting MILP.
The grid of tangent points is fixed up front, so there is exactly one MILP per plan
— though a solve makes `T + 1` calls into HiGHS, one continuous scale LP per target
(section 4) and then the MILP.

Four more terms the sections below use without reintroducing them. A **vertex** is
a corner of a feasible set, where a simplex optimum always sits. A **reduced cost**
is the rate at which bringing a column into the basis would improve the objective.
**Presolve** is the pass that shrinks a model before solving it, by eliminating rows
and columns it can prove redundant. **Frank-Wolfe** maximizes a concave objective
over a polytope by repeatedly linearizing it and stepping toward the vertex that
linearization prefers; the away-step variant `evaluator.ts` runs may instead step
back from a vertex already in the mix.

The figures in this file come from arena and oracle campaigns run while the
decision they support was being made. The seed base, loot snapshot and HiGHS
version behind each were not recorded with it, and no results are retained in the
repo — `tests/arena/results/` is gitignored. A figure here is therefore a reason
to re-measure with `pnpm arena` before leaning on it, not a bound to rely on.

Section numbers are cited from code comments throughout `lib/mission-optimizer`. They are
stable; add rather than renumber.

## 1. Preprocessing

`model.ts` takes the downward closure of the targets, normalizes fuel to a budget
of 1 and time to a per-slot budget of 1, drops options that cannot fit a slot or
carry nothing useful, and merges exact duplicates into groups under a numeric
canonical key. Together these make the result independent of the order the user
clicked buttons.

### Dominance

`pruneDominated` then drops a group when another can stand in for it launch for
launch: no more fuel, no more seconds, and at least as much of every item the
conservation rows read and of every target's legendary drops. What it buys is
columns: an integer total column plus a nonzero in every row it touches, and the
`slots` class columns of section 2 when it was the last group of its duration.

**Why it cannot cut off the optimum.** Take any point feasible for the full model and
move every launch of the dropped group `i` onto its dominator `j`, _in the slot it
already flew in_. The fuel row and every slot load only fall; item supply and every
`s_t` only rise, so the conservation rows gain slack and the tangent cuts on `z_t`
relax. Crafts can be held where they were, so the price row is untouched and the
objective does not fall. The one row that can break is `order_k`, and it is a
symmetry break over slots the remaining rows leave interchangeable. Re-sorting the
slots by load restores it and moves nothing else. So the pruned model's optimum is at
least the full model's, and being a restriction it is also no more.

That argument is about rows, so it needs the _column bounds_ to say nothing the rows
do not. `boundsFollowFromRows` refuses a dominator whose per-slot bound is the
`UNBOUNDED_PER_SLOT` stand-in rather than its own duration (section 2): absorbing another
group's launches is exactly what can push a column past a cap no row implied.

The relation is strict on at least one axis, so it is a strict partial order and
every dropped group has a dominator that itself survives. Testing against the whole
menu rather than against the survivors is what makes the result independent of the
order groups are walked in. It reads only a group's own numbers, and group order is
already a function of the target set and the option set rather than of menu order, so
arena B1 and B5 are unaffected.

## 2. Columns

A column summing each mission's allocation across slots keeps every row that does
not care _which_ slot a mission went into (chiefly craft conservation) at one
nonzero per group instead of three.

The per-slot columns go the other way: they are per **duration class**, not per
group. The only rows that read them, `slot_k` and `order_k`, read a mission's
duration and nothing else, so every group of one duration shares `slots` integer
columns and a `class_c` row ties the sum of their totals to the class's slot
counts. With a sleep window the `night_k` rows read its nights too, and the class
is keyed by both (section 9).

Crafts stay continuous deliberately: the judge re-optimises the craft split as an
LP for whatever allocation it is handed, so integralising crafts here would
optimise a different objective from the one being graded.

Mission columns are capped by fuel and by time, and by nothing else: a `LaunchOption`
carries no launch limit of its own. `UNBOUNDED_PER_SLOT` and `UNBOUNDED_GROUP` stand in
when neither budget gives a bound at all (a
zero fraction); their values are arbitrary above the point where they stop
binding, and only finiteness matters, since an unbounded integer column gives
branch-and-bound nothing to branch on.

`craftUpperBounds` propagates intervals over the recipe. It counts every group at
the maximum it could reach with the whole tank and every slot to itself, and gives
two parents drawing on one ingredient all of it each, so it over-states supply and
cannot cut off a feasible point. It is not floored, because `c` is continuous and
2.5 crafts is reachable. The conservation rows imply the same thing, but only
through a chain one tier at a time, so handing the bound over directly is worth a
measured double-digit percentage of solve wall-clock: redundant as modelling, not
as arithmetic.

## 3. Rows

The row names below are the ones `milp.ts` gives each row at `Rows.begin`. They
reach the LP text `highs.ts` writes and the error `Rows.end` throws, so they are
greppable in both directions.

Two rows are the reason to reach for a MILP at all.

**`slot_k` states the packing constraint** — three rows, one per slot, rather than
a volume bound a repair pass has to make true afterwards. A plan that solves this
model packs by construction, and the assignment is the packing witness. This is the
whole reason the plan is an MILP rather than a continuous relaxation plus a repair
step (`../OPTIMIZER.md`, "Search structure").

**`score_t` puts the craft split in the same matrix**, so the solver trades a
mission for a craft directly instead of choosing missions first and accounting for
crafts afterwards.

Slot rows are in raw seconds, not normalized: HiGHS accepts an integer solution
violating a row by up to `mip_feasibility_tolerance`, which is absolute on row
activity, so a normalized row would license overfilling a slot by that fraction of
the whole horizon — seconds of it on a month-long plan.

`price` is written only when the caller supplies a budget, from the linear per-craft
prices `computeCraftUnitPrices` (`../optimizer-cost.ts`) derives; that is where the
approximation and the direction it errs in are set out. What this model needs from it
is one consequence: the prices over-state the bill, so a plan satisfying the row is
always affordable. The true nonlinear form cost the solver its ability to converge in
reasonable time. Unnormalized, because its magnitude sits well inside the window
below.

The judge carries the same row on its own craft LP (`evaluator.ts`). It has to:
its whole job is to re-derive the objective the MILP steered towards, and over
the unbudgeted polytope it would re-optimise the craft split onto crafts the plan
cannot pay for — an arena C2-honesty failure, since the harness scores the same
allocation _with_ the budget. A capacity of exactly 0 is the one place the row
also reaches the `Q = Infinity` shortcut, whose "an infinitesimal craft costs
infinitesimal inventory" argument does not carry to a purse with nothing in it.

`order_k` forces slot loads non-increasing. Without it every plan appears `slots!`
times and the tree spends its budget rediscovering the same plan in a different
order.

### Row scaling, and the ingestion window

HiGHS discards any matrix entry at or below `small_matrix_value` (default 1e-9)
while _ingesting_ a model. A discarded entry does not weaken a row, it deletes a
term: lose the fuel row's coefficients and the fuel budget stops existing, with
nothing anywhere saying so. The margin is not comfortable — fuel costs are
normalized by the tank, the smallest ever observed was 2e-8, and the arena's
A1-fuel check doubles the tank, halving that.

**Setting the option is not the fix.** The wasm build's `solve(text, options)`
writes the model to its virtual filesystem, calls `Highs_readModel`, and applies
options only _then_, so everything governing ingestion (`small_matrix_value`,
`large_matrix_value`, `infinite_bound`) is set too late and silently does nothing.

So `Rows.end` scales instead; multiplying a row and its bounds by a positive
constant leaves the feasible set unchanged. A row is scaled only when its smallest
entry falls below `SAFE_COEFFICIENT = 1e-6`, a thousand times clear of the filter,
so rows in ordinary magnitudes are left alone.

The other end of the window bounds that scaling: HiGHS _rejects_ a model carrying
an entry above `large_matrix_value` (default 1e15), failing in the reader and
surfacing as a plan that could not be computed at all. The `score_t` rows are
where both ends bite at once — `theta_t` runs down to ~1e-13 against a craft
coefficient as large as `Q_CERTAIN_PROXY` (1e4), a dynamic range of ~1e17 inside
one row — so normalizing the small side to 1 would put the other at ~2.8e16 and
make the model unreadable. Hence
`Math.max(1, Math.min(1/smallest, SAFE_LARGE_COEFFICIENT/largest))`, where
`SAFE_LARGE_COEFFICIENT = 1e12` keeps three decades of headroom under the reader's
limit and the outer `max` stops a row ever being scaled _down_.

Tangent cuts are where this bites, and they are the only rows ever observed to leave
the window. A cut's two entries are `+1` on `z_t` and `-theta_t * g'(s_k)` on
`sigma_t`, evaluated at the grid point `s_k = theta_t * sigma_k`. Section 4's floor
caps that slope at `1/SIGMA_FLOOR = 100`, but nothing bounds it from below: past
`s ~ 400` it underflows — ~1e-179 measured — and the row's dynamic range is then wider
than the window at any scale. `buildOaMilp` drops a slope under
`FLAT_CUT_SLOPE = 1e-12` rather than writing it. `sigma <= 1`, so the dropped term is
worth at most that many nats — natural-log units on the joint probability, so 0.69
nats is a factor of two — anywhere in the feasible range, and the flat cut left behind
can sit under `g` by the same amount, a thousandth of the envelope error the grid
already carries.

No scale fits such a row, so `Rows.end` throws on anything still outside
`(1e-9, 1e15)` after scaling — for the small end and the large end alike. Handing it
over instead deletes its smallest terms silently, and a budget row that loses its
coefficients stops budgeting; a failed solve is the readable outcome, and it is why a
new row in large units is not unprotected.

## 4. Scaling: why `sigma` and not `s`

Scores run to `s ~ 1e-13` and `g'(s) ~ 1/s`, so cuts written directly in `s` would
carry slopes around 1e13 — enough to make the solve meaningless or to blow up
HiGHS outright.

Every target is therefore measured in units of its own ceiling. `theta_t` is the
largest score `t` can reach when every other target is ignored and counts may be
fractional (one continuous LP per target, `scaleLps`). Then `sigma_t = s_t/theta_t`
lies in `[0, 1]` and a tangent at `sigma = a` has slope `1/a`. The grid bottoms out
at `SIGMA_FLOOR`, so no tangent coefficient exceeds `1/SIGMA_FLOOR`.

`theta_t <= 0` means no allocation scores that target, so every plan has joint
probability zero and the empty one is returned directly. A `sigma_t` of exactly
zero produces no cut, since there is no tangent at zero — when the model wants to
abandon a target outright, the deepest existing cut prices that decision, which is
what makes the grid's floor load-bearing rather than decorative.

### The scale LP's objective weight

The scale LP maximizes a _raw_ score, and raw scores run to 1e-7 and below.
`dual_feasibility_tolerance` is the bar a reduced cost has to clear before the
simplex will take that column; below the bar the current vertex is called optimal.
It is absolute on reduced costs, so at that magnitude every reduced cost at the
all-zero vertex is inside tolerance and HiGHS reports optimal at zero — with no
warning — while a feasible point three decades better sits in the same polytope. A
zero `theta` then reads as "target unreachable" and returns an empty plan.

`SCALE_LP_OBJECTIVE = 1e9` multiplies every reduced cost, lifting raw scores clear
of the tolerance. Scaling an objective does not move its argmax, and `theta` is
read off the _column_ rather than the objective value, so it costs nothing.
`dual_feasibility_tolerance` is tightened one order alongside it, to 1e-8, and
only one: at HiGHS's documented minimum of 1e-10 the simplex fails outright with
`HiGHS error -1` from `Highs_run`.

### Two constants that are not the judge's

`objective.ts` exports `gPrime`, clamped at 1e12 so the judge's Frank-Wolfe
linearizations (`evaluator.ts`) stay finite. The cut generator must **not** reuse
it: at `s ~ 1e-13` the clamp would be active at every tangent point at once, every
cut would come back with the identical slope, and the outer approximation would
carry no curvature at all.

`Q = -log(1 - p)` is `+Infinity` when a craft is certain, and infinity cannot enter
a matrix. `Q_CERTAIN_PROXY = 1e4` is large enough that one craft saturates `g` to
every bit of a double, and small enough to stay mid-window in the matrix. Both
matrices HiGHS is handed read that one constant — the scale LPs above and this MILP —
so a target is never measured against one value of certainty and ranked against
another. The judge (`evaluator.ts`) still
sees the real Infinity; the proxy only steers.

## 5. The pass

One MILP under a fixed tangent grid, then decode, then judge.

The grid is log-spaced in units of theta because `sigma` is "fraction of
achievable": the thirteen decades the scores span live in theta, which the
normalization divides out. Envelope error is `(d ln10)^2 / 8` nats at `d` decades
per cut (`envelopeErrorNats`), which sizes the point count — 50 cuts over the two
decades down to `SIGMA_FLOOR`. `SIGMA_FLOOR` is 1e-2, a decade below any sigma ever
measured; an earlier 1e-5 spent most of its grid where no plan has ever landed.
The band is conditioned on the instance generator, so a materially different fleet
or target mix is a reason to re-measure rather than to trust it.

**There used to be a refinement loop here**, adding a cut per target at the MILP's
own `sigma*` and at the judged score. A placebo round against a row-permutation of
the identical cut set kept most of its apparent gain, so it was buying a search
restart rather than a tighter envelope; the same budget spent on nodes buys more.
Do not re-add it without a placebo arm.

What comes back is a _judged_ plan, never the MILP's answer on faith: the
incumbent is scored by `evaluator.ts`, an independent re-derivation of the
objective, so the linearized model steers and the real objective decides; nothing the
envelope computes ever reaches a number a user is shown (`../OPTIMIZER.md`, "The
tangent outer approximation", for why that is the property to preserve). A plan
that does not strictly beat the empty plan is dropped — a node-limited search can
return an allocation scoring probability zero, and the empty one at least spends
nothing to do that.

The judge has two precisions, and which one runs is not obvious. Selection uses
`STEERING_PRECISION` (gap 1e-7, 600 iterations) — it only has to rank the incumbent
against the empty plan. `EXACT_PRECISION` (1e-12, 2000) runs under `report: true`,
which both the arena and the app pass: the craft counts on the solution card are the
judge's own split, not a second solver's answer to the same question. So loosening
`STEERING_PRECISION` changes which plan users get, and loosening `EXACT_PRECISION`
changes the figures printed beside it.

Neither number is the only stop. The away-step loop also breaks when its line search
cannot improve on the current point, which is what ends a solve whose `gPrime` is
clamped for every target at once — the gradient is then constant, the vertex it points
at never moves, and the duality gap floors above any tolerance while there is nothing
left to find.

## 6. Decode and certify

Both budgets are rows of the model, so a decoded plan is feasible by construction;
`fitsBudgets` says so out loud rather than assuming it, re-checking the fuel row
against the rounded counts and reading the three slot loads straight off the
MILP's own columns — the packing witness that summing over slots threw away. With
a sleep window it reads each slot's nights off the same columns (section 9).

The craft budget is deliberately not among them: no allocation can breach it, because
it binds on the craft split rather than on missions, and the judge re-solves that split
over a polytope carrying the same row (section 3).

`SLOT_TOL` is 1e-9 not for resolution — the drift it absorbs is three decades
smaller — but because that is the arena's own packing tolerance
(`tests/arena/pack-feasibility.ts`). It is a ceiling rather than a preference:
anything looser certifies plans the arena calls infeasible, an arena C1 hard
failure.

`FUEL_TOL` is the same figure and not the same argument. Fuel is normalized to a
budget of 1, so 1e-9 there is _relative_ slack where `SLOT_TOL` is absolute
seconds, and the argument from the arena's packer does not carry over — it is
justified only as float noise against a budget of 1. If fuel ever becomes the
constraint a plan is rejected on, re-derive this one rather than trusting it.

It is a verifier, not a repairer. A failing incumbent is dropped, not patched: the
caller keeps the previous judged plan, and the worst case is the empty plan, which
is feasible and honest.

## 7. Budgets, and why they are counts

Every budget here is a **count**, never a number of seconds, in the app and in the
arena alike. A wall-clock limit would make the returned plan a function of machine
load: the same inputs would give a user two different plans on two runs, and the
arena could not grade a candidate it cannot reproduce. For the same reason
`SOLVER_OPTIONS` pins `threads: 1`, `parallel: 'off'` and `random_seed: 0` — a
parallel MIP search is not reproducible — and there is no `Math.random`, no
`Date.now` and no environment read anywhere in this directory. `MIP_REL_GAP` is
1e-6, tight enough that the node limit rather than the gap ends a hard search, so
the knob that governs cost is the one that gets tuned.

Which budgets exist at all is settled once, by `normalizeProblem` in `types.ts`, and
both entry points — `optimizeFull` and `buildModel` — go through it, so no rule is
applied twice or differently. A budget is either absent, meaning no limit, or a finite
non-negative number: anything else (an empty input field arriving as NaN, a negative
capacity) normalizes to 0, which permits nothing, since reading a malformed capacity as
unlimited is the one answer a caller who set a budget cannot use. A malformed
`craftBudget` throws instead, the only path to one being a programming error rather than
a keystroke. Two cases are worth naming because the reading is not the obvious one: an
_empty_ `fuelAxes` list is an empty tank, not an absent budget, and duplicate target ids
are dropped, since the objective is the probability of a legendary of every _distinct_
target and an id listed twice is one event rather than two.

`DEFAULT_TUNING` is `maxNodes: 1200`, which is a latency choice: quality is flat
across every tuning ever swept (all means inside 0.005 log10), so what the number
buys is a solve that stays well under a second on a production instance and a lower
rate of arena monotonicity violations, not a better plan. Two rules for anyone
re-tuning it. The harness reproduces exactly, but the same tuning's severity
swings 3x across seed bases, so **treat any single-campaign delta under about 1.5x
as noise**. And the floor is hard: `maxNodes: 0` returns probability zero on
_every_ instance even at `mip_heuristic_effort: 1.0`, because the root heuristics
never find an incumbent.

## 8. The backend

`highs.ts` loads `highs` (lovasoa/highs-js), HiGHS compiled to WebAssembly — the
build that can ship, since `artifact-explorer` is a browser app and a native addon
cannot go there. The module exposes one entry point taking a model in CPLEX LP
format, so every solve serializes the matrix to text and has HiGHS parse it back.
That round trip dominates a _continuous_ solve and is under 5% of an expensive
MILP one; building the text in JS is negligible beside either.

Asset resolution is why this is a loader function rather than a bare import. Left
alone the Emscripten glue looks for `highs.wasm` beside itself, which is right
under Node and wrong inside a bundled worker; handing it the URL from
`import wasmUrl from 'highs/runtime?url'` lets Vite emit and fingerprint the file
like any other asset.

Two properties of the text interface are worth knowing, both silent when got
wrong:

- Options are applied _after_ `Highs_readModel`, so nothing governing ingestion
  takes effect (section 3).
- A solution's `Index` field is the column's position _in the LP file_, the order
  the reader first saw it, not the order the model built its columns in. Mapping
  through `Index` type-checks, runs, and reads the wrong columns.

### Presolve, and the throw it used to cause

`SOLVER_OPTIONS.presolve` is `'off'`, measured rather than assumed: across arena
instances it was 11-17% faster off, with an identical joint probability on every one
of them.

**Turning it off also removed a failure path.** HiGHS can fail inside _presolve_
on a model it reads and solves perfectly well without it, throwing "HiGHS error
-1" out of `Highs_run` — not out of the reader, so this is not section 3's
ingestion window. The trigger is `mip_feasibility_tolerance` at 1e-9, the
interaction ERGO-Code/HiGHS#1578 reports.

Neither obvious alternative is a fix. `random_seed: 1` also clears the throw,
which marks it as a knife-edge numerical coincidence — so changing the seed would
settle this instance and silently pick a different one to fail on. Loosening
`mip_feasibility_tolerance` would weaken, on _every_ solve, the guard keeping
HiGHS's integer solutions on the arena packer's scale (section 3). Nothing
gentler is available either: `presolve_reduction_limit` and `presolve_rule_off`
are not in this package's typings, and of the three values it does expose,
`'choose'` still throws.

Presolve only reformulates; it cannot change the feasible set, so running without
it can turn a failure into an answer but never a wrong answer into a right-looking
one.

## 9. The night budget

A problem may carry `nightsPerSlot`, the whole sleep windows each slot has, and
its options `nights`, the sleep windows each launch flies through.
`timeCapacityPerSlot` then counts waking seconds only, and each option's
`actualTime` the waking seconds it charges. The variants (a daytime one and
one per number of nights a launch can span) are the caller's to generate: the
arena does (`tests/arena/ARENA.md`, "Sleep"), and so does the app, in
`optimizeFull` (`../sleep.ts`), when the player sets a sleep window. **Absent
means today's problem**: the model reads it as 0, every
option with `nights > 0` is dropped, the `night_k` rows have no entries and
`Rows.end` drops them, and the matrix HiGHS is handed is the one it was handed
before.

What changes when it is present:

- **Preprocessing.** An option spending more nights than a slot has is dropped,
  as one charging more seconds than a slot has is. `nights` is part of the
  group key, and a group's cap gains `floor(slots * N / nights)`.
- **Dominance.** A taker may not spend more nights than the group it stands
  in for, and spending fewer is strict. Without that an overnight variant,
  which charges fewer waking seconds, would prune its own daytime twin. The
  section 1 argument carries over unchanged: moving launches onto the
  dominator in the same slot only lowers the night rows too.
- **Classes and bounds.** Duration classes are keyed by the pair (seconds,
  nights). A class's per-slot bound is the smaller of its time bound and
  `floor(N / nights)`. `boundsFollowFromRows` accepts a group that spends a
  night, whatever its duration, because the night row bounds it; otherwise a
  zero-second overnight launch (a short ship sent at bedtime, which still
  spends a night) would sit in a private class and could not stand in for
  anything.
- **Rows.** `night_k`, one per slot, sums `nights * n[c][k]` against `N`. Its
  coefficients and right-hand side are small whole numbers, far inside the
  ingestion window. `order_k` is unchanged: slots stay interchangeable under
  both rows, so sorting them by waking load is still only a symmetry break.
- **Certify.** `fitsBudgets` re-reads each slot's nights off the class
  columns, as it reads seconds, and compares exactly.

**It is a relaxation, and it over-promises.** The slot row pools a slot's
waking seconds across all its days, but real days are separate bins: a daytime
launch has to fit inside one waking window. Every schedule that respects the
sleep windows satisfies both rows, and not every plan satisfying both rows is
a schedule. A plan from this model alone can list launches no real day has room
for. Nothing in this section proves a plan fits real days; the per-day fit
rows, the layout of each slot's launches and the verifier of section 10 do, and
the app never sets this field without the `sleep` field that turns them on.

## 10. Fit rows, layout, verifier and trim

Section 9's budget is a relaxation; this section is what stops it from being
reported as a plan. A problem that also carries `sleep` (`types.ts`:
`sleepSeconds` `S` and `horizonSeconds` `H`, the horizon `timeCapacityPerSlot`
was before it came to count waking seconds) gets three more things, and every
plan it returns has been laid out on real days and verified. **Absent means
today's problem**: no fit rows, no layout, no `calendar`, and the matrix and the
result are the ones section 9 produced. `normalizeProblem` leaves the field
absent when absent, normalizes `H` like any other budget, and throws on an
`S` outside `[0, 86400)`, since neither "no sleep" nor "no waking" is a safe
reading of a malformed window.

`days.ts` derives one slot's day structure from the three fields: `W = 86400 -
S`; `N`, the nights the layout uses, the smaller of `nightsPerSlot` and
`floor(H / 86400)`; `ceil(H / 86400)` waking windows; and the trailing partial
day's waking `tail`, the smallest of what `timeCapacityPerSlot`, `H` and `W`
leave for it (0 on a whole-day horizon). A caller whose fields disagree gets the
smallest day any of them describes.

**Fit rows.** The slot row pools a slot's waking seconds over all its days, so
it plans 65 launches of 5.88 hours into 24 sixteen-hour days that hold 48. For
each `q` in the distinct values of `min(floor(W / seconds + 1e-9), 96)` over the
daytime classes with a duration, each slot gets a row `fit_k<k>_q<q>`:

```
sum over daytime classes  u^(q)(seconds / W) * n[c][k]
  + sum over overnight classes  (nights - 1) * n[c][k]   <=  waking windows
```

`u^(q)` is Fekete and Schepers' dual feasible function: `x` where `(q + 1) x` is
within 1e-9 of a whole number, `floor((q + 1) x) / q` elsewhere. Daytime
launches inside one window sum to at most 1 under it, and a launch spanning `m`
nights flies straight through `m - 1` windows no daytime launch can use, so the
rows are valid inequalities: they cut off no plan that fits real days, and cost
no columns. They are in the scale LPs too, which only tightens `theta` towards
what can actually be flown. They do not close the gap: a mix (several mid-length
launches leaving room for two short ones) is caught by no single `q`, and the
`m - 1` term leaves a one-night ship's waking hours to the slot row. The layout
is what is relied on; the rows only leave it less to trim.

**Layout** (`layout.ts`), per slot, from the MILP's own class columns `n[c][k]`
(the packing `fitsBudgets` certified):

- **Connectors.** Each overnight launch, plus a null connector (one night,
  nothing flying) until the nights sum to `N`. Each has `flex = waking seconds -
(nights - 1) W`, split into a head (before bed on the day it leaves) and a
  landing (after wake-up on the day it lands). They are ordered by flex,
  alternately largest and smallest, the smallest last, so a long landing meets a
  short take-off and nothing long lands into the tail. **The order is a
  heuristic**: another may place more, so what the layout places is a lower bound
  on what fits, never an over-statement.
- **Segments.** `K` connectors cut the slot into segments `0..K`: each of the
  first `K` is one waking window ending with its connector's take-off; segment
  `K` is the tail.
- **Exact chain.** Given the daytime seconds in each segment, taking every head
  as large as its segment allows is exact (a larger head only shortens the next
  landing), so whether a set of segment loads stands, and the heads that make it
  stand, is a linear pass in seconds. Overnight ships that cannot stand on their
  own (two long flexes meeting in one day, or more nights than the horizon has)
  are dropped first, one at a time by the judge, preferring a drop that stands
  the chain up by itself.
- **Greedy first.** Daytime classes largest first, each launch into the earliest
  segment that takes it with the chain still standing. When it places every
  launch it is optimal and no MILP is built; that is the common case.
- **MILP otherwise.** Integer `x[c][j]` per daytime class and segment, bounded
  by `min(count, floor(window / seconds))`; continuous `head[j]` within
  `[max(0, flex - landing room), min(flex, W)]`; one row per segment (its
  launches, its own head, the previous connector's landing) and one per class;
  maximize the waking time placed. Hours, not seconds. Node limit 1000
  (`LAYOUT_LIMITS`) and **never a timeout**, for section 7's reason. Solved by
  the same `MilpSolve` as the main model. Its rounded `x` are re-checked with
  the exact chain; heads are recomputed from them, never read off the
  continuous column.
- **Margin, only when needed.** HiGHS accepts an integer column within 1e-6 of a
  whole number, so a rounded layout can over-fill a day by hundredths of a
  second. Only when the exact re-check fails is the MILP solved again with one
  second off every segment row; if that fails too, launches come off the failing
  segment, shortest first, until the chain stands. The margin is not applied up
  front because it forbids exact fits (sixteen one-hour High-effort launches in a
  sixteen-hour day) and can make a day its overnight ships already fill
  infeasible.
- **No incumbent.** An infeasible layout MILP, or one that hits its node limit
  without an incumbent, leaves the greedy's placement, which always stands. The
  better of greedy and MILP by waking time placed is kept.
- **K = 0** (a horizon under a day): the greedy lays launches end to end.

Launch times follow: zero-second daytime launches at the start, each segment's
daytime launches end to end from the previous landing, each connector at `W -
head` on its day.

**Verifier** (`verify.ts`, a few dozen lines reading only launch times and block lengths):
every launch's time of day is at most `W`; each launch is at least the previous
launch plus its block (`waking seconds + nights * S`, which covers the flight and
the effort floor); the last block ends by `H`. Tolerance 1e-6 s
(`VERIFY_TOL_SECONDS`): far below anything a player acts on, far above the float
drift of summing a few hundred durations on a horizon of millions of seconds.
The layout's own arithmetic works to 1e-7 s so it never reaches that edge.

**Trim.** Every launch the layout drops (an unplaced daytime launch, an
overnight ship that cannot stand) decrements, among the groups of the allowed
classes, the one whose loss leaves the highest `evaluateCounts(model, counts,
STEERING_PRECISION).logJoint`, one launch at a time; an unjudgeable candidate
scores `-Infinity`. A slot the verifier rejects loses one more launch, chosen
the same way among the classes in it, and is laid out again; an empty slot
always verifies, so this ends. There is no cap-and-re-solve. The trimmed plan
is then judged against the empty one exactly as the untrimmed plan was, and
everything reported (allocation, joint, per-target, craft split) is computed
from the trimmed counts. **Trimming is not monotone**: a relaxed problem can
come back with a plan that trims worse than a tighter one's, and the arena's
monotonicity checks see that.

**The hard rule.** `emit` refuses to return a sleep-aware plan without a
calendar, and `assertVerified` checks the calendar it does return: each launch
against the option it names (its `actualTime` and `nights`, not what the layout
wrote down), each slot against `verify.ts`, and the launches per option against
the allocation, exactly. A failure throws, as the solver's other internal
failures do (`Rows.end`, `logGrid`); an unverified plan is never returned.

**Result.** `PlanResult.calendar`: per slot, launches in order, each with its
option index and id, `launchAt` (seconds from wake-up on day 0), waking seconds
and nights. A group's launches are flown as its first member, as `emit`
allocates them. `PlanResult.layoutStats`: launches trimmed (overnight ones
counted apart), layout MILPs solved, margin re-solves, verifier retries.
Diagnostics only.
