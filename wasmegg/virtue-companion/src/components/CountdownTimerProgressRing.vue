<template>
  <progress-ring
    :radius="radius"
    :stroke-width="strokeWidth"
    :filled-fraction="1 - secondsRemaining / durationSeconds"
  />
</template>

<script lang="ts">
import { defineComponent, PropType, toRefs } from 'vue';

import { useCountdown } from '@/composables/countdown';
import ProgressRing from '@/components/ProgressRing.vue';

export default defineComponent({
  components: {
    ProgressRing,
  },
  props: {
    radius: {
      type: Number,
      required: true,
    },
    strokeWidth: {
      type: Number,
      required: true,
    },
    durationSeconds: {
      type: Number as PropType<number>,
      required: true,
    },
    // Epoch seconds.
    deadline: {
      type: Number as PropType<number>,
      required: true,
    },
  },
  setup(props) {
    const { deadline } = toRefs(props);
    const { secondsRemaining } = useCountdown(deadline);
    return {
      secondsRemaining,
    };
  },
});
</script>

<style scoped>
circle {
  transition: stroke-dashoffset 0.2s;
  transform: rotate(90deg);
  transform-origin: 50% 50%;
}
</style>
