<!-- Based on https://css-tricks.com/building-progress-ring-quickly/ -->

<template>
  <svg :height="radius * 2" :width="radius * 2">
    <circle
      class="text-gray-200"
      stroke="currentColor"
      :stroke-width="strokeWidth"
      fill="transparent"
      :r="innerRadius"
      :cx="radius"
      :cy="radius"
      :transform="`rotate(90 ${radius} ${radius})`"
    />
    <circle
      stroke="currentColor"
      :stroke-dasharray="`${innerCircumference} ${innerCircumference}`"
      :stroke-width="strokeWidth"
      :stroke-dashoffset="strokeDashoffset"
      fill="transparent"
      :r="innerRadius"
      :cx="radius"
      :cy="radius"
      :transform="`rotate(90 ${radius} ${radius})`"
    />
  </svg>
</template>

<script lang="ts">
import { computed, defineComponent, toRefs } from 'vue';

export default defineComponent({
  props: {
    radius: {
      type: Number,
      required: true,
    },
    strokeWidth: {
      type: Number,
      required: true,
    },
    filledFraction: {
      type: Number,
      required: true,
    },
  },
  setup(props) {
    const { radius, strokeWidth, filledFraction } = toRefs(props);
    const innerRadius = computed(() => radius.value - strokeWidth.value);
    const innerCircumference = computed(() => innerRadius.value * 2 * Math.PI);
    const strokeDashoffset = computed(() => innerCircumference.value * (1 - filledFraction.value));
    return {
      innerRadius,
      innerCircumference,
      strokeDashoffset,
    };
  },
});
</script>

<style scoped>
circle {
  transition: stroke-dashoffset 0.2s;
}
</style>
