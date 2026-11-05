<template>
  <div v-if="summary.length > 0" class="bg-gray-50 rounded-lg p-4">
    <h4 class="text-sm font-medium text-gray-700 mb-2">Mission Summary</h4>

    <div class="space-y-0.5 mb-3">
      <div v-for="line in summary" :key="`${line.ship}-${line.duration}`" class="text-xs text-gray-600">
        {{ line.count }}× {{ line.durationName }} {{ line.shipName }}
      </div>
    </div>

    <div class="border-t border-gray-200 pt-2 space-y-0.5">
      <div class="text-sm font-medium text-gray-800">
        <span v-tippy="absoluteTime">
          Total Time: {{ formatDuration(schedule.totalSeconds) }}
        </span>
      </div>
      <div class="text-xs text-gray-500">{{ schedule.totalMissions }} missions</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ScheduleResult, MissionSummaryLine } from '@/lib/rockets/scheduler';
import { formatDuration, formatAbsoluteTime } from '@/lib/format';
import { useActionsStore } from '@/stores/actions';
import { useVirtueStore } from '@/stores/virtue';

const props = defineProps<{
  summary: MissionSummaryLine[];
  schedule: ScheduleResult;
}>();

const actionsStore = useActionsStore();
const virtueStore = useVirtueStore();

const absoluteTime = computed(() => {
  const startTime = virtueStore.planStartTime.getTime();
  const offset = actionsStore.planStartOffset;
  const currentSimTime = actionsStore.effectiveSnapshot.lastStepTime || 0;
  const totalSeconds = props.schedule.totalSeconds;

  return formatAbsoluteTime(currentSimTime + totalSeconds - offset, startTime);
});
</script>
