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
is keyed by both (section 9); with an event window the `window_k` and
`overhang_k` rows read its capacity variant, and the class is keyed by that as
well (section 11).

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
a sleep window it reads each slot's nights off the same columns (section 9), and
with an event window each slot's `event` seconds and `overhang` launches
(section 11).

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
today's problem**: no fit rows and no trim, the calendar is section 12's back to
back one, and the matrix and the result are the ones section 9 produced. `normalizeProblem` leaves the field
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
- **Re-timed, only when something is left over** (section 14). When the
  segments leave daytime launches unplaced, the slot is re-timed in the same
  order, each launch at the first waking instant its predecessor's block leaves
  it, and what was left over goes on the end while it still ends by `H`. Kept
  only when that places a launch more.

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

**Trim.** Every launch the layout drops (a daytime launch neither the segments
nor the re-timed slot's end has room for, an overnight ship that cannot stand)
decrements, among the groups of the allowed
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

**The hard rule.** `emit` refuses to return a plan without a calendar — any
plan, since section 12 — and `assertVerified` checks the calendar it does return: each launch
against the option it names (its `actualTime` and `nights`, not what the layout
wrote down), each slot against `verify.ts`, and the launches per option against
the allocation, exactly. A failure throws, as the solver's other internal
failures do (`Rows.end`, `logGrid`); an unverified plan is never returned.

**Result.** `PlanResult.calendar`: per slot, launches in order, each with its
option index and id, `launchAt` (seconds from wake-up on day 0), waking seconds
and nights. A group's launches are flown as its first member, as `emit`
allocates them. `PlanResult.layoutStats`: launches trimmed (overnight ones
counted apart), layout MILPs solved, margin re-solves, verifier retries.
Diagnostics only, and present only with a sleep window; with an event window
as well it also counts launches demoted to 1x (section 13).

## 11. The 2x capacity window

Egg, Inc. periodically doubles every ship's capacity for 48 hours. A mission is
doubled when it _launches_ inside the window; when it lands does not matter. A
problem may carry `eventWindowSeconds` `W`, the seconds of window left, as a
prefix of the plan starting at `t = 0` — never an interval starting later — and
its options a capacity `variant`. **Absent means today's problem**: the model
reads `W` as 0, drops every doubled option (there is no row to hold one inside a
window, and flying it at 2x unconstrained is the one wrong answer), the window
rows have no entries and `Rows.end` drops them, and the matrix HiGHS is handed is
the one it was handed before. `tests/unit/event-window.spec.ts` holds the matrix
and the scale LPs to that, entry for entry, with the doubled options on the menu
and without.

The variants are the caller's to generate, as the night variants are (section
9): each launch once as `normal`, at 1x; once as `event`, at 2x, when it is no
longer than `W`; and once as `overhang`, at 2x, always. All three are the same
flight — fuel, seconds, nights, gem cost — and differ in yield and in which row
holds them. The app does it in `optimizeFull` (`../capacity.ts`), the arena in
its own copy (`tests/arena/ARENA.md`, "The 2x capacity window").

**Rows.** Per slot, `window_k`, `sum over event classes seconds * n[c][k] <= W`,
and `overhang_k`, `sum over overhang classes n[c][k] <= 1`.

The pair is **exact, not a relaxation**, while a slot's launches go up back to
back. If `j` launches go up inside the window in some slot, the first `j - 1` all
finish launching before the last one starts, so their seconds sum to at most `W`
and they are `event` columns; the `j`-th is the `overhang`, which spends no
window seconds because nothing doubled follows it. Conversely any assignment
satisfying both rows can be flown: `event` launches first, each starting before
their total, which is at most `W`; then the `overhang`, at that total. Equality
at `W` is admitted rather than modelled as strict. The `overhang` is what makes
the common case right: three hours of window against a fleet whose shortest
mission is a day leaves `event` empty, and still a launch sent now in each slot
is doubled.

Raw seconds in `window_k`, for the slot row's reason (section 3); `overhang_k`
is whole launches against 1. One window is shared by every slot, so slots stay
interchangeable and `order_k` is still only a symmetry break.

What else changes when `W` is present:

