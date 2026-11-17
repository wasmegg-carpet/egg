<template>
  <ul class="mt-2 space-y-0.5">
    <li v-for="(line, j) of lines" :key="j" class="flex items-center gap-1 text-gray-800">
      <span
        class="mr-0.5 w-2 h-2 rounded-full flex-shrink-0"
        :class="overnight ? 'bg-indigo-500' : 'bg-green-500'"
      ></span>
      <span class="flex-shrink-0 tabular-nums">{{ line.numShipsLaunched }}×</span>
      <mission-name class="min-w-0" :mission="line.ship" :target="line.targetAfxId" :no-link="true" />
      <double-capacity-badge v-if="line.doubled" />
      <!-- One night is what "overnight" already says; only a longer flight needs spelling out. -->
      <span v-if="overnight && (line.nights ?? 0) > 1" class="flex-shrink-0 text-xs text-gray-500"
        >· {{ line.nights }} nights each</span
      >
    </li>
  </ul>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue';

import type { LaunchLine } from 'lib/mission-optimizer';
import DoubleCapacityBadge from './DoubleCapacityBadge.vue';
import MissionName from './MissionName.vue';

export default defineComponent({
  components: { DoubleCapacityBadge, MissionName },
  props: {
    lines: { type: Array as PropType<LaunchLine[]>, required: true },
    // The list of launches that fly through the night on a sleep-aware plan.
    overnight: { type: Boolean, default: false },
  },
});
</script>
