# The seam between this app and the ascension planner, as two files

These two documents are the whole interface between this app and the ascension planner. Nothing
else crosses: no shared runtime, no cross-workspace imports, no shared bundle.

- `ascension-plan.json` is what the planner exports today, unchanged for this feature. It is
  narrowed to the fields `src/lib/plan/read.ts` actually reads, so it is short enough to check by
  eye, but every field in it is a field the real export writes.
- `humility-plan.json` is what this app writes back, and what
  `wasmegg/ascension-planner/src/lib/humilityPlan.ts` reads.

Both are read by specs on both sides of the seam:

- `tests/unit/plan-seam.spec.ts` (here)
- `wasmegg/ascension-planner/src/lib/humilityPlan.spec.ts`

That is the point of keeping one copy rather than one per app. A schema described in two places is
a schema with two versions of itself the first time either side is edited; a schema with one
executable definition fails a test instead.