- **Preprocessing.** An `event` option longer than `W` is dropped: its column
  would be pinned at 0. `variant` is part of the group key, so an `event` and an
  `overhang` copy of one launch, identical in every other number, never merge
  into one group and lose a row. A group's cap gains `slots * floor(W /
  seconds)` for `event` and `slots` for `overhang`.
- **Dominance only within a variant.** A doubled copy costs exactly what its
  normal twin does and yields twice as much, so across variants it would prune
  the twin — and then every launch of the plan would have to fly doubled, which
  the window rows allow a few times per slot. Section 1's argument needs the
  dominator to absorb the dropped group's launches in the same slot without
  breaking a row; within one variant it does (a shorter `event` only lowers
  `window_k`, an `overhang` replaces an `overhang`), across variants it does
  not. Restricting the relation to one variant keeps it a strict partial
  order, so the rest of section 1 stands.
- **Classes and bounds.** Duration classes are keyed by (seconds, nights,
  variant). An `event` class's per-slot bound is the smaller of its time bound
  and `floor(W / seconds)`; an `overhang` class's is 1. `boundsFollowFromRows`
  accepts every `overhang` group, whatever its duration, because `overhang_k`
  bounds it.
- **Certify.** `fitsBudgets` re-reads each slot's `event` seconds and
  `overhang` launches off the class columns, as it reads seconds and nights,
  with `SLOT_TOL` on the seconds and exactly on the count. A doubled launch in
  a problem without a window fails it outright.

**With sleep.** Under a sleep window launches wait for wake-up, so a slot's
offsets are not prefix sums of its seconds and the pair above stops being exact.
Section 13 is how the two combine; it used to be refused outright.

## 12. One timeline for every plan

Every plan `solveWith` returns carries `PlanResult.calendar`, sleep window or
not, and `emit` runs `assertVerified` on every one. Without a sleep window the
layout is exact and needs no search: the MILP's per-slot class columns are
already an assignment the slot rows certified (section 6), so `layOutPlan` lays
each slot's launches back to back from `t = 0` — `event` launches first, then
the slot's one `overhang`, then the `normal` ones, class order within each —
and `launchAt` is the prefix sum of the seconds before it. That order is section
11's exactness argument written out, so a plan the window rows admit lays out
with every doubled launch inside the window by construction. No layout MILP is
built, and `layoutStats` is not reported.

**Balancing.** The MILP's split is whatever it branched to: `order_k` only
sorts the slots by load, so fuel for three 10-hour launches on a 30-hour horizon
came back as one slot flying all three, and the timeline (and the ascension
planner's wait) said 30 hours where 10 would do. Before the back-to-back layout,
`balance` re-deals the class counts longest processing time first: doubled
launches first (`event`, then `overhang`), longest first within each, then the
rest, each to the lightest slot that still keeps every row the MILP's slots
kept: its seconds, its nights, `event` seconds within the window and one
`overhang`. Every launch keeps its class, so the allocation and the joint are
the MILP's. The MILP's own split stands unless the new one's busiest slot is
strictly lighter. With a sleep window the slots are laid out one at a time and
the same imbalance appears (in a fuzz of 120 sleep plans, 46 could finish
sooner by moving one launch, by 13.8 hours on average). There the layout is not
re-dealt but repaired at the end: the busiest slot's last launch moves to the
end of the slot it would finish soonest in, at that slot's first waking instant,
while that finishes the pair strictly sooner, ends by the horizon and keeps a
doubled launch inside the window. Both leave each slot's timeline standing.
Section 16's promotion runs after either, so a launch dealt into the window flies
doubled.

The verifier is the same one (`verify.ts`), handed `sleepSeconds` 0 and the slot
as the horizon, under which its rules reduce to "back to back inside the slot".
It gains one rule for the window, in both directions: a launch is doubled if
and only if it goes up at or before `W`. A launch marked `doubled` goes up at or
before `W` (within `VERIFY_TOL_SECONDS`), and with no window there is no doubled
launch; a 1x launch inside the window is a fault when the menu could have flown
it doubled there (section 16). That predicate is the whole window rule; the
`event` / `overhang` split exists only to state it linearly in the MILP.
`assertVerified` checks each launch's `doubled` against its option's variant, as
it checks seconds and nights. The back-to-back order puts every doubled launch
inside the window; a 1x launch can land there too, and section 16's promotion
flies it doubled.
A no-sleep slot the verifier rejects is a bug and throws, rather than being
trimmed as a sleep-aware one is.

A problem that states nights without a sleep window (section 9's relaxation
alone, which the app never sends) gets the same back-to-back calendar in waking
seconds: with no day, nothing times its nights, which ride along as data.

This replaced a second packer. The calendar is the arrangement the plan was
accepted on, so `optimizeFull` reads every plan's slot summaries off it; it used
to repack a sleep-free plan's totals with its own exact packer (`packing.ts`,
now gone), which could report a different arrangement from the one the MILP
certified, and knew neither nights nor the window.

## 13. The 2x window with a sleep window

A problem may carry both `eventWindowSeconds` `E` and `sleep`. The decision this
rests on, the user's: the plan starts now at `t = 0`, the window is the prefix
`[0, E]` of wall-clock time, nights included, and the player is at the start of
a waking day at `t = 0`, the assumption section 10 already makes. No new input,
no clock time. **Absent means today's problem**: with only a sleep window, only
an event window, or neither, every number below reduces to the one sections 10
to 12 use, and the matrix and the result are the ones they were.
`tests/unit/window-sleep.spec.ts` holds the sleep-only matrix and plan to that
with a zero window, an absent one and doubled copies on the menu; a run of the
arena's own problem builder over seeds 2000-2005 under no window, an 8-hour
sleep window, and the `inside` and `sliver` regimes alone gave hash-identical
matrices and results before and after the change.

The ground truth is section 12's one predicate, which `verify.ts` and the arena's
`calendar.ts` state for the combined case: a launch earns doubled yield
iff its `launchAt` is at most `E` (both directions since section 16); launches go up only while awake; a slot flies
one block at a time. Everything here is how the MILP and the layout get plans
that keep it.

**Rows.** Write `A = 86400 - S` for the waking window and `lambda(E)` for the
last waking instant at or before `E` (`days.ts`, `lastWakingInstant`): `E` itself
when it falls in a waking window, the bedtime before it when it falls in a night.
`window_k` becomes

```
sum over event classes  (seconds + nights * S) * n[c][k]  <=  lambda(E)
```

and `overhang_k` is unchanged. An `event` launch is charged its **block**, the
wall-clock seconds it holds its slot for (`model.ts`, `blockSeconds`), and the
budget is `Model.eventWindowBudget`. Without a sleep window the block is the
seconds and `lambda(E) = E`, which is section 11's row exactly.

_Validity._ Take any calendar the verifier passes, and one slot of it. Launch
times in a slot only increase, so the doubled launches are a prefix `1..j` of
the slot's launches. Label `1..j-1` `event` and `j` the `overhang`. Each block
of `1..j-1` ends before the next launch starts, so they are disjoint intervals
inside `[0, launchAt_j]` and their lengths sum to at most `launchAt_j`. That
launch is doubled, so `launchAt_j <= E`, and it goes up awake, so
`launchAt_j <= lambda(E)`. Both rows hold. The labelling uses only options on
the menu: a block of at most `lambda(E) <= E` has waking seconds at most `E`,
which is the menu's own condition for an `event` copy. So the rows cut off no
real schedule. The same argument bounds each `event` block by `lambda(E)` on
its own, which is why preprocessing now drops an `event` option whose **block**
exceeds the budget, and why an `event` class's per-slot bound is
`floor(lambda(E) / block)` and its group's `slots` times that. Section 11's
bounds, `floor(E / seconds)`, were still valid under sleep (`seconds <= block`
and `lambda(E) <= E`) but weaker, and left a zero-second overnight `event`
copy, which still holds its slot through a night, unbounded; the `overhang`
bound of 1 needs no change.

_What is relaxed._ The row charges blocks and nothing else: the waiting a
daytime launch does for wake-up, and a night no block covers, are free in it.
Three 10-hour launches against a 30-hour window pass it (20 hours of `event`
blocks and the overhang), but real days start them at 0:00, 24:00 and 48:00. So
with a sleep window the rows over-promise, as section 9's night budget does,
and are exact only without one. Nothing in the model proves a doubled launch
starts inside the window; the layout and the verifier do.

Section 14 has since replaced `window_k` with stronger rows that also count
the window's nights and its days one by one; the argument above is the one
section 14's builds on.

**Twins.** Each doubled group carries `twin`, the normal group its launches are
flown as when they miss the window (`model.ts`, `linkTwins`): the group holding
the same flight at 1x — equal fuel, seconds and nights, and exactly half of every
drop, an equality test because doubling is exact in floating point. Preprocessing
never drops the twin of a kept doubled group (it costs the same and its drops
are positive), but dominance can. Then the first kept normal group, in group
order, that dominates the pruned twin stands in: it flies in the same launch
slot in no more seconds, nights or fuel on any axis, so the timeline still
stands and every budget still holds, and it yields at least what the twin would.
One survives, since dominance is a strict partial order (section 1). A menu
with no normal copy at all (a caller's choice; neither generator makes one) gives
`twin = -1`, and such a launch is trimmed rather than demoted.

**Layout: doubled first.** Section 10's ordering heuristics pull the other way —
`connectorsOf` interleaves overnight ships by flex, and `greedyFill` sends the
longest daytime class into the earliest segment — so the window adds an
ordering on top, applied only when a slot holds doubled launches:

- **Connectors.** The doubled overnight ships first — the `event` ones, then
  the `overhang`, the order the rows' argument flies them in — each run
  alternating by flex from the largest, then everything else in section 10's
  order; only the last run holds its smallest flex back for the tail. If that
  order does not stand on its own and the usual one does, the usual one is used;
  the overnight drop loop asks whether either stands.
- **Early take-off.** A doubled ship's head may be the whole waking window
  rather than at most its flex: it takes off as soon as its segment's daytime
  launches are done, and if that is more than its flex before bedtime it lands
  before the night and the next segment starts at the next wake-up with no
  landing. Its block, `waking seconds + nights * S`, then ends by that wake-up
  (`tau + flex <= A` when `head >= flex`), so the timeline still verifies; the
  exact chain still takes every head as large as it can, and a larger head
  still never shortens what the next segment holds.
- **Greedy.** Doubled daytime classes first (`event`, then `overhang`, longest
  first within each), then the rest longest first, so doubled launches take the
  earliest segments. A normal class tries the segments after the last doubled
  ship before the ones before it, so a 1x launch does not push a doubled
  take-off back. When all that places fewer seconds than the usual order, the
  usual order's placement is kept. The layout MILP is unchanged.
- **Within a segment**, doubled launches go up first, shortest first, which
  starts as many of them as early as any order of those launches can; only
  segment totals reach the exact chain, so the order costs nothing there.

All of these act only on a slot holding doubled launches, so a slot without one
is laid out exactly as section 10 lays it out. They are one of the layouts the
judge now chooses among for such a slot (section 14), no longer the only one.

**Settle and demote.** Each slot, once laid out, is settled against the window
(`layout.ts`, `settle`). Launches of equal seconds and nights hold the slot
identically, so among them the doubled ones are given the earliest launch times,
which moves nothing on the timeline. Any doubled launch still starting after `E`
is then **demoted**: flown, at the same `launchAt`, as one launch of the twin.
Which group gives up its launch is the judge's choice among the doubled groups
of that seconds-and-nights key in the slot, the one whose demotion leaves the
highest `logJoint`, exactly as trim chooses a drop; a group with no twin competes
as a drop. A demotion changes yield and nothing about time, so the slot verifies
as it did, less the doubled flag. A slot the verifier still rejects (for its sleep
rule) is retried as in section 10 from what the settled slot holds. Launches that
do not fit real days at all are trimmed as before. There is no cap-and-re-solve:
the plan is re-judged from the demoted and trimmed counts against the empty one,
and everything reported — allocation, joint, per-target, craft split — is
computed from them, so a demoted launch counts 1x. `layoutStats.launchesDemoted`
counts demotions; it is present only with an event window, so a sleep-only
result is unchanged.

**The layout MILP is not told about the window**, which the brief preferred as
a constraint over a filter. It decides only how many launches of each daytime
class go in each segment, and missing the window is never a reason a launch
cannot be placed, only a reason it earns less. A row holding doubled launches
inside the window would therefore have to come with a per-launch choice between
doubled and demoted, priced against waking time placed, and only the judge knows
that price. Without the choice, the row would turn demotions into trims, which is
worse. So the window acts on the layout through order (above) and through
`settle`, which is exact for what it does rather than a filter: it never removes
a launch the twin can fly.

**Heuristic, stated.** The ordering is a heuristic; another order may start more
doubled launches inside the window, so what is demoted is an upper bound on what
had to be. Demotion, like trimming, is not monotone: a longer window or a shorter
night can lay out worse, which the arena's A10-sleep and A11-window see.

**The hard rule stays hard.** `assertVerified` is unchanged and runs on every
combined plan: each launch's `doubled` against its option's variant, each slot
against `verify.ts` with the window, and the calendar against the allocation.

**Measured.** Arena smoke tier (seeds 2000-2003), on a quiet machine. No run
had a C0 or C1 violation: every combined plan's calendar passed the arena's own
checker. Combined runs report soft monotonicity violations, of the kind section
10 already predicts for trimming, in more places than sleep alone: the layout
cannot always start what the rows doubled, so a relaxed problem can come back
demoting more. Over the four instances, plans demoted / doubled launches flown
at 1x were 8 / 18 with sleep and window both drawn per seed, 54 / 167 with 8
hours of sleep and a 48-hour window, 101 / 222 with 8 hours and a 1-hour window,
and 29 / 142 with 12 hours and a window of three quarters of the horizon; with
sleep alone (where only A11-window's steps carry a window) 3 / 5. Doubled ships
in window order and taking off early (above) were added after the first combined
run: they cut the drawn run's demotions from 77 launches to 18 and its
violations from 10 to 6, with mean log10(joint) unchanged at -6.845.

What still demoted was put down here to section 10's own day model: a
variant's nights are fixed, so an overnight ship launched early still holds
every night it was cut for, and a daytime 1x launch the greedy has nowhere else
to put can sit before a doubled ship. Measured (section 14), that was the
smaller part. Most demotions came from the rows, which charged an event launch
nothing for waiting for wake-up, and from the layout, which fell back to
section 10's order whenever that placed more seconds, however many doubled
launches it pushed out of the window.

## 14. Promise and delivery under sleep

A plan with a sleep window is a promise first and a timeline second. The MILP's
plan is judged before layout and recorded as `layoutStats.plannedLogJoint`. What
the layout delivers is judged again after trims and demotions. The arena prints
the two side by side for every unperturbed instance (`tests/arena/ARENA.md`,
"Running it"). Under sleep and a 2x window together the gap was large: over seeds
2000-2039 the delivered joint sat 0.07 to 0.16 log10 under the promise, and the
plans flew hundreds of doubled launches at 1x. This section is what closed most
of that gap. It is in three parts: rows that promise less of what cannot fly,
a layout the judge chooses, and a timeline that uses the waking time a section 10
connector leaves idle.

**What was wrong, measured.** Arena seed 2006, 8 hours of sleep, a 48-hour
window. The section 13 `window_k` row let one slot plan 48 one-hour event
launches, and the window has 32 waking hours. Another slot planned an overhang
over three nights, cut to 32 waking hours, beside a 12.96-hour daytime ship
(seed 2001, a 1-hour window). That pair fits the slot and night rows. But the
overhang has to go up within the first hour, and from there its block holds 40
waking hours, not 32, so the daytime ship has no room before or after it. In
the layout, section 13's fall-back to section 10's order whenever that placed
more seconds once pushed 47 doubled launches of one slot out of the window to fit
1x ones. The layout MILP, which maximizes seconds placed, could do the same. The
overnight-ship model of section 10 (a ship holds every night its class counts)
did cost waking time, but only a doubled ship ever takes off early enough to land
a night early, and that was the smallest of the three.

**Canonical labels.** The validity arguments below take a real schedule (an
option and a launch time per launch, each launch going up awake after the one
before it in its slot has landed) and label each launch with the variant for
the nights it physically flies through, `m*`. That variant is on the menu, since
`m*` lies between `sleepVariants`' fewest and most. Its block, `waking + m* S`,
ends no later than the first waking instant after the landing. So the labelled
calendar verifies, and flies the same options at the same times with the same
yields and doubling. A launch's **reach** is the interval from its launch to the
first waking instant at or after its landing. Under this labelling a launch
charges at most the waking seconds of its reach and exactly the nights inside
it, and reaches in one slot do not overlap. Section 9's and 10's rows are valid
for schedules read this way. The rows below need only the event launches read
this way, and an event launch is never a slot's last.

**Rows.** Write `lambda` for the window's last waking instant (section 13),
`N_E = floor(lambda / D)` for the nights wholly before it, `A = lambda - N_E S`
for the waking seconds before it, and `P = lambda - N_E D` for the part of the
waking window it falls in (`days.ts`, `windowShape`; a whole window when the
window closes in a night). Per slot:

```
window_k        sum over event classes  seconds * n[c][k]  <=  A
windownight_k   sum over event classes  nights  * n[c][k]  <=  N_E
windowfit_k_q   sum over event daytime classes  u^(q)(seconds / W) * n[c][k]
                  + sum over event overnight classes  (nights - 1) * n[c][k]
                  <=  N_E + min(1, floor((q + 1) P / W) / q)
