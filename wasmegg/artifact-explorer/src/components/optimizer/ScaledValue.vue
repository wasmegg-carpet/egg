<template>
  <span v-if="short === exact">{{ short }}</span>
  <span v-else v-tippy="exact" class="cursor-help border-b border-dotted border-current">{{ short }}</span>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue';

import { formatEIValue } from 'lib';

// Game units with the full value, rounded to two decimal places, on hover.
export default defineComponent({
  props: {
    value: { type: Number, required: true },
  },
  setup(props) {
    const short = computed(() => formatEIValue(props.value, { trim: true }));
    const exact = computed(() => props.value.toLocaleString('en-US', { maximumFractionDigits: 2 }));
    return { short, exact };
  },
});
</script>
