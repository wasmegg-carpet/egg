import { reactive } from 'vue';
import type { Action } from '@planner/types';
import { useActionsStore } from '@planner/stores/actions';
import { restoreFromSnapshot } from '../actions/snapshot';

/** The undo, clear-all and unsaved-changes confirmations. Shown by PlannerDialogs. */
export function usePlanDialogs() {
  const actionsStore = useActionsStore();

  const state = reactive({
    undoAction: null as Action | null,
    undoDependentsA: [] as Action[],
    undoDependentsB: [] as Action[],
    showClearAllConfirmation: false,
    showUnsavedConfirm: false,
    pendingAction: null as (() => void) | null,
  });

  /**
   * Confirm unsaved changes before potentially destructive actions.
   */
  function confirmUnsavedChanges(action: () => void) {
    if (actionsStore.isDirty) {
      state.pendingAction = action;
      state.showUnsavedConfirm = true;
    } else {
      action();
    }
  }

  function showUndoConfirmation(action: Action, options?: { skipConfirmation: boolean }) {
    const validationA = actionsStore.prepareUndo(action.id);
    const validationB = actionsStore.prepareUndoToEnd(action.id);

    state.undoAction = action;
    state.undoDependentsA = validationA.dependentActions;
    state.undoDependentsB = validationB.dependentActions;

    if (options?.skipConfirmation) {
      executeUndo('truncate');
    }
  }

  function cancelUndo() {
    state.undoAction = null;
    state.undoDependentsA = [];
    state.undoDependentsB = [];
  }

  function executeUndo(mode: 'dependents' | 'truncate' = 'dependents') {
    if (!state.undoAction) return;

    actionsStore.executeUndo(state.undoAction.id, mode, snapshot => {
      // Restore stores to the snapshot of the last remaining action
      restoreFromSnapshot(snapshot);
    });

    cancelUndo();
  }

  function handleClearAll(options?: { skipConfirmation: boolean }) {
    if (options?.skipConfirmation) {
      executeClearAll();
    } else {
      state.showClearAllConfirmation = true;
    }
  }

  function executeClearAll() {
    actionsStore.clearAll();
    state.showClearAllConfirmation = false;
  }

  return reactive({ state, confirmUnsavedChanges, showUndoConfirmation, cancelUndo, executeUndo, handleClearAll, executeClearAll });
}

export type PlanDialogs = ReturnType<typeof usePlanDialogs>;