```

with one `windowfit` row per `q` among the event daytime classes, as section
10's fit rows. A doubled class is also charged more in `slot_k`: the fewest
waking seconds its block holds when it starts awake at or before `lambda`
(`leastWakingIn`), when that is more than its seconds. The charge is rounded
down a microsecond so float error never takes it past that least.
`Layout.classCharge` carries the coefficient. `fitsBudgets` re-reads every one
of these rows except the fit rows, as it always has. An event option charging
more than `A` or `N_E` is dropped, and an event class's per-slot bound is
`min(floor(A / seconds), floor(N_E / nights))`.

_Validity._ In a slot of a canonically labelled schedule the doubled launches
are a prefix `1..j`. Label `1..j-1` `event` and `j` the `overhang` (section 13).
The event launches' reaches are disjoint and end by `launchAt_j <= lambda`. They
hold no more waking seconds than `[0, lambda]` does, which is `A`, and no more
nights than lie wholly before `lambda`, which is `N_E`. An event daytime launch
(`m* = 0`) goes up and lands inside one waking window, and that window lies
before `lambda`: one of the `N_E` whole ones, or the part `P`. Under `u^(q)`,
launches inside one whole window sum to at most 1 (section 10), and launches
summing to at most `P / W` sum to at most `floor((q + 1) P / W) / q`, since
`u^(q)(x) <= floor((q + 1) x) / q` for every `x`. An event launch over `m*`
nights flies straight through `m* - 1` whole windows before `lambda`, which no
daytime launch can use. So the fit row holds. For the slot charge, a doubled
launch goes up at some `t <= lambda`, awake. Its reach contains `[t, t + block]`,
whose waking seconds are at least the least over every such `t`. The reaches are
disjoint, so the slot row holds with the larger charge. Without a sleep window
`A` is the window, `N_E` is 0 and the night row has no entries, there is no fit
row, and every charge is the seconds: section 11's matrix exactly. With sleep and
no window nothing is doubled: section 10's matrix exactly.

_Still relaxed._ The rows pool the window's waking seconds, and the fit rows see
one length at a time. The overhang's charge does not know that the event
launches before it push its start later, and so push more waking time into its
block. The layout still demotes, much less often.

**Layout, chosen by the judge.** A slot holding a doubled launch is laid out
several ways (`layout.ts`, `ATTEMPTS`): section 13's order; the same with no 1x
daytime launch before the last doubled ship (`strict`), its layout MILP pinned
to the greedy's doubled placement so seconds cannot buy a 1x launch with a
doubled one; and section 10's order alone. Each of the three is also tried with
folds (below) where it had a ship to fold. Each attempt runs to the end:
layout, settle, demotions, trims, verifier retries. The judge then scores the
plan's counts. The best is kept, and ties go to the earlier attempt. The
attempts start from the same counts, and the kept one's counts and plan
statistics are restored, so later slots see only what was kept. Layout MILP and
margin counts include every attempt's. A slot without a doubled launch has one
layout, section 10's, as before.

**Folds.** A doubled ship that takes off before bedtime by more than its flex
and a night (`head >= flex + S`) lands in a waking window a night before its
class says. Folded, it is a connector over `nights - 1` nights with flex
`flex + D`, which forces exactly that early a take-off. A null connector follows
it, so the slot's nights still sum to its own and the rest of the landing day is
a segment. The block, `waking + nights * S`, ends exactly at the landing, so the
timeline verifies as it is. A fold with one night is a connector over none,
splitting one day in two. The calendar keeps the class's own option, and so its
nights. A fold changes when the next launch may go, never what the slot's rows
counted.

**Re-timing, the night model for every slot.** Section 10's segments time each
overnight ship as flying through every night its class counts. They also keep
each daytime launch inside one waking window, though sleep forbids launching and
nothing else. When the segments leave daytime launches unplaced, the slot is
re-timed in the same order (`compact`): each launch goes at the first waking
instant the block before it leaves. By induction no launch goes up later than it
did, so the timeline still verifies, and earliest start is optimal for a fixed
order. A ship that lands mid-day now frees the rest of that day. A daytime launch
can go up before bedtime and land in the night: two 10.8-hour launches a day
where the segments fit one. What the segments could not place goes on the end,
longest first, while it still ends by `H`, and only the rest is trimmed. The
re-timed slot is kept only when it places a launch more, so a slot that lost
nothing keeps section 10's timeline launch for launch. A calendar can now show a
launch at its class's nights that lands earlier than they say, or a daytime
launch landing in the night. The verifier, which reads blocks and not physics,
accepts both, and so does the arena's.

**Measured.** Seeds 2000-2039 (`tuning-bench.spec.ts`, `BENCH_BASES=1200`,
one solve per seed, judged by the harness), before this section's rows and layout
and after them. The table gives mean delivered log10(joint), mean promise minus
delivery, and launches trimmed / demoted, over the 39 seeds that score (2036
scores 0 in every regime, before and after: its targets have no ceiling).

| regime                 | delivered before | after   | gap before | after  | trimmed / demoted before | after     |
| ---------------------- | ---------------- | ------- | ---------- | ------ | ------------------------ | --------- |
| 8 h sleep, inside      | -6.3066          | -6.2447 | 0.0744     | 0.0116 | 183 / 508                | 270 / 100 |
| 8 h sleep, sliver      | -6.4647          | -6.3190 | 0.1572     | 0.0092 | 161 / 58                 | 179 / 2   |
| 12 h, straddle-under   | -6.1445          | -6.0966 | 0.0714     | 0.0196 | 152 / 1210               | 250 / 180 |
| sleep and window drawn | -6.3987          | -6.3489 |            |        | 153 / 272                | 238 / 133 |

Per seed, 22, 20, 23 and 13 seeds improved, and 3, 1, 4 and 2 got worse, by at
most 0.072 log10. Plans that trade demotions for trims are what the judge
preferred. Sleep drawn per seed improved one seed and left the rest as they
were. Neither window, the 48-hour window alone, and 8 or 12 hours of sleep alone
gave hash-identical plans, allocation, reported joint and calendar, on all forty
seeds. Pulled apart: the rows alone, under section 13's layout, were worse
with 8 hours and the 48-hour window (-6.3406). The layouts chosen by the judge
did most of the rest, and folds and re-timing added up to 0.002 log10 each,
never making a seed worse. Arena smoke tier (2000-2003), before and after: no C0
or C1 failure in any regime. Soft violations went from 21 to 2 with 8 hours and a
1-hour window, 15 to 7 with 12 hours straddling, and 6 to 4 drawn. They went from
11 to 13 with 8 hours and the 48-hour window, and from 1 to 2 with the 48-hour
window alone (both A10-sleep steps, which carry sleep). Mean log10(joint) went
from -6.868 to -6.674, -6.576 to -6.556 and -6.845 to -6.845. With 8 hours and the
48-hour window it went from -6.551 to -6.554, the one smoke regime that fell: seed
2001, whose new plan wants a doubled ship to land in a night the layout cannot
yet give it (a ship flying through one night more than its class says, the
mirror of a fold). Over forty seeds the same regime gained 0.062. Every other
smoke regime's quality was unchanged.

## 15. A saturated target's grid

`optimizeFull` with 10-second and 40-second ships on a 3-day horizon returned
the empty plan, at probability 0, with or without sleep or a 2x window. Thousands
of launches fit a slot, and each is worth a score of 0.1, so the target's ceiling
`theta` was about 8193. Section 5's grid puts its floor at sigma `1e-2`, a score
of 82, where `log(1 - e^-s)` is 0 to every bit of a double. Every tangent cut
there is flat, the slopes under `FLAT_CUT_SLOPE` dropped outright (section 3).
The deepest cut, which section 4 relies on to price abandoning a target, priced
it at nothing. So the MILP's optimum was the empty plan, the judge rejected it
against the empty plan, and the empty plan was returned. This is not a
search-budget effect: it is the optimum of the MILP as written.

`extendedGrid` (`milp.ts`) continues such a target's grid below its floor, at
the grid's own spacing, until a point lies at a score of `DEEPEST_CUT_SCORE`
(`1e-2`). There, abandoning the target costs about 5.6 nats. The extension
applies only when the floor lies past a score of `FLAT_FLOOR_SCORE` (4), where
the deepest cut prices abandoning at under a tenth of a nat. Every target whose
ceiling is under `4 / 1e-2 = 400` keeps its grid exactly. The 600- and
2400-second ships of the same horizon (`theta` near 136) are one such target,
and their plan is the one they always got. `tests/unit/saturated-target.spec.ts`
holds the reported case to a plan near certainty under each setting. The added
cuts are ordinary tangents, so the envelope still over-estimates `g` (section 3),
and the judge still decides (section 5).

## 16. Doubled if and only if inside the window

The game doubles every launch that goes up inside the window, whatever the plan
says. So the rule is two-sided: a launch is doubled **if and only if** its
`launchAt` is at most `E`. Sections 12 and 13 held only one side, a doubled
launch inside the window. `settle` demotes a doubled launch that misses it but
never doubled a 1x launch that made it, and the MILP is indifferent between the
two whenever the objective saturates. Over the review's 240-instance fuzz
(synthetic menus through `capacityVariants`), 1 plan in 80 with the window alone
and 6 in 80 with sleep as well flew 1x launches inside the window, and their
timelines showed un-badged launches above the "2x capacity ends" divider.

**Promotion.** After `settle` on a sleep-aware slot, and after the back-to-back
layout on one without sleep, `promote` (`layout.ts`) labels the slot's launches
inside the window canonically: the last one is the slot's `overhang`, the
earlier ones `event` launches. Each earlier one ends before the last one goes up,
which is at most `E`, so their seconds sum to at most `E` and each has an `event`
copy on a menu from `capacityVariants` (whose condition is `actualTime <= E`);
the last always has an `overhang` copy. A 1x launch is flown as its group's
`copy` of that variant (`model.ts`, `linkCopies`, the reverse of `twin`), the
group chosen by the judge when its class has more than one with a copy; only a
launch the menu itself could have doubled there is promoted. A doubled launch
with the other label is relabelled to the same flight's other copy, which
changes no yield. When an earlier `overhang` has no `event` copy to become, the
last launch takes the `event` label instead if it can, so the slot keeps one
`overhang`. Launch times do not move, so the slot verifies as it did.

**When the model has no copy.** A normal group's own doubled copy can be missing
from the model while the menu has it. Dominance can prune it; on a menu from
`capacityVariants` the dominator then has a normal twin that dominates the group
itself and prunes it too, unless that twin's columns are not bounded by the rows
(`boundsFollowFromRows`), as a zero-second daytime launch's are not while its
`overhang` copy's are. Preprocessing can drop
it: under sleep an `event` copy whose waking seconds or nights exceed the
window's (section 14), which a launch can only need when the calendar flies it
through fewer nights than its variant counts. `copy` then names the first kept
group of that variant that dominates the copy it would have had: no more
seconds, nights or fuel, at least every drop, so its block is no longer and the
slot still verifies. With no such group the launch stays 1x, and a last pass
before the calendar is written either flies it as a group of its class the menu
holds no copy of for that place, or, when none is left, drops it, the judge
choosing the group, counted in `launchesTrimmed`. Dropping a launch only frees
its slot. Neither branch fired over the review's fuzz (sleep, window and both).

**The joint.** A promotion moves one launch onto the same flight at twice every
drop, or onto a group that dominates that, at no more fuel. More supply never
lowers the judge's optimum, so promotion cannot lower the joint. The plan is
re-judged from the promoted counts as it is after trims and demotions (section
10), and `layoutStats.launchesPromoted` counts promotions beside
`launchesDemoted`. `tests/unit/window-promotion.spec.ts` holds a plan with
nothing trimmed or demoted to at least what the MILP promised.

**The verifier and the arena.** `slotFault` holds a 1x launch inside the window
to the menu: it is a fault when the menu holds the same flight as an `overhang`
(for the slot's last launch at or before `E`) or as an `event` launch (for an
earlier one). `assertVerified` reads those copies off the menu's numbers
(`doubledCopiesOnMenu`: equal seconds, nights and fuel, exactly twice every
drop), never off the model. A 1x launch is held to this only a microsecond clear
of `E`, where a doubled one is admitted a microsecond past it, so no launch at
the edge has to be both. The arena's `calendar.ts` states the same rule
independently, finding copies by the ids its own `capacity.ts` gives them. The
canonical labels keep the arena's labelled packer satisfied (`event` seconds of
a slot within `E`, one `overhang`), so `feasible` accepts a promoted plan, and
D1, D2 and M3 test moves from it as before.

**Measured.** The same 240-instance fuzz after the change: no 1x launch inside
the window in any plan, no calendar fault from the arena's checker, no throw.
