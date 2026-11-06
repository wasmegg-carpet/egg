import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useWarningStore = defineStore('warning', () => {
  const isOpen = ref(false);
  const title = ref('');
  const message = ref('');

  function showWarning(dialogTitle: string, dialogMessage: string) {
    title.value = dialogTitle;
    message.value = dialogMessage;
    isOpen.value = true;
  }

  function showRefreshPrompt() {
    title.value = 'New Version Available';
    message.value = 'A new version of the app has been deployed. Please refresh the page to continue.';
    isOpen.value = true;
  }

  function close() {
    isOpen.value = false;
  }

  return {
    isOpen,
    title,
    message,
    showWarning,
    showRefreshPrompt,
    close,
  };
});
