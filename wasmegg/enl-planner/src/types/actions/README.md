# Action Type Definitions

This directory contains the core type definitions for the Ascension Planner action system.

## Structure

- `index.ts`: Main entry point, re-exports all types.
- `core.ts`: Fundamental types like `ActionType`, `ActionPayloadMap`, and `CalculationsSnapshot`.
- `meta.ts`: Base interfaces for actions (`BaseAction`, `Action`) and undo validation.
- `virtue.ts`: Types for Virtue Eggs.
- `infrastructure.ts`: Payloads for vehicles, habs, silos, and fuel.
- `research.ts`: Payloads for research and sales.
- `missions.ts`: Payloads for rocket missions.
- `wait.ts`: Payloads for various wait actions (TE, time, full habs).

## Usage for Agents

When modifying action logic, refer to `core.ts` for payload structures. All actions follow a unidirectional data flow where the state is updated based on these payloads.
