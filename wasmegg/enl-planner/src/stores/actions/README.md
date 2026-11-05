# Actions Store

The central source of truth for the ascension plan history and current simulation state.

## Structure

- `types.ts`: The `ActionsState` interface.
- `simulation.ts`: Core simulation orchestration and history management.
- `dependency.ts`: Logic for building and maintaining the action dependency graph.
- `io.ts`: Import/Export logic for plan files.
- `index.ts`: Pinia store definition.

## Architectural Principles

- **Unidirectional State Flow**: Initial Snapshot -> Action 1 -> Action 2 -> ... -> Current State.
- **Pure Simulation**: History traversal uses the `apply` engine to compute snapshots without mutating the store state until the end.
- **Dependency Tracking**: Many actions depend on previous ones (e.g., buying tier 2 research requires enough tier 1 purchases). This is automatically maintained via `relinkDependencies`.
