# Ascension Planner: Mode Initialization Reference & AI Instructions

> [!IMPORTANT]
> **AI INSTRUCTIONS**: Whenever you are asked to modify, debug, or answer questions about the initialization of an ascension session (Start from Scratch, Plan Future, Continue Current, Reconcile, or Load Plan), you **MUST** read this file in its entirety before proposing code changes. This ensures you maintain the strict state isolation contracts and do not introduce regressions across modes.

## The 5 Modes: Overview

There are 5 distinct ways to enter an ascension. Each has a dedicated initializer in `src/lib/modes/`.

1.  **Start from Scratch** (`initStartFromScratch`): No backup data. Complete reset to defaults.
2.  **Plan Future Ascension** (`initPlanFuture`): Uses global progress (epic research, artifacts, TE, fuel) but resets farm state (research, habs, bank=0) and rolls pending TE into earned.
3.  **Continue Current Ascension** (`initContinueCurrent`): Carries forward the current live farm state into the plan.
4.  **Reconcile** (`initReconcile`): Compares a saved plan against live backup data.
5.  **Load Saved Plan** (`initLoadPlan`): Hydrates all stores from a saved plan's serialized state.

---

## 1. The State Contract Matrix

Every mode starts by calling `resetAllStores()` to guarantee a clean baseline. The table below describes the **expected final state** after initialization completes.

| Store / Field | Start from Scratch | Plan Future | Continue Current | Reconcile | Load Saved Plan |
|---|---|---|---|---|---|
| **actions** | `[start]` + auto wait | `[start]` + auto wait | `[start + events]` | from plan | from plan |
| **start.initialEgg** | `'curiosity'` | `'curiosity'` | from backup farm | from plan | from plan |
| **start.initialFarmState** | `undefined` | `undefined` | from backup farm | from plan | from plan |
| **start.isQuickContinue** | `false` | `false` | `true` | from plan | from plan |
| **initialState.hasData** | `false` | `true` | `true` | `true` | `true` (hydrated) |
| **initialState.isContinuing** | `false` | `false` | `true` | `false` | from plan |
| **initialState.epicResearch** | defaults | from backup | from backup | from plan | from plan |
| **initialState.artifactSets** | defaults | optimal earnings | backup loadout | from plan | from plan |
| **virtue.currentEgg** | `'curiosity'` | `'curiosity'` | from backup farm | from plan | from plan |
| **virtue.te** | `0` | backup TE + pending | from backup | from plan | from plan |
| **virtue.bankValue** | `0` | `0` | from backup farm | from plan | from plan |
| **commonResearch** | defaults (0) | defaults (0) | from backup farm | from plan | from plan |
| **habCapacity** | defaults | defaults | from backup farm | from plan | from plan |
| **silos.siloCount** | 1 (default) | 1 (reset) | from backup farm | from plan | from plan |
| **actionsStore.isReconciling** | `false` | `false` | `false` | `true` | `false` |
| **reconcileFarmState** | `null` | `null` | `null` | from live backup | `null` |

---

## 2. Initialization Flow Patterns

### Pattern A: Clean State Baseline
Every mode **MUST** call `resetAllStores()` as its first step.
-   Clears all Pinia stores to defaults.
-   Resets the `actionsStore` and clears the `start_ascension` payload.
-   Ensures no state leaks from a previous session (e.g., `isReconciling` flags).

### Pattern B: The Pure Fetch
Backup fetching is done via `fetchPlayerBackup(playerId)`.
-   This function is **pure data**. It fetches the backup and saves it to IndexedDB but **does not touch any stores**.
-   The mode initializer is responsible for taking the returned data and populating the stores.

### Pattern C: Single Snapshot Computation
Unlike the old interleaved code, each mode now computes the initial snapshot **exactly once** at the very end of the initialization sequence.
1.  Reset stores.
2.  Populate stores from backup/plan.
3.  `const initialSnapshot = computeSnapshot(...)`
4.  `await actionsStore.setInitialSnapshot(initialSnapshot)`

---

## 3. Directory Structure

-   `src/lib/modes/index.ts`: Barrel file exporting all initializers.
-   `src/lib/modes/reset.ts`: Contains `resetAllStores()`.
-   `src/lib/modes/fetchBackup.ts`: Contains `fetchPlayerBackup()`.
-   `src/lib/modes/*.ts`: Individual mode initializers.

## 4. Troubleshooting Cross-Mode Bugs

If fixing a bug in "Plan Future" breaks "Continue Current":
1.  Verify that you didn't add shared logic to `resetAllStores` that has side effects.
2.  Check `initialStateStore.loadFromBackup`. Ensure the `mode` parameter is correctly handled and not setting global state that affects other modes.
3.  Ensure you are not modifying `App.vue`'s `submitPlayerId` in a way that assumes it's being used for a specific mode (it is now only used for the initial "Login/Fetch" and its mode is always `'default'`).
