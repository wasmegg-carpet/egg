import { defineStore } from 'pinia';

const TOAST_DURATION_MS = 4000;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

/** One short message at a time; a new one replaces the last and restarts its timer. */
export const useToastStore = defineStore('toast', {
  state: () => ({
    message: null as string | null,
  }),
  actions: {
    show(message: string) {
      this.message = message;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        this.message = null;
      }, TOAST_DURATION_MS);
    },
  },
});
