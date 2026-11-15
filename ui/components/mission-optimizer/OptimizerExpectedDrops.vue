<template>
  <details class="mt-3">
    <summary class="cursor-pointer text-gray-500 hover:text-gray-700 select-none">Expected drops</summary>
    <ul class="mt-2 space-y-1">
      <li
        v-for="drop in drops"
        :key="drop.itemId"
        class="flex items-center gap-1.5"
        :class="drop.relevant ? 'text-gray-800' : 'text-gray-400'"
      >
        <img :src="drop.iconUrl" class="h-5 w-5 flex-shrink-0" :class="drop.relevant ? '' : 'opacity-40'" />
        <span>{{ drop.name }}</span>
        <span class="ml-auto font-mono" :class="drop.relevant ? 'text-gray-700 font-semibold' : 'text-gray-400'">{{
          drop.expected.toFixed(1)
        }}</span>
      </li>
    </ul>
  </details>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue';

import type { DropRow } from 'lib/mission-optimizer';

export default defineComponent({
  props: {
    drops: { type: Array as PropType<DropRow[]>, required: true },
  },
});
</script>
