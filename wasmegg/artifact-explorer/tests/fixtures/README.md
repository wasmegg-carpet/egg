# Plan exchange fixtures

- `ascension-plan.json`: ascension planner export, limited to fields read by
  `src/lib/plan/read.ts`.
- `humility-plan.json`: artifact explorer output, read by
  `wasmegg/ascension-planner/src/lib/humilityPlan.ts`.

Both apps test these shared fixtures in `tests/unit/plan-seam.spec.ts` and
`wasmegg/ascension-planner/src/lib/humilityPlan.spec.ts`.
