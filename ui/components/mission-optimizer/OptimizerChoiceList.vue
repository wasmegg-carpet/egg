<template>
  <ul class="mt-2 space-y-0.5">
    <li v-for="(choice, j) of choices" :key="j" class="flex items-center gap-1.5 text-gray-800">
      <span class="w-2 h-2 rounded-full flex-shrink-0 bg-green-500"></span>
      <span
        >{{ choice.numShipsLaunched }}×
        <mission-name :mission="choice.ship" :target="choice.targetAfxId" :no-link="true" class="inline-block"
      /></span>
    </li>
  </ul>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue';

import type { LaunchSolution } from 'lib/mission-optimizer';
import MissionName from './MissionName.vue';

export default defineComponent({
  components: { MissionName },
  props: {
    choices: { type: Array as PropType<LaunchSolution[]>, required: true },
  },
});
</script>
