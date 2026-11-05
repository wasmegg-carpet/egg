/**
 * Composable for executing actions with support for editing past shifts.
 *
 * When editing a past shift, actions are inserted at the correct position
 * and subsequent actions are replayed to update their snapshots.
 */

import { computed } from 'vue';
import type { Action, CalculationsSnapshot } from '@/types';
import { useActionsStore } from '@/stores/actions';
import { replayAction } from '@/lib/actions/replay';
import { restoreFromSnapshot, computeCurrentSnapshot, computeDeltas } from '@/lib/actions/snapshot';
import { safeImport } from '@/lib/import';

export function useActionExecutor() {
  const actionsStore = useActionsStore();

  /**
   * Whether we're currently editing a past group.
   */
  const isEditingPastGroup = computed(() => actionsStore.editingGroupId !== null);

  /**
   * The snapshot to use as the "before" state for new actions.
   * When editing a past group, this is the end state of the last action in that group.
   */
  const beforeSnapshot = computed(() => actionsStore.effectiveSnapshot);

  /**
   * Prepare for executing an action by restoring stores to the correct state.
   * Call this before applying changes to stores.
   * Returns the "before" snapshot for computing deltas.
   */
  function prepareExecution(): CalculationsSnapshot {
    if (isEditingPastGroup.value) {
      // Restore stores to the effective snapshot state before applying the action
      restoreFromSnapshot(actionsStore.effectiveSnapshot);
    }
    return actionsStore.effectiveSnapshot;
  }

  /**
   * Complete an action execution by computing the snapshot and adding to history.
   * Call this after applying changes to stores.
   */
  async function completeExecution(
    action: import('@/types').DraftAction,
    beforeSnapshotArg: CalculationsSnapshot
  ): Promise<void> {
    // Compute the new snapshot after the action
    const afterSnapshot = computeCurrentSnapshot();
    const deltas = computeDeltas(beforeSnapshotArg, afterSnapshot);

    // Build the full action
    const fullAction = {
      ...action,
      ...deltas,
      totalTimeSeconds: 0, // Placeholder, will be computed by engine
      endState: afterSnapshot,
    };

    if (isEditingPastGroup.value) {
      // Check for continuity conflicts
      const { checkAndHandleContinuity } = await safeImport(() => import('@/lib/continuity'));

      const shouldProceed = await checkAndHandleContinuity(
        actionsStore.actions,
        fullAction,
        actionsStore.editingInsertIndex,
        async idsToRemove => {
          await actionsStore.removeActions(idsToRemove);
        }
      );

      if (!shouldProceed) {
        // User cancelled - revert stores
        restoreFromSnapshot(beforeSnapshotArg);
        return;
      }

      // Insert at the correct position and replay subsequent actions
      await actionsStore.insertAction(fullAction, replayAction);

      // Restore to the state after all replays (current state)
      // SKIP restoration if in batch mode - we want to keep the virtual state
      if (!actionsStore.batchMode) {
        restoreFromSnapshot(actionsStore.currentSnapshot);
      }
    } else {
      // Normal push to end
      actionsStore.pushAction(fullAction);
    }
  }

  /**
   * Run a set of operations in batch mode.
   * Defers recalculation until all operations are complete.
   */
  async function batch(callback: () => Promise<void> | void) {
    if (actionsStore.batchMode) {
      await callback();
      return;
    }

    actionsStore.startBatch();
    try {
      await callback();
    } finally {
      await actionsStore.commitBatch();
    }
  }

  return {
    isEditingPastGroup,
    beforeSnapshot,
    prepareExecution,
    completeExecution,
    batch,
  };
}
