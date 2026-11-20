# The Path of Virtue mission optimizer

Given a set of budgets and game state (player's ships, a fuel budget, a per-slot time horizon, etc.), the optimizer
picks integer counts of each launch option so as to maximize the chance of ending
up with a legendary of **every** artifact the player selected.

## The objective

Each selected target `T` has a score linear in the crafts the plan supports:

$$
score(T) = Q_T \cdot crafts_T + \lambda_T
$$

$crafts_T$ is how many copies of `T` the player's inventory merged with the dropped
items from the optimizer's selected missions supports crafting, $\lambda_T$ is `T`'s
expected direct legendary drop count, and $Q_T = -\log(1 - p_{CraftLegendary_T})$ is
what one craft is worth. The search maximizes

$$
F = \sum_T g(score(T)), \qquad g(s) = \log(1 - e^{-s})
$$

$e^F$ is exactly the joint probability of getting a legendary of _every_ selected
target, so maximizing $F$ and maximizing that probability are the same problem — and
$F$ is a sum of per-target terms, which is what a matrix can carry. That identity
holds for a specific model: mission yields are treated as deterministic expected
supply rather than random drops, craft counts are continuous, direct legendary
drops are Poisson with mean $\lambda_T$, and targets are treated as independent of
each other. $e^F$ is this model's probability, not a measured game rate. `objective.ts`
holds $g$, $g'$ and $Q$ as `logHit`, `gPrime` and `qOf`; the search and the judge both
read them, so the two agree to the bit on what a target is worth.

One consequence worth knowing: $g'(s) = 1/(e^s - 1)$, so $g$ flattens as
$score_T$ grows and the search stops distinguishing plans that differ only in how
far they overshoot an already-certain target. Above $P_T = 0.999$,
the next craft buys nearly nothing, and, with several targets, that budget belongs
to whichever one is still short — but it means near-saturated instances settle
for any plan inside the epsilon band rather than the score-maximal one.

## The tangent outer approximation

$\sum_T g(score_T)$ is not linear, so it has to be linearized to serve as a MILP's
objective. `lib/mission-optimizer/solver/SPEC.md`'s introduction defines the general terms this
section uses (MILP, concave, tangent, envelope, outer approximation). The concave
function here is $g$, the per-target term from "The objective" above; $z_T$ is the
one envelope variable per target, bounded by a row $z_T <= \alpha_k + \beta_k *
score_T$ per tangent point, so the solver drives each $z_T$ up to $\min_k(...)$ and
the maximization stays linear.

The envelope over-estimates $g$ everywhere except one edge case: when a
tangent's slope falls under `FLAT_CUT_SLOPE` (1e-12), `buildOaMilp` omits the
slope term and keeps the cut flat, which can let it sit under $g$ by at most that
many nats (`SPEC.md` section 3 derives the bound). Over-estimating is safe only because
nothing reported is read off the approximation: the chosen plan is re-scored by
the judge (`solver/evaluator.ts`) against the exact objective, and the card's
probabilities come from `craftsToProbability` on the judge's craft counts and the
plan's drop rates. If you change anything about the tangent grid, this is the
property to preserve: an over-estimate reorders candidates slightly, whereas
letting the approximation leak into a reported figure would make the tool lie.

## Search structure

`optimizeFull` states the whole problem as one MILP and hands it to HiGHS. The model,
the outer approximation and HiGHS's own numeric traps are in
`lib/mission-optimizer/solver/SPEC.md`; the judge's simplex has a separate set, in the header of
`lib/mission-optimizer/solver/simplex.ts`. What follows is only what a reader of this file needs.

**Why an MILP.** Missions are allocated _per slot_ and crafts are continuous columns
over the same conservation polytope — the feasible set the recipe's rows carve out — so
packing and the craft split are both decided inside the one matrix and no repair phase
exists. `SPEC.md` section 3 states the two rows and the argument.

**What it costs.** About a second on a production-scale instance.

**What is still wrong with it.** Invariant violations across the arena sweep are
all of the form "a more constrained problem scored better" and all small. They
are consistent with the node budget: investigation showed even extreme node
budgets didn't fully resolve the invariants, so the current deployment was
tuned to balance runtime with the frequency and severity of the violations. But
there is a latent mechanism the sweep does not isolate from that explanation:
the per-target scale $\theta_t$ is an LP maximum computed _subject to the
budgets_, and the tangent grid is placed in units of theta, so changing a
budget re-approximates the objective rather than merely enlarging the feasible
set. How much of the observed violation each mechanism accounts for is open, and
the A1/A2 monotonicity invariants are not theorems even at proven optimality until
it is settled.

## The worker boundary

The planner runs off the main thread (`optimizer.worker.ts`). Every solve is
around a second, and the first one in a worker's life also fetches and
instantiates the WebAssembly module.

**Launch-option enumeration stays on the main thread.** It is the only step that
needs the loot dataset, which the main bundle already loads for the mission
views; enumerating in the worker would put a second copy in the worker bundle.
For the same reason `optimizer.worker.ts` imports `optimizeFull` directly rather
than through the `lib` barrel, which re-exports the loot data.

The traffic goes the other way too, and for the mirror-image reason: components import
the barrel, so a static edge from it to `optimizer-core` would drag the solver and its
Emscripten glue into the main chunk. Keeping that edge out of the module graph rather
than relying on a lazy import is what makes it hard to undo by accident ("Module
boundaries that are load-bearing", below).

`optimizer-worker-protocol.ts` exists because structured clone drops prototypes
(see its header for why); the consequence is that `ship` is narrowed to two
fields on the way out and rebuilt on the way in.

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

`computeOwnedStock` counts the player's stock across all rarities, because each
can be demoted to common. This is "how many copies you can feed a recipe",
never "you already own a legendary"; the legendary side of the objective comes
solely from mission drops.

A target is skipped only when nothing in the DAG consumes it. `solver/model.ts` gives a
conservation row only to nodes some recipe consumes, so such a node has no row at all:
owned copies could never be spent and would only look like free progress. A target that _is_ an ingredient of another keeps its
stock, which can only relax the consumption side of its row.

## Per-target display attribution

`craftPrimal` / `supplyByItem` are solution-wide pooled totals: the judge settles on one
point of the craft polytope for the whole plan (`solver/evaluator.ts`), which crafts a
shared component once for every target that consumes it.
`computeCraftChainTree` attributes each node's pooled quantities to a target in
proportion to that target's share of total recursive demand, so the per-target
breakdowns sum back to the pooled totals instead of showing each artifact "using" the
whole pool. The root is scaled by that same rule, not exempt from it: a target that is
itself an ingredient of another selected target gets only its own share of its pool,
and keeps the pool whole only when nothing else demands it.

## Golden egg cost

**One linear row, in two matrices.** The cap has to be written wherever craft counts
are decided or it does not bind on the number the card prints. The MILP is where it
changes which ingredients get gathered; the judge's craft LP is where the reported
`craftPrimal` comes from, so it carries the same row. The judge maximizes by away-step
Frank-Wolfe over that same polytope, and the row is linear, so every iterate it visits
stays inside the budget.

**Why the row is linear when the cost is not, and what that costs.** `computeCraftUnitPrices`
in `optimizer-cost.ts` carries the pricing argument: why a linear per-craft price
over-states the true bill, and by how much in the worst case.

**The card reports that same linear price.** Reporting the true curve instead
reads as a bug in the cap: a player who sets a maximum craft cost and is shown a
plan priced well below it sees a cap that did not bind where it said it did. The
cost of that consistency is that the reported figure over-states what the game
will charge, by the same ratio — the two now err together instead of disagreeing.
The same over-stating price drives the solution card's "costs more than you have"
demarcation, so it marks a little early rather than a little late.

Pricing linearly also sidesteps the crafts being continuous — the LP relaxation that
lets a plan craft 2.5 of something: lib's curve is indexed by an integer craft number,
while `linearCraftCost` is proportional in the craft count with no index to round
to.

Two numbers, one bill. The card's total prices the **unsplit** `craftPrimal`; the
per-node `goldenEggCost` in a craft-chain tree prices that same pooled quantity
and takes the target's demand-weighted share. Under a linear price, the two orders
agree, so the split decides which target carries a shared node's bill, not how
large it is.

## Sleep

The Sleep setting (`sleepEnabled`, off by default, and `sleepHours`) is the hours
a day the player cannot launch; off, the hours are kept but the plan is made
around the clock. Both apps edit it, and the event's two fields below, through one
control (`ui/components/mission-optimizer/OptimizerScheduleSettings.vue`), and
`schedule-settings.ts` holds every rule about what a stored or typed value means
and turns the three into `OptimizeArgs`, with its bounds read from `sleep.ts` and
`capacity.ts` rather than restated. Ships still fly and land through the
night; one that lands while the player is asleep waits. The plan starts at
wake-up, every day is the same, and all three slots share the schedule. With sleep
off neither the request nor the problem carries a sleep field, and the plan is
made around the clock. A record saved before the switch existed is on exactly
when its hours were above 0, and while on the hours are at least half an hour.

**`optimizeFull` owns the translation.** Its `timeCapacityPerSlot` stays the
wall-clock horizon whether or not the player sleeps. Given `sleepSeconds`, it
splits that horizon into waking seconds and nights per slot and each option into
its daytime and overnight variants (`sleep.ts`), and hands the solver the
sleep-aware problem of `solver/SPEC.md` sections 9 and 10. The variants are made
in the worker, after the menu crosses the wire, so the menu the main thread
enumerates does not depend on the setting. The effort floor is applied before
the split, so it is the minimum spacing between launches while awake and
overnight alike.

**Only a laid-out plan reaches the card.** The solver returns a calendar with
every plan, sleep window or not, and refuses to return one that fails its own
verifier (`solver/SPEC.md` section 12); `optimizeFull` throws if the calendar is
missing. Four things downstream read the plan differently because of it:

- _Slots._ `slots`, `timeUnitsUsed` and `runningTimeSeconds` are read off the
  calendar, the arrangement the plan was accepted on, for every plan; nothing
  repacks a plan's totals. The layout balances the slots, so the busiest one is
  no busier than it has to be (`solver/SPEC.md` section 12). With a sleep window
  the makespan is wall-clock: the first moment the player is awake after the
  last-finishing slot's last block ends, nights included. The card's idle figure
  is still the horizon minus the busiest slot's real flight time, so with sleep
  it also counts the rest of a night after a ship has landed.
- _The timeline._ Each `SlotSummary` carries its calendar's launches, naming
  their `choiceHistory` entry by index (`finalizeSolutions` follows the entries
  when it sorts them), and when each goes up. `planTimeline`
  (`optimizer-views.ts`) is the per-slot timeline every plan card shows: every
  launch of every day in order, runs of identical launches merged (never across
  a day on a sleep-aware plan), and no day headings or folded days, since the T+
  times say where a day ends.
- _The launch list._ Each slot launch carries the nights it is in the air
  for, read off its launch time and flight (`nightsFlown`), which can differ
  from the night count of the variant the solver budgeted it as: a re-timed
  launch can be back before bed, a daytime one sent up in the evening lands in
  the night. The card's totals (`launchTotals`) and the timeline's overnight
  marks read that, so the launches shown as flown while awake and the ones
  shown overnight are what the calendar flies. Only whether a launch is in the
  air at bedtime is shown (a green or an indigo dot), not for how many nights,
  so lines split by that and the same mission can appear in both lists. Each
  list is sorted doubled before 1x, then by ship, duration and target.
- _The export._ The humility missions file folds a mission's daytime and
  overnight launches into one line (`launchTotals` with `byOvernight: false`), as it folds any two entries of one mission.
  `makespanSeconds` is the wall-clock makespan above, `effort` is the cadence
  while awake, and the visit carries `sleepSeconds` when the plan had a sleep
  window. The ascension planner reads `makespanSeconds` as how long to wait the
  visit out and does not read the other two.

`sleep.ts` is not shared with the arena, which keeps its own copy of the variant
rule (`tests/arena/sleep.ts`); `tests/unit/sleep.spec.ts` holds the two to the
same answers.

## The 2x capacity event

Egg, Inc. periodically doubles every ship's capacity for 48 hours, and a
mission is doubled when it _launches_ inside the window, whenever it lands.
`OptimizeArgs.eventWindowSeconds` is how much of the window is left, starting
now; the tool never looks it up. Absent or 0, neither the request, the problem
nor the solution carries an event field. Both apps set it from the
player's "time left" (`doubleCapacityEnabled` / `doubleCapacityRemaining`,
`schedule-settings.ts`); with sleep on, the plan's start is taken to be the
start of a waking day as well.

**`optimizeFull` owns the translation**, as it does for sleep. It clamps the
window to `MAX_DOUBLE_CAPACITY_SECONDS` (`capacity.ts`: no more than 48 hours
can be left of a window that starts now), adds each option's doubled variants
(`capacityVariants`, applied over the sleep variants so a doubled launch keeps
its nights and waking seconds), and hands the solver the problem of
`solver/SPEC.md` section 11. The caller passes the menu as enumerated and never
enumerates against the window itself, so a menu and a window cannot disagree.
The variants are made in the worker, like the sleep ones.

**What the solution says.** `eventWindowSeconds` is on it when the plan was
solved against a window, and each `choiceHistory` entry then carries the
`variant` it flew: `event` and `overhang` are doubled, and one mission can appear
once per variant. The calendar the plan was accepted on says per launch whether
it is doubled and when it goes up, and the timeline shows both, with a divider
where the window closes. A launch is doubled exactly when it goes up inside the
window, as the game doubles it: the layout flies doubled any 1x launch it finds
there, and the solver's verifier holds both directions (`solver/SPEC.md`
section 16). Every view folds `event` and `overhang`, which the
player flies alike, and keeps a doubled launch apart from the same mission at
1x: the totals and the legendary sources badge it, and the humility missions
file writes it on its own line marked `doubled: true` (absent otherwise, so a
file without an event is unchanged). The ascension planner carries the marker
onto the staged launch's entry; it does not model what a mission brings home.

