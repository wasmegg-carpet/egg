import { computed, onBeforeUnmount, onMounted, ref, Ref, watch } from 'vue';

// deadline is a reference to an epoch seconds timestamp.
export function useCountdown(deadline: Ref<number>): { secondsRemaining: Ref<number> } {
  const currentTimestamp = ref(Date.now() / 1000);
  const secondsRemaining = computed(() => Math.max(deadline.value - currentTimestamp.value, 0));
  let refreshIntervalId: ReturnType<typeof setInterval> | undefined;
  const startCountdown = () => {
    clearInterval(refreshIntervalId);
    if (secondsRemaining.value > 0) {
      refreshIntervalId = setInterval(() => {
        currentTimestamp.value = Date.now() / 1000;
        if (secondsRemaining.value === 0) {
          clearInterval(refreshIntervalId);
        }
      }, 200);
    }
  };
  onMounted(() => {
    startCountdown();
  });
  watch(deadline, () => {
    startCountdown();
  });
  onBeforeUnmount(() => {
    clearInterval(refreshIntervalId);
  });
  return {
    secondsRemaining,
  };
}
