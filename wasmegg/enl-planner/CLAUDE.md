
## Commands
- Build: `pnpm build` (in workspace directory)
- Dev: `pnpm dev`
- Type check: `pnpm vue-tsc --noEmit`
- Test: `pnpm test`

## What this is
A manual planner for the Enlightenment egg, copied from `wasmegg/ascension-planner`. The internal
name "ascension" survives in identifiers like `start_ascension` and `ascensionDate`; a plan here is
one enlightenment farm with no shifts, so every action is available at any time.

## Code Patterns
- Vue 3 with <script setup lang="ts">
- Pinia stores in /src/stores/
- Action executor pattern in /src/lib/actions/executors/
- Composables in /src/composables/

## Key Files
- Types: /src/types/actions/
- Earning bonus (SE, PE, TE): /src/calculations/earnings.ts
- Clarity stones: /src/lib/artifacts/calculator.ts
- Player inventory (artifacts and stones owned, null when unknown): /src/lib/artifacts/inventory.ts, saved with the plan
- "Max Offline Earnings" and "Max IHR" artifact buttons: /src/lib/artifacts/optimizeArtifacts.ts (beam search over
  the artifacts and stones the player owns)
- "Smart Wait for Population" (Wait tab): /src/calculations/smartPopulationWait.ts. Aims for the plan's
  target (`initialStateStore.smartWaitTarget`: EnD or NAH, picked on first opening, saved with the plan). Sets:
  Max IHR, then at each full habs the highest-IHR set with more room (`optimizeArtifacts`' `habCapacityAbove`).
  Research: hatchery research as Milestones-view chains when it lands before the habs fill and gets to the target
  sooner; Wormhole Dampening only up to what the target needs (for EnD, also the extra levels that let a faster set hold 10B, when that plan is faster), bought as soon as no hatchery research is due (and at the latest while it can still land before the habs fill). Added to the plan by
  /src/composables/useSmartPopulationWait.ts through lib/planners/composables/useResearchPurchases.ts, the
  Milestones view's own buy flow (sale and 2x earnings waits included)
- "Assume cube used for research purchases" (Research tab): /src/lib/artifacts/researchCube.ts. When
  on, its multiplier replaces the equipped set's puzzle cube in `researchCostModifiersAt` (engine) and
  `costModifiers` (useResearchViews); it reaches the engine as `SimulationContext.researchCubeMultiplier`
- Regular vehicle prices: /src/lib/vehicleCosts.ts (from the "price of virtue" sheet)
- Goals (trophies, NAH, ACRE): /src/calculations/goals.ts
- Snapshot system: /src/lib/actions/snapshot.ts
- Formatting: /src/lib/format.ts