**With sleep.** Both may be set at once. The window is then wall-clock time
from now, nights included, and the player is taken to be at the start of a
waking day now, the assumption sleep already makes; there is no further input.
The solver's window rows become a relaxation there, and a doubled launch the
day-by-day layout cannot start inside the window is flown at 1x instead, so the
plan and every figure on the card describe what the calendar actually flies
(`solver/SPEC.md` section 13). `layoutStats.launchesDemoted` counts those.

What capacity does **not** touch: `enumerateLaunchOptions`
(`problem-inputs.ts`) divides a target's recorded drops by the mission's
capacity to decide whether the data is too sparse to quote. That is a statement about the dataset rather than about the plan, and
doubling it there would change which missions are shown as having enough data.

`capacity.ts` is not shared with the arena, which keeps its own copy of the
variant rule (`tests/arena/capacity.ts`); `tests/unit/capacity.spec.ts` holds the
two to the same answers.

## The fueling pad

The game has one fueling pad for every slot, and a ship fuels there for its fuel
over the pad's rate, its tank level's output (`fuelTankOutputsPerMinute` beside
`fuelTankSizes` in `lib/missions.ts`: 9T a minute at the 500T tank, 3T at the
100T one), one ship at a time; the next starts fueling the moment the one before
it launches. So launches the plan would send together go up a fueling apart: at
T+0, at a wake-up, at the 2x window's close, where ships land together.
`OptimizeArgs.fuelingRate` is that rate, in eggs a second; both apps pass
`fuelingRateOfLevel` of the player's tank level (`fueling.ts`), never anything of
the fuel budget.
Absent, every launch fuels in no time and the plan is the one without the pad.

The solver re-times every calendar on the pad and verifies it there
(`solver/SPEC.md` section 18), so every launch time a view shows keeps it, the
timeline, slot loads and nights included, read off the calendar as before. The
player stays up for the launches the pad sends back to back from T+0, which can
run past bedtime. The solution carries `fuelingRate`, and so does the humility
missions file (absent without one; the ascension planner does not read it).

## Module boundaries that are load-bearing

Most of `lib/mission-optimizer` reads as it looks. Two edges do not, and both exist to keep
something from becoming circular or from landing in the wrong bundle:

- Nothing here imports from `tests/`, and the arena re-checks every plan with its
  own packer and its own calendar verifier (invariant C1), never `solver/verify.ts`.
  Sharing either would make that check circular. Production has no packer at
  all: the MILP's per-slot columns are the assignment, laid out as the calendar.
- `index.ts` (the barrel every component imports) has no path to
  `optimizer-core`, so the solver stays out of the main chunk;
  `tests/unit/spec-helpers.ts` holds the in-process `optimize()` for the same
  reason.

A third load-bearing edge sits outside `lib/mission-optimizer`: `tests/arena/solvers/highs/index.ts`
is a shim registering `solver/` as the arena's entry, so the shipped solver and the
measured one are one code path.
