<template>
  <!-- Undo Confirmation Dialog -->
  <UndoConfirmationDialog
    v-if="dialogs.state.undoAction"
    :action="dialogs.state.undoAction"
    :dependents-a="dialogs.state.undoDependentsA"
    :dependents-b="dialogs.state.undoDependentsB"
    @confirm="dialogs.executeUndo"
    @cancel="dialogs.cancelUndo"
  />

  <!-- Clear All Confirmation Dialog -->
  <ConfirmationDialog
    v-if="dialogs.state.showClearAllConfirmation"
    title="Clear All Actions"
    message="Are you sure you want to clear all actions? This cannot be undone."
    confirm-label="Clear All"
    @confirm="dialogs.executeClearAll"
    @cancel="dialogs.state.showClearAllConfirmation = false"
  />

  <!-- Unsaved Changes Protection Dialog -->
  <ConfirmationDialog
    v-if="dialogs.state.showUnsavedConfirm"
    title="Unsaved Changes"
    message="You have unsaved changes in your current plan. If you continue, these changes will be lost. Would you like to save before proceeding?"
    confirm-label="Continue Without Saving"
    variant="danger"
    @confirm="
      dialogs.state.showUnsavedConfirm = false;
      dialogs.state.pendingAction?.();
    "
    @cancel="
      dialogs.state.showUnsavedConfirm = false;
      dialogs.state.pendingAction = null;
    "
  />
</template>

<script setup lang="ts">
import type { PlanDialogs } from 'lib/planners/composables/usePlanDialogs';
import ConfirmationDialog from 'ui/components/planners/ConfirmationDialog.vue';
import UndoConfirmationDialog from 'ui/components/planners/UndoConfirmationDialog.vue';

defineProps<{ dialogs: PlanDialogs }>();
</script>
