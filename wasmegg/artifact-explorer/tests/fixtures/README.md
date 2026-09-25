# Plan exchange fixtures

- `ascension-plan.json`: ascension planner export, limited to fields read by
  `src/lib/plan/read.ts`.
- `humility-plan.json`: artifact explorer output, read by
  `wasmegg/ascension-planner/src/lib/humilityPlan.ts`.

Both apps assert against these same two files: `tests/unit/plan-seam.spec.ts`
here, and `wasmegg/ascension-planner/src/lib/humilityPlan.spec.ts` on the
other side. Neither file is generated. A schema change on either side needs
the writer (`src/lib/plan/write.ts` for `humility-plan.json`; the ascension
planner's save export for `ascension-plan.json`) and this checked-in JSON
updated by hand together, or the matching spec fails on the mismatch.
