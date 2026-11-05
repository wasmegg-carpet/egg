# Simulation Flow Documentation

This document describes the step-by-step transformation of the `EngineState` and how results are derived in the Ascension Planner.

## Core State: `EngineState`

The simulation tracks the following mutable state:
- `currentEgg`: The active Virtue Egg.
- `population`: Number of chickens on the farm.
- `bankValue`: Number of earned gems (accumulated through earnings).
- `lastStepTime`: Running total of seconds passed in the ascension.
- `researchLevels`: Map of common research IDs to levels.
- `habIds`: Array of 4 hab slots.
- `vehicles`: Array of vehicle slots (ID and train length).
- `siloCount`: Number of fuel silos.
- `fuelTankAmounts`: Amount of each virtue egg in the tank.
- `eggsDelivered`: Total eggs ever delivered for each virtue egg.
- `artifactLoadout`: Currently equipped artifacts.
- `artifactSets`: Saved sets for Quick-Equip.
- `activeSales`: Current sale status (Research, Hab, Vehicle).
- `earningsBoost`: Current multiplier and status.

## Action Execution Flow

When an action is applied (in `src/engine/apply/actions.ts` and `src/engine/simulate.ts`):

### 1. Pre-Calculation (Refresh)
Some actions are **dynamic**. Their payloads are recalculated based on the state *immediately preceding* them.
- `wait_for_te`: Target TE is converted to `eggsToLay` and then `timeSeconds`.
- `store_fuel`: `timeSeconds` is derived from target amount.
- `wait_for_missions`: `totalTimeSeconds` is derived from return timestamps in the backup.

### 2. Immediate Effects
The action's immediate state transformations are applied.
- `buy_research`: Increments level, subtracts `cost` from `bankValue`.
- `shift`: Resets `bankValue` to 0, `population` to 1.
- `change_artifacts`: Updates `artifactLoadout`.

### 3. Passive Delivery
During the action's duration (calculated via `getActionDuration`), eggs are delivered and time passes.
- `passiveEggs = elr * durationSeconds`
- `eggsDelivered[egg] += passiveEggs`

### 4. Time Advancement (`applyTime`)
The farm operates during the action's duration:
- **Population**: `newPop = Math.min(maxHab, P0 + IHR * durationSeconds)`.
- **Earnings**: Integral of earnings rate over the duration.
  - Phase 1: Laying limited (Population * LayRate < Shipping).
  - Phase 2: Shipping limited (Shipping < Population * LayRate).
- **Bank**: `bankValue += earnedGems`.

### 5. Snapshot Derivation (`computeSnapshot`)
After state changes, a full snapshot is computed using the logic in `src/calculations/`.
- Total multipliers (Epic Research + Artifacts + Colleggtibles).
- `EggValue`, `HabCapacity`, `LayRate`, `ShippingCapacity`.
- `EffectiveLayRate (ELR)`: `min(LayRate, ShippingCapacity)`.
- `Earnings`: `ELR * EggValue`.

## Dependency Model

Actions are linked in a graph:
- **Research Tiers**: Higher tiers depend on total research purchases (re-evaluated in `dependency.ts`).
- **Unlocks**: Some actions required others (e.g., buying a train car requires the vehicle to be present).
- **Undo**: Removing an action triggers a recursive removal of all its dependents.
