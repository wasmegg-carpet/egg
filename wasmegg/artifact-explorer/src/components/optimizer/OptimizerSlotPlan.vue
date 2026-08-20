<template>
  <div>
    <div class="text-xs font-medium text-gray-500 uppercase tracking-wide mt-3">
      {{ scheduled ? 'Launch plan' : 'Missions' }}
    </div>

    <p v-if="empty" class="mt-2 text-sm text-gray-400 italic">No missions fit this budget.</p>

    <ul v-else-if="!scheduled" class="mt-2 space-y-0.5">
      <li v-for="(row, i) of flatRows" :key="'run-' + i" class="flex items-start gap-1.5 text-gray-800">
        <span class="mt-2 w-2 h-2 rounded-full flex-shrink-0 bg-green-500"></span>
        <span class="flex-shrink-0 tabular-nums">{{ row.numShipsLaunched }}×</span>
        <mission-name :mission="row.ship" :target="row.targetAfxId" :no-link="true" class="min-w-0" />
      </li>
    </ul>

    <template v-else>
      <ul class="mt-2 space-y-3">
        <li v-for="(slot, k) of slots" :key="'slot-' + k" class="bg-gray-50 rounded-lg shadow px-4 py-3">
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-xs font-medium uppercase tracking-wide text-gray-500">Slot {{ k + 1 }}</span>
          </div>

          <p v-if="slot.runs.length === 0" class="mt-1 text-sm text-gray-400 italic">Unused</p>
          <ul v-else class="mt-1 space-y-0.5">
            <template v-for="(row, j) of rowsOf(slot)" :key="j">
              <li v-if="row.kind === 'boundary'" class="flex items-center gap-2 py-1" role="separator">
                <span class="h-px flex-1 bg-fuchsia-300"></span>
                <span class="text-[11px] uppercase tracking-wide text-fuchsia-600 whitespace-nowrap">
                  2× capacity ends ·
                  <span class="normal-case">T+{{ clock(windowSeconds) }}</span>
                </span>
                <span class="h-px flex-1 bg-fuchsia-300"></span>
              </li>
              <li v-else class="flex items-start gap-1.5 text-gray-800">
                <span class="mt-2 w-2 h-2 rounded-full flex-shrink-0 bg-green-500"></span>
                <double-capacity-badge v-if="row.run.doubled" class="mt-1.5 flex-shrink-0" />
                <span class="flex-shrink-0 tabular-nums">{{ row.run.numShipsLaunched }}×</span>
                <mission-name
                  :mission="row.run.ship"
                  :target="row.run.targetAfxId"
                  :no-link="true"
                  class="min-w-0 flex-1"
                />
                <span v-if="row.run.doubled" class="flex-shrink-0 text-xs text-gray-400 tabular-nums">
                  {{ launchClock(row.run) }}
                </span>
              </li>
            </template>
          </ul>
        </li>
      </ul>

      <p class="mt-2 text-xs text-gray-400">
        T is whenever you start launching.
        <template v-if="hasBoundary">
          Launch back to back above the line; the last one can wait as late as the line. Below it the order is up to
          you.
        </template>
      </p>
    </template>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType } from 'vue';

import { formatDuration } from 'lib';
import type { DisplayRun, OptimizerSolution, ScheduledRun, SlotSummary } from '@/lib';
import { planDisplayRuns, planHasDoubledRuns, slotSchedule } from '@/lib';
import MissionName from '@/components/MissionName.vue';
import DoubleCapacityBadge from './DoubleCapacityBadge.vue';

type Row = { kind: 'run'; run: ScheduledRun } | { kind: 'boundary' };

const clock = (seconds: number) => (seconds > 0 ? formatDuration(seconds, true, { max: 'h', min: 's' }) : '0');
const launchClock = (run: ScheduledRun) => `T+${clock(run.offsetSeconds)}`;

// Relies on doubled runs leading every slot, which is the order `slotSchedule` hands back.
const boundaryAt = (rows: readonly ScheduledRun[]): number => {
  let i = 0;
  while (i < rows.length && rows[i].doubled) i++;
  return i;
};

export default defineComponent({
  components: { MissionName, DoubleCapacityBadge },
  props: {
    solution: { type: Object as PropType<OptimizerSolution>, required: true },
  },
  setup(props) {
    const slots = computed(() => props.solution.slots);

    const empty = computed(() => slots.value.every(s => s.runs.length === 0));

    const scheduled = computed(() => planHasDoubledRuns(props.solution));

    const flatRows = computed<DisplayRun[]>(() => planDisplayRuns(props.solution));

    const windowSeconds = computed(() => props.solution.eventWindowSeconds);

    const hasBoundary = computed(() =>
      slots.value.some(s => {
        const rows = slotSchedule(s);
        const cut = boundaryAt(rows);
        return cut > 0 && cut < rows.length;
      })
    );

    function rowsOf(slot: SlotSummary): Row[] {
      const merged = slotSchedule(slot);
      const rows: Row[] = [];
      const cut = boundaryAt(merged);
      const crosses = cut > 0 && cut < merged.length;
      merged.forEach((run, i) => {
        if (crosses && i === cut) rows.push({ kind: 'boundary' });
        rows.push({ kind: 'run', run });
      });
      return rows;
    }

    return { slots, empty, scheduled, flatRows, hasBoundary, rowsOf, launchClock, clock, windowSeconds };
  },
});
</script>
