<template>
  <span v-if="short === exact">{{ short }}</span>
  <span v-else v-tippy="exact" class="cursor-help border-b border-dotted border-current">{{ short }}</span>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue';

import { formatEIValue } from 'lib';

// A number in the game's own units, with the full figure on hover. The hover shows every digit,
// decimals and all, so the reader can see what the four significant figures left out.
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
