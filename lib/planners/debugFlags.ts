/**
 * Central home for this app's "flip to true, temporarily, for debugging" console-log switches —
 * each one gates a specific investigation's logging, off by default. Collected in one leaf module
 * (rather than one local `const` per file) so unrelated layers (`calculations/`, `auto/`,
 * `components/`) can all import the same switch without introducing a dependency in the wrong
 * direction (nothing under `calculations/` otherwise depends on `auto/`, and this file lives in
 * `lib/`, already the common lower layer both of those import from), and so a flag shared across
 * multiple files (like `DEBUG_SHIFT_TIMING`, read by both `auto/ascension.ts` and
 * `auto/shifts/c3.ts`) can't silently drift into two independent copies — confirmed in practice
 * once already: flipping only one file's own local copy left the other's calls completely
 * unlogged.
 *
 * Each flag names the investigation it was added for in its own doc comment; delete a flag (and
 * its call sites' `if` guards) once that investigation is fully resolved, rather than letting them
 * accumulate indefinitely.
 */

/**
 * Log every shift's own wall-clock compute time — `auto/ascension.ts`'s `runUntilShift`/
 * `runAscension` (per-shift breakdown, including `C1K1I1Segment`'s C1/I1/K1 split), and
 * `auto/shifts/c3.ts`'s `runC3Variants` (per-variant breakdown, e.g. `3-sale-tier13`, `2-sale`).
 */
export const DEBUG_SHIFT_TIMING = false;

/**
 * Log each round of `computeResearchMilestoneChain`'s loop and `sweepUntilNextSale`'s own
 * candidate search (`calculations/milestoneChain.ts`) — visible in the browser's devtools Console
 * panel even though this runs inside a Web Worker.
 */
export const DEBUG_MILESTONE_CHAIN = false;

/**
 * Log why `simulateSaleAwareBuy`'s candidate search comes up empty — i.e. what the top of the ROI
 * ranking looked like at the moment it stopped finding anything to buy
 * (`calculations/smartBuyPreview.ts`). Gated separately from `DEBUG_MILESTONE_CHAIN` since this
 * function is also invoked by the manual planner's live "Buy Until Sale Warning" button, not just
 * the milestone chain.
 */
export const DEBUG_SALE_AWARE_BUY = false;

/**
 * Log each item `handleBuyMilestoneChain` executes (`components/actions/ResearchActions.vue`) —
 * `syncEventStateForItem`'s computed price/wait/crossings and `buyOneLevel`'s actual resulting
 * timestamp — so a live "Buy Entire Chain" run can be compared directly against the milestone
 * chain's own offline preview.
 */
export const DEBUG_MILESTONE_EXECUTION = false;
