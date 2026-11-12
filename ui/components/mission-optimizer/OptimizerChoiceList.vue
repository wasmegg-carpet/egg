<template>
  <ul class="mt-2 space-y-0.5">
    <li v-for="(choice, j) of choices" :key="j" class="flex items-center gap-1.5 text-gray-800">
      <span class="w-2 h-2 rounded-full flex-shrink-0" :class="overnight ? 'bg-indigo-500' : 'bg-green-500'"></span>
      <span
        >{{ choice.numShipsLaunched }}×
        <mission-name :mission="choice.ship" :target="choice.targetAfxId" :no-link="true" class="inline-block"
      /></span>
      <!-- One night is what "overnight" already says; only a longer flight needs spelling out. -->
      <span v-if="overnight && (choice.nights ?? 0) > 1" class="text-xs text-gray-500"
        >· {{ choice.nights }} nights each</span
      >
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
    // The list of launches that fly through the night on a sleep-aware plan.
    overnight: { type: Boolean, default: false },
  },
});
</script>
