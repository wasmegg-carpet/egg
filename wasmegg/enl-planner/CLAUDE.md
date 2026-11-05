
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
- Goals (trophies, NAH, ACRE): /src/calculations/goals.ts
- Snapshot system: /src/lib/actions/snapshot.ts
- Formatting: /src/lib/format.ts

## Known gaps
- Vehicle and train car prices are the virtue prices until the regular ones are available
  (`virtueCost` in lib/farm/shipping_capacity.ts). The Vehicles tab says so.
