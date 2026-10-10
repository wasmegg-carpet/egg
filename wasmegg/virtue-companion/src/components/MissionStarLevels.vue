<template>
  <div v-if="mission.maxLevel > 0" class="flex items-center space-x-0.5">
    <div v-for="i in mission.maxLevel" :key="i" class="h-3.5 w-3.5">
      <!-- fa: solid/star and regular/star -->
      <svg viewBox="0 0 576 512" class="h-3.5 w-3.5 text-yellow-400 select-none">
        <path
          v-if="i <= mission.level"
          fill="currentColor"
          d="M259.3 17.8L194 150.2 47.9 171.5c-26.2 3.8-36.7 36.1-17.7 54.6l105.7 103-25 145.5c-4.5 26.3 23.2 46 46.4 33.7L288 439.6l130.7 68.7c23.2 12.2 50.9-7.4 46.4-33.7l-25-145.5 105.7-103c19-18.5 8.5-50.8-17.7-54.6L382 150.2 316.7 17.8c-11.7-23.6-45.6-23.9-57.4 0z"
        />
        <path
          v-else
          fill="currentColor"
          d="M528.1 171.5L382 150.2 316.7 17.8c-11.7-23.6-45.6-23.9-57.4 0L194 150.2 47.9 171.5c-26.2 3.8-36.7 36.1-17.7 54.6l105.7 103-25 145.5c-4.5 26.3 23.2 46 46.4 33.7L288 439.6l130.7 68.7c23.2 12.2 50.9-7.4 46.4-33.7l-25-145.5 105.7-103c19-18.5 8.5-50.8-17.7-54.6zM388.6 312.3l23.7 138.4L288 385.4l-124.3 65.3 23.7-138.4-100.6-98 139-20.2 62.2-126 62.2 126 139 20.2-100.6 98z"
        />
      </svg>
    </div>
  </div>
  <div v-else class="flex items-center h-3.5 text-gray-500 text-xs">&ndash;</div>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue';

import { Mission } from 'lib';

export default defineComponent({
  props: {
    mission: {
      type: Object as PropType<Mission>,
      required: true,
    },
  },
});
</script>
