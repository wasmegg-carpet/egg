import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useContinuityStore = defineStore('continuity', () => {
  const isOpen = ref(false);
  const title = ref('');
  const message = ref('');
  const conflictingActionIds = ref<string[]>([]);

  // Promise resolvers
  let resolvePromise: ((result: boolean) => void) | null = null;

  function requestConfirmation(dialogTitle: string, dialogMessage: string, conflictingIds: string[]): Promise<boolean> {
    title.value = dialogTitle;
    message.value = dialogMessage;
    conflictingActionIds.value = conflictingIds;
    isOpen.value = true;

    return new Promise(resolve => {
      resolvePromise = resolve;
    });
  }

  function confirm() {
    isOpen.value = false;
    if (resolvePromise) {
      resolvePromise(true);
      resolvePromise = null;
    }
  }

  function cancel() {
    isOpen.value = false;
    if (resolvePromise) {
      resolvePromise(false);
      resolvePromise = null;
    }
  }

  return {
    isOpen,
    title,
    message,
    conflictingActionIds,
    requestConfirmation,
    confirm,
    cancel,
  };
});
