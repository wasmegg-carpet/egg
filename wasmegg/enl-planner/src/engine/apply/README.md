# Simulation Engine: Apply

Contains the logic for applying actions to the simulation state.

## Structure

- `math.ts`: Mathematical models for population growth and earnings integration.
- `duration.ts`: Logic for determining how long an action takes.
- `time.ts`: Functions to advance simulation time and update the bank/population.
- `actions.ts`: Individual action handlers for the state machine.

## Simulation Flow

The simulation advances by:
1. Determining action duration via `getActionDuration`.
2. Computing passive delivery during that duration.
3. Applying the action's immediate effects (e.g., buying an item).
4. Advancing time via `applyTime` to account for earnings and growth.
