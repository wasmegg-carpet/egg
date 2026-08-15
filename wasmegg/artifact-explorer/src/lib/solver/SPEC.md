# The plan as a mixed-integer program

The shipped planner. `src/lib/optimizer-core.ts` calls `solveWith` from `oa.ts` on a
module loaded by `loadHighs`, and the arena enters the same pair through a shim
(`src/oracle/arena/solvers/highs/`), so the solver users run and the solver the
harness measures are one code path. `src/oracle/arena/ARENA.md` states the problem;
this file states the method.

The whole problem — mission counts per slot, crafts as flow over the conservation
polytope, fuel, packing — is one mixed-integer program handed to branch-and-bound.
The one thing that cannot be stated directly is the objective's `log(1 - e^-s)`,
handled by **outer approximation**: hold each target's contribution under a family
of its tangents and solve the resulting MILP. The grid is fixed up front; there is
exactly one MILP per plan.

Section numbers are cited from code comments throughout `src/lib`. They are
stable; add rather than renumber.

## 1. Preprocessing

`model.ts` takes the downward closure of the targets, normalizes fuel to a budget
of 1 and time to a per-slot budget of 1, drops options that cannot fit a slot or
carry nothing useful, and merges exact duplicates into groups under a numeric
canonical key. Together these make the result independent of the order the user
clicked buttons.

## 2. Columns

A column summing each mission's allocation across slots keeps every row that does
not care *which* slot a mission went into (chiefly craft conservation) at one
nonzero per group instead of three.

Crafts stay continuous deliberately: the judge re-optimises the craft split as an
LP for whatever allocation it is handed, so integralising crafts here would
optimise a different objective from the one being graded.

