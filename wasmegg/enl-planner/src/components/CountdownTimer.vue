<template>{{ formattedTimeRemaining }}</template>

<script lang="ts">
import { computed, defineComponent, toRefs } from 'vue';
import { useCountdown } from '@/composables/countdown';

export default defineComponent({
  props: {
    // Epoch seconds.
    deadline: {
      type: Number,
      required: true,
    },
  },
  setup(props) {
    const { deadline } = toRefs(props);
    const { secondsRemaining } = useCountdown(deadline);
    const formattedTimeRemaining = computed(() => {
      let s = secondsRemaining.value;
      const days = Math.floor(s / 86400);
      const hours = Math.floor(s / 3600) % 24;
      const minutes = Math.floor(s / 60) % 60;
      const seconds = Math.floor(s) % 60;
      return days > 0
        ? `${days}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
        : `${hours}:${pad(minutes)}:${pad(seconds)}`;
    });
    return {
      formattedTimeRemaining,
    };
  },
});

function pad(x: number): string {
  return x.toString().padStart(2, '0');
}
</script>
