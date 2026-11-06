
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
- "Max Offline Earnings" and "Max IHR" artifact buttons: /src/lib/artifacts/optimizeArtifacts.ts (beam search over
  every artifact, since the planner doesn't keep the player's inventory)
- "Assume cube used for research purchases" (Research tab): /src/lib/artifacts/researchCube.ts. When
  on, its multiplier replaces the equipped set's puzzle cube in `researchCostModifiersAt` (engine) and
  `costModifiers` (useResearchViews); it reaches the engine as `SimulationContext.researchCubeMultiplier`
- Regular vehicle prices: /src/lib/vehicleCosts.ts (from the "price of virtue" sheet)
- Goals (trophies, NAH, ACRE): /src/calculations/goals.ts
- Snapshot system: /src/lib/actions/snapshot.ts
- Formatting: /src/lib/format.ts
