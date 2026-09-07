# The Path of Virtue mission optimizer

Given a set of budgets and game state (player's ships, a fuel budget, a per-slot time horizon, etc.), the optimizer
picks integer counts of each launch option so as to maximize the chance of ending
up with a legendary of **every** artifact the player selected.

## The objective

Each selected target `T` has a linear score:

$$
score(T) = - \log(1 - p_{CraftLegendary_T}) * crafts_T + \lambda_T
$$

$crafts_T$ is how many copies of `T` the player's inventory merged with
the dropped items from the optimizer's selected missions supports crafting, and
$\lambda_T$ is `T`'s expected direct legendary drop count. The search then maximizes $F$.

$$
F = \sum_T g(score(T))
$$
$$
g(s) = \log(1 - e^{-s})
$$

$e^F$ is exactly the joint probability of getting a legendary of *every*
selected target, so `F` is a valid stand-in for that probability that is
compatible with the MILP.

One consequence worth knowing: $g'(s) = 1/(e^s - 1)$, so $g$ flattens as
$score_T$ grows and the search stops distinguishing plans that differ only in how
far they overshoot an already-certain target. Above $P_T = 0.999$,
the next craft buys nearly nothing, and, with several targets, that budget belongs
to whichever one is still short — but it means near-saturated instances settle
for any plan inside the epsilon band rather than the score-maximal one.

## The tangent outer approximation

$\sum_T g(score_T)$ is not linear so it must be linearized to work as an MILP objective.
$g$ is concave, so every tangent line to $g$ lies on or above it; this property makes the
tangent envelope a valid **outer approximation** — a piecewise-linear concave
*overestimator* of $g$. The solved LP is a relaxation and its optimum is an upper bound on the
true one. One envelope variable $z_T$ per target with a row
$z_T <= \alpha_k + \beta_k * score_T$ per breakpoint turns the maximization into a linear
program: the LP drives each $z_T$ up to $\min_k(...)$.

The envelope is an *upper* bound on $g$, so this always slightly
**over-estimates** the true joint objective. That is safe only because it is used
for search ranking and pruning and never for reporting — the UI's numbers come
from `alphaToProb` on the final craft counts and drop rates. If you change
anything about the tangent grid, this is the property to preserve: an
over-estimate reorders candidates slightly, whereas letting the approximation
leak into reporting could make the tool lie.

The grid and `ENVELOPE_SHIFT` are private to `value-function.ts`; the planner
(`solver/`) builds its own outer approximation from scratch and shares nothing
with this one.

### Recovering the exact craft split

The tangent grid's nearest-tangent approximation of $g$ is poor below its first
breakpoint, so the split it recovers is biased whenever a target lands on a tiny
craft count — fine for ranking, not acceptable for reporting.

So the tangent-LP split is only a seed. `refineJointCraftSplit` then recovers the
split maximizing the *exact* objective at the final chosen inventory, over the
recipe's craft-conservation polytope, by **Frank-Wolfe with an exact line
search**: linearize $g$ at the current scores ($weight_T = g'(score_T) * Q_T$, by
the chain rule), maximize the resulting weighted-sum craft LP — the ordinary
`compileInnerLp`, whose polytope is identical — and golden-section search along
the segment to that vertex. Each iterate's true objective is non-decreasing and
the iteration converges to the polytope optimum, stopping when no target's score
moves by more than 1e-11 or at 100 iterations, whichever comes first. It runs once
per returned solution, never in the search loop.

One caveat on the gradient it linearizes against: `gPrime` is capped at
`GPRIME_CAP = 1e12`, and at the scores the arena generates ($s \sim 10^{-13}$,
$g' \sim 10^{13}$) that cap is active, so the weights are clipped rather than
exact. It preserves the direction well enough for the line search, but it is why
`solver/milp.ts` must not reuse `gPrime` for its cuts (`solver/SPEC.md` section 4).

### Envelope slack

Over the 26-point grid the worst log-space over-estimate is ~4.5e-2. The grid is
geometric, so that worst case recurs in every interval rather than sitting at one
bad spot; the worst probability-space over-estimate is ~2.8e-2, around $s = 1.2$.
**That is looser than the deltas worth chasing between two good plans**, so where
the envelope misranks two plans no amount of search or packing work recovers the
difference. Below the first breakpoint log error grows without bound, which is
why the final split is refined off-grid; probability-space error stays under 1e-5
there.

**The first breakpoint and `ENVELOPE_SHIFT` are coupled, silently.** Every $z_T$ is
negative, and `lp.ts` assumes $x \geq 0$, so `ENVELOPE_SHIFT = 50` lifts them.
That is correct only while $50 > -\min_k \alpha_k$, and $\min_k \alpha_k \approx
-12.5$ is set entirely by the smallest breakpoint, $10^{-5}$. Moving that
breakpoint down about two decades drives the shifted $z$ negative, where the LP's
non-negativity clips it and the seed split comes back wrong with no error
anywhere. Lower the first breakpoint and `ENVELOPE_SHIFT` has to move with it.

## Search structure

`optimizeFull` states the whole problem as one mixed-integer program and hands it
to HiGHS. The model, the outer approximation and the numeric traps in both are in
`src/lib/solver/SPEC.md`; what follows is only what a reader of this file needs.

**Why an MILP.** An MILP allocates missions *per slot*, so a solution packs by
construction, and the crafts are continuous columns over the same conservation
polytope. This eliminates the need for any repair phase, and the craft split is
optimised in the same matrix.

**What it costs.** About a second on a production-scale instance.

**What is still wrong with it.** Invariant violations across the arena sweep are
all of the form "a more constrained problem scored better", all small, and all
attributable to the node budget rather than to the model. Investigation showed
even extreme node budgets didn't fully resolve the invariants so the current
deployment was tuned to balance runtime with the frequency and severity of the
violations. There is also a latent
issue the sweep does not isolate: the per-target scale $\theta_t$ is an LP maximum
computed *subject to the budgets*, and the tangent grid is placed in units of
theta, so changing a budget re-approximates the objective rather than merely
enlarging the feasible set. The A1/A2 monotonicity invariants are not theorems
even at proven optimality until that is fixed.

## The worker boundary

The planner runs off the main thread (`optimizer.worker.ts`). Every solve is
around a second, and the first one in a worker's life also fetches and
instantiates the WebAssembly module.

**Launch-option enumeration stays on the main thread.** It is the only step that
needs the loot dataset, which the main bundle already loads for the mission
views; enumerating in the worker would put a second copy in the worker bundle.
For the same reason `optimizer.worker.ts` imports `optimizeFull` directly rather
than through the `lib` barrel, which re-exports the loot data.

The traffic goes the other way too: the barrel does not reach `optimizer-core` at
all, and the in-process `optimize()` the specs drive lives in
`tests/unit/spec-helpers.ts`
precisely so that edge does not exist. Components import the barrel, and a static
import there would drag the solver and its Emscripten glue into the main chunk.
Keeping it out by module graph rather than by a lazy import is what makes it hard
to undo by accident.

`optimizer-worker-protocol.ts` exists because structured clone preserves Maps and
plain objects but **drops prototypes**. Every payload is plain data except
`ship`, a `MissionType` whose entire API is getters over two numeric fields; a
cloned copy would arrive with the fields intact and every getter gone, failing
far away from the boundary in whatever template reads `ship.shipName`. So the
ship is narrowed to its two fields on the way out and reconstructed on the way in.

`optimizer-client.ts` reuses one worker across runs and numbers requests so only
the newest one's result is delivered — with auto-compute on, a burst of input
changes queues several solves and every result but the last describes settings
the user has already moved past. A superseded or torn-down request resolves with
`null`, which callers read as "no result is coming, leave state alone".

The request carries the problem and nothing else; the search budget is fixed at
compile time in `DEFAULT_TUNING`, as a node count rather than a wall clock, so the
same request produces the same plan however loaded the machine is.

## Inventory and previous crafts

A target's `legendaryCraftProbability` depends on how many times the player has
already crafted it. With a save loaded each target uses **its own** crafted count;
a manual override applies to **every** target. `buildRecipeDag` implements this by
treating an undefined `previousCraftsOverride` as "read per-target". The override
feeds `legendaryCraftProbability` only — pricing always reads the real counts.

`computeBaseYield` counts the player's stock across all rarities, because each
can be demoted to common. This is "how many copies you can feed a recipe",
never "you already own a legendary"; the legendary side of the objective comes
solely from mission drops.

A target is skipped only when nothing in the DAG consumes it. Such a node has no
conservation row in the inner LP, so owned copies could never be spent and would
only look like free progress. A target that *is* an ingredient of another keeps its
stock, which can only relax the consumption side of its row.

## Per-target display attribution

For a multi-target solution, the LP crafts a shared component once and splits it
across the targets that consume it, so `craftPrimal` / `finalYieldVector` are
solution-wide pooled totals. `computeCraftChainTree` attributes each node's pooled
quantities to a target in proportion to that target's share of total recursive
demand, so the per-target breakdowns sum back to the pooled totals instead of
showing each artifact "using" the whole pool. The root target itself is never
scaled: every craft of it rolls for its own legendary.

## Golden egg cost

**One linear row, in three models.** The cap has to be written everywhere the
craft counts are decided or it does not bind on the number the card prints. The
MILP is where it changes which ingredients get gathered, but the reported
`craftPrimal` is re-derived downstream by `compileJointInnerLp` and then
`refineJointCraftSplit`, so both carry the same row. Frank-Wolfe only ever moves
between the current point and a vertex of that same polytope, and the row is
linear, so every iterate stays inside the budget.

**Why the row is linear when the cost is not.** The game's price curve decreases
in the craft index, so the true cost is concave in the craft count and
$\sum_n cost_n(crafts_n) \leq capacity$ is not a convex constraint. $price_n$ is
therefore the player's *next* craft of $n$ — the tangent of the true cost at zero
— which over-states the bill, so a plan that satisfies
the row is always affordable. It is paid for in the other direction: a plan taking
many crafts of one node is charged as though every one cost the first one's price,
so some affordable plans are rejected. The gap is the node's $\frac {base}{low}$ price
ratio at worst.

**The card reports that same linear price.** Reporting the true curve instead
reads as a bug in the cap: a player who sets a maximum craft cost and is shown a
plan priced well below it sees a cap that did not bind where it said it did. The
cost of that consistency is that the reported figure over-states what the game
will charge, by the same ratio — the two now err together instead of disagreeing.
The same over-stating price drives the solution card's "costs more than you have"
demarcation, so it marks a little early rather than a little late.

Pricing linearly also sidesteps `craftPrimal` being an LP relaxation: lib's curve
is indexed by an integer craft number, while `fractionalCraftCost` is proportional
in the craft count with no index to round to.

Two numbers, one bill. The card's total prices the **unsplit** `craftPrimal`; the
per-node `goldenEggCost` in a craft-chain tree prices that same pooled quantity
and takes the target's demand-weighted share. Under a linear price, the two orders
agree, so the split decides which target carries a shared node's bill, not how
large it is.

## Module boundaries that are load-bearing

Most of `src/lib` reads as it looks. Four edges do not, and all four exist to keep
something from becoming circular or from landing in the wrong bundle:

- `packing.ts` imports nothing, and in particular nothing from `tests/`,
  because the arena re-checks every plan against its own independent packer
  (invariant C1). Sharing one implementation would make that check circular.
- `index.ts` (the barrel every component imports) has no path to
  `optimizer-core`, so the solver stays out of the main chunk;
  `tests/unit/spec-helpers.ts` holds the in-process `optimize()` for the same
  reason.
- `lp.ts` equilibrates rows and columns before solving, because an absolute
  epsilon on an unscaled tableau stops the pivot loop early while still reporting
  `'optimal'`. Only `value-function.ts` uses it; the fuel and time budgets are the
  MILP's rows, not this one's.
- `tests/arena/solvers/highs/index.ts` is a shim registering `solver/` as the
  arena's entry, so the shipped solver and the measured one are one code path.

