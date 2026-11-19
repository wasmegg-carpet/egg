<template>
  <ul class="mt-2 space-y-0.5">
    <li v-for="(line, j) of lines" :key="j" class="flex items-center gap-1 text-gray-800">
      <span
        class="mr-0.5 w-2 h-2 rounded-full flex-shrink-0"
        :class="line.overnight ? 'bg-indigo-500' : 'bg-green-500'"
      ></span>
      <span class="flex-shrink-0 tabular-nums">{{ line.numShipsLaunched }}×</span>
      <!-- At phone width the name wraps inside itself, and the badge goes under it. -->
      <span class="min-w-0 flex-1 flex flex-wrap items-center gap-x-1">
        <mission-name class="min-w-0" :mission="line.ship" :target="line.targetAfxId" :no-link="true" />
        <double-capacity-badge v-if="line.doubled" />
      </span>
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
  },
});
</script>
