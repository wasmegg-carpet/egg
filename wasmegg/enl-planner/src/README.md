# Ascension Planner Source Architecture

Welcome to the Ascension Planner codebase. This project is structured to support high-fidelity simulation of Egg Inc. ascensions.

## Core Directories

- `src/stores/`: Pinia state management. The `actions` store is the primary source of truth.
- `src/engine/`: The pure simulation engine.
  - `apply/`: State transition logic.
  - `compute/`: Derived metrics calculation.
  - `simulate.ts`: History traversal.
- `src/calculations/`: Pure mathematical formulas for game mechanics (Earnings, IHR, etc.).
- `src/lib/`: Unified wrappers for data and complex logic (Artifacts, Truth Eggs).
- `src/types/`: TypeScript definitions. `types/actions/` contains the action system schema.
- `src/components/`: Vue components.
  - `actions/`: UI for triggering simulation actions.
  - `presenters/`: Data visualization and reports.
- `src/composables/`: Reusable UI logic.

## Key Concepts

- **Simulation-First**: All state is derived from a list of sequential actions.
- **Unidirectional Data Flow**: Stores only mutate via actions that are then simulated through the engine.
- **Type Safety**: Use explicit payloads for all actions to ensure simulation consistency.

Refer to `src/engine/SIMULATION_FLOW.md` for details on how the simulation state transitions.