Mission columns are capped by fuel, by time and by the option's own limit.
`MAX_PER_SLOT` and `GROUP_CAP` stand in when one of those gives no bound at all (a
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

Row names below are this document's; `milp.ts` builds rows positionally and emits
them as `r<n>_<i>`, so they are not greppable identifiers.

Two rows are the reason to reach for a MILP at all.

**`slot_k` states the packing constraint** — three rows, one per slot, rather than
a volume bound a repair pass has to make true afterwards. A plan that solves this
model packs by construction, and the assignment is the packing witness.

**`score_t` puts the craft split in the same matrix**, so the solver trades a
mission for a craft directly instead of choosing missions first and accounting for
crafts afterwards.

Slot rows are in raw seconds, not normalized: HiGHS accepts an integer solution
violating a row by up to `mip_feasibility_tolerance`, which is absolute on row
activity, so a normalized row would license overfilling a slot by that fraction of
the whole horizon — seconds of it on a month-long plan.

`order_k` forces slot loads non-increasing. Without it every plan appears `slots!`
times and the tree spends its budget rediscovering the same plan in a different
order.

### Row scaling, and the ingestion window

HiGHS discards any matrix entry at or below `small_matrix_value` (default 1e-9)
while *ingesting* a model. A discarded entry does not weaken a row, it deletes a
term: lose the fuel row's coefficients and the fuel budget stops existing, with
nothing anywhere saying so. The margin is not comfortable — fuel costs are
normalized by the tank, the smallest ever observed was 2e-8, and the arena's
A1-fuel check doubles the tank, halving that.

**Setting the option is not the fix.** The wasm build's `solve(text, options)`
writes the model to its virtual filesystem, calls `Highs_readModel`, and applies
options only *then*, so everything governing ingestion (`small_matrix_value`,
`large_matrix_value`, `infinite_bound`) is set too late and silently does nothing.

So `Rows.end` scales instead; multiplying a row and its bounds by a positive
constant leaves the feasible set unchanged. A row is scaled only when its smallest
entry falls below `SAFE_COEFFICIENT = 1e-6`, a thousand times clear of the filter,
so rows in ordinary magnitudes are left alone.

The other end of the window bounds that scaling: HiGHS *rejects* a model carrying
an entry above `large_matrix_value` (default 1e15), failing in the reader and
surfacing as a plan that could not be computed at all. The `score_t` rows are
where both ends bite at once — `theta_t` runs down to ~1e-13 against a craft
coefficient as large as `Q_CERTAIN_PROXY` (1e4), a dynamic range of ~1e17 inside
one row — so normalizing the small side to 1 would put the other at ~2.8e16 and
make the model unreadable. Hence
`Math.max(1, Math.min(1/smallest, SAFE_LARGE_COEFFICIENT/largest))`, where
`SAFE_LARGE_COEFFICIENT = 1e12` keeps three decades of headroom under the reader's
limit and the outer `max` stops a row ever being scaled *down*. A row whose own
dynamic range exceeds the window cannot be made to fit; the least bad answer is
keeping its large entries readable.

Tangent cuts are not the hazard, despite carrying the extreme slopes elsewhere: a
cut's two entries are `+1` and `-theta_t * g'(sigma_t * theta_t)`, and section 4's
floor bounds the second by `1/SIGMA_FLOOR = 100`.

The mechanism only lifts small entries clear of the filter. Because it never
scales down it cannot rescue a row whose largest entry alone exceeds 1e15 —
nothing today is near that, but a new row in large units is unprotected.

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

The scale LP maximizes a *raw* score, and raw scores run to 1e-7 and below.
`dual_feasibility_tolerance` is absolute on reduced costs, so at that magnitude
every reduced cost at the all-zero vertex is inside tolerance and HiGHS reports
optimal at zero — with no warning — while a feasible point three decades better
sits in the same polytope. A zero `theta` then reads as "target unreachable" and
returns an empty plan.

`SCALE_LP_OBJECTIVE = 1e9` multiplies every reduced cost, lifting raw scores clear
of the tolerance. Scaling an objective does not move its argmax, and `theta` is
read off the *column* rather than the objective value, so it costs nothing.
`dual_feasibility_tolerance` is tightened one order alongside it, to 1e-8, and
only one: at HiGHS's documented minimum of 1e-10 the simplex fails outright with
`HiGHS error -1` from `Highs_run`.

### Two constants that are not the judge's

`concave.ts` exports `gPrime`, clamped at 1e12 so the Frank-Wolfe linearizations
stay finite. The cut generator must **not** reuse it: at `s ~ 1e-13` the clamp
would be active at every tangent point at once, every cut would come back with the
identical slope, and the outer approximation would carry no curvature at all.

`Q = -log(1 - p)` is `+Infinity` when a craft is certain, and infinity cannot enter
a matrix. `Q_CERTAIN_PROXY = 1e4` is large enough that one craft saturates `g` to
every bit of a double, and small enough to stay mid-window in the matrix. Every
matrix reads that one constant — this MILP and the seed LP `optimizer-core.ts`
compiles for the reported craft split — so a plan is never chosen against one
value of certainty and priced against another. The judge (`evaluator.ts`) still
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

What comes back is a *judged* plan, never the MILP's answer on faith: the
incumbent is scored by `evaluator.ts`, an independent re-derivation of the
objective, so the linearized model steers and the real objective decides. A plan
that does not strictly beat the empty plan is dropped — a node-limited search can
return an allocation scoring probability zero, and the empty one at least spends
nothing to do that.

The judge has two precisions, and which one runs is not obvious. Selection uses
`STEERING_PRECISION` (gap 1e-7, 600 iterations) — it only has to rank two plans.
`EXACT_PRECISION` (1e-12, 2000) runs only under `report: true`, which the arena
passes and the app does not, since `optimizer-core.ts` re-derives its own reported
figures downstream. So loosening `STEERING_PRECISION` changes which plan users
get; loosening `EXACT_PRECISION` changes only what the arena records.

## 6. Decode and certify

Both budgets are rows of the model, so a decoded plan is feasible by construction;
`certifies` says so out loud rather than assuming it, re-checking the fuel row
against the rounded counts and reading the three slot loads straight off the
MILP's own columns — the packing witness that summing over slots threw away.

`SLOT_TOL` is 1e-9 not for resolution — the drift it absorbs is three decades
smaller — but because that is the judge's own packing tolerance
(`src/oracle/arena/pack-feasibility.ts`). It is a ceiling rather than a preference:
anything looser certifies plans the judge calls infeasible, an arena C1 hard
failure.

`FUEL_TOL` is the same figure and not the same argument. Fuel is normalized to a
budget of 1, so 1e-9 there is *relative* slack where `SLOT_TOL` is absolute
seconds, and the judge-matching argument does not carry over — it is justified
only as float noise against a budget of 1. If fuel ever becomes the constraint a
plan is rejected on, re-derive this one rather than trusting it.

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

`DEFAULT_TUNING` is `maxNodes: 400`, which is a latency choice: quality is flat
across every tuning ever swept (all means inside 0.005 log10), so what the number
buys is a solve that stays around a second on a production instance and a lower
rate of arena monotonicity violations, not a better plan. Two rules for anyone
re-tuning it. The harness reproduces exactly, but the same tuning's severity
swings 3x across seed bases, so **treat any single-campaign delta under about 1.5x
as noise**. And the floor is hard: `maxNodes: 0` returns probability zero on
*every* instance even at `mip_heuristic_effort: 1.0`, because the root heuristics
never find an incumbent.

## 8. The backend

`highs.ts` loads `highs` (lovasoa/highs-js), HiGHS compiled to WebAssembly — the
build that can ship, since `artifact-explorer` is a browser app and a native addon
cannot go there. The module exposes one entry point taking a model in CPLEX LP
format, so every solve serializes the matrix to text and has HiGHS parse it back.
That round trip dominates a *continuous* solve and is under 5% of an expensive
MILP one; building the text in JS is negligible beside either.

Asset resolution is why this is a loader function rather than a bare import. Left
alone the Emscripten glue looks for `highs.wasm` beside itself, which is right
under Node and wrong inside a bundled worker; handing it the URL from
`import wasmUrl from 'highs/runtime?url'` lets Vite emit and fingerprint the file
like any other asset.

Two properties of the text interface are worth knowing, both silent when got
wrong:

- Options are applied *after* `Highs_readModel`, so nothing governing ingestion
  takes effect (section 3).
- A solution's `Index` field is the column's position *in the LP file*, the order
  the reader first saw it, not the order the model built its columns in. Mapping
  through `Index` type-checks, runs, and reads the wrong columns.

### Presolve, and the throw it used to cause

`SOLVER_OPTIONS.presolve` is `'off'`, measured rather than assumed: across arena
instances it was 11-17% faster off, with an identical joint probability on every
one of them.

**Turning it off also removed a failure path.** HiGHS can fail inside *presolve*
on a model it reads and solves perfectly well without it, throwing "HiGHS error
-1" out of `Highs_run` — not out of the reader, so this is not section 3's
ingestion window. The trigger is `mip_feasibility_tolerance` at 1e-9, the
interaction ERGO-Code/HiGHS#1578 reports.

Neither obvious alternative is a fix. `random_seed: 1` also clears the throw,
which marks it as a knife-edge numerical coincidence — so changing the seed would
settle this instance and silently pick a different one to fail on. Loosening
`mip_feasibility_tolerance` would weaken, on *every* solve, the guard keeping
HiGHS's integer solutions on the judge's packing scale (section 3). Nothing
gentler is available either: `presolve_reduction_limit` and `presolve_rule_off`
are not in this package's typings, and of the three values it does expose,
`'choose'` still throws.

Presolve only reformulates; it cannot change the feasible set, so running without
it can turn a failure into an answer but never a wrong answer into a right-looking
one.
