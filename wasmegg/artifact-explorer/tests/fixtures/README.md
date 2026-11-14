# Plan exchange fixtures

- `ascension-plan.json`: ascension planner export, limited to fields read by
  `src/lib/plan/read.ts`.
- `humility-missions.json`: the artifact explorer's humility missions export,
  read by `wasmegg/ascension-planner/src/lib/humilityMissions.ts`.

Both apps assert against these same two files: `tests/unit/plan-seam.spec.ts`
here, and `wasmegg/ascension-planner/src/lib/humilityMissions.spec.ts` on the
other side. Neither file is generated. A schema change on either side needs
the writer (`src/lib/plan/write.ts` for `humility-missions.json`; the ascension
planner's save export for `ascension-plan.json`) and this checked-in JSON
updated by hand together, or the matching spec fails on the mismatch.
