<template>
  <div>
    <p v-if="timeline.slots.length === 0" class="mt-2 text-sm text-gray-400 italic">No missions fit this budget.</p>

    <ol v-else class="mt-2 space-y-2">
      <li v-for="(slot, k) of timeline.slots" :key="'slot-' + k" class="rounded-lg bg-gray-50 px-3 py-2">
        <div class="flex flex-wrap items-baseline justify-between gap-x-2">
          <span class="text-xs font-medium uppercase tracking-wide text-gray-500">Slot {{ k + 1 }}</span>
          <span v-if="slot.launchCount > 0" class="text-xs text-gray-400 tabular-nums">
            {{ slot.launchCount }} {{ slot.launchCount === 1 ? 'launch' : 'launches' }} · free at
            {{ clock(slot.endsAt) }}
          </span>
        </div>

        <p v-if="slot.rows.length === 0" class="mt-1 text-sm text-gray-400 italic">Unused</p>
        <ul v-else class="mt-1 space-y-0.5">
          <template v-for="(row, j) of slot.rows" :key="j">
            <li
              v-if="row.kind === 'routine'"
              class="mt-1 border-t border-gray-200 pt-1 text-[11px] font-medium uppercase tracking-wide text-gray-600"
            >
              Days {{ row.firstDay + 1 }}–{{ row.lastDay + 1 }}
              <span class="normal-case font-normal text-gray-400"
                >· the same {{ row.period }} days, {{ row.times }} times over</span
              >
            </li>

            <li
              v-else-if="row.kind === 'day'"
              class="pt-1 text-[11px] font-medium uppercase tracking-wide text-gray-500"
              :class="row.routineDay ? 'pl-2' : ''"
            >
              <template v-if="row.routineDay">Day {{ row.routineDay.day }} of {{ row.routineDay.of }}</template>
              <template v-else-if="row.firstDay === row.lastDay">Day {{ row.firstDay + 1 }}</template>
              <template v-else>
                Days {{ row.firstDay + 1 }}–{{ row.lastDay + 1 }}
                <span class="normal-case font-normal text-gray-400">· the same each day</span>
              </template>
            </li>

            <li v-else-if="row.kind === 'window-end'" class="flex items-center gap-2 py-0.5" role="separator">
              <span class="h-px flex-1 bg-fuchsia-300"></span>
              <span class="text-[11px] uppercase tracking-wide text-fuchsia-600 whitespace-nowrap">
                2× capacity ends · <span class="normal-case tabular-nums">{{ clock(row.at) }}</span>
              </span>
              <span class="h-px flex-1 bg-fuchsia-300"></span>
            </li>

            <li v-else class="flex items-center gap-1.5 text-gray-800">
              <span
                class="w-2 h-2 rounded-full flex-shrink-0"
                :class="row.nights > 0 ? 'bg-indigo-500' : 'bg-green-500'"
              ></span>
              <span class="flex-shrink-0 tabular-nums">{{ row.count }}×</span>
              <!-- What gives way at phone width: the name wraps inside itself, and the badge and the night go under it
                   rather than push the time, which keeps the right edge. -->
              <span class="min-w-0 flex-1 flex flex-wrap items-center gap-x-1">
                <mission-name
                  class="min-w-0"
                  :mission="row.choice.ship"
                  :target="row.choice.targetAfxId"
                  :no-link="true"
                />
                <span v-if="row.doubled || row.nights > 0" class="flex items-center gap-1">
                  <double-capacity-badge v-if="row.doubled" />
                  <span v-if="row.nights > 0" class="text-xs text-indigo-600 whitespace-nowrap">
                    {{ row.nights === 1 ? 'overnight' : `${row.nights} nights` }}
                  </span>
                </span>
              </span>
              <span class="flex-shrink-0 text-xs text-gray-400 tabular-nums whitespace-nowrap">{{
                clock(row.launchAt)
              }}</span>
            </li>
          </template>
        </ul>
      </li>
    </ol>

    <p v-if="timeline.slots.length > 0" class="mt-1 text-xs text-gray-400">
      Each slot's launches in order, back to back. T+ is when the first of a line goes up, counted from the start of the
      plan<template v-if="timeline.byDay">, the first time round where days repeat</template>.
    </p>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType } from 'vue';

import { formatDuration } from 'lib';
import { planTimeline, type OptimizerSolution } from 'lib/mission-optimizer';
import DoubleCapacityBadge from './DoubleCapacityBadge.vue';
import MissionName from './MissionName.vue';

// Offsets read as a clock from the plan's start, floored to the minute, so a time read off the card is never later
// than the one the plan was verified at: a doubled launch shown at T+47h59m still goes up inside a 48h window.
const clock = (seconds: number) => (seconds >= 60 ? `T+${formatDuration(seconds, true)}` : 'T+0');

export default defineComponent({
  components: { DoubleCapacityBadge, MissionName },
  props: {
    solution: { type: Object as PropType<OptimizerSolution>, required: true },
  },
  setup(props) {
    const timeline = computed(() => planTimeline(props.solution));
    return { timeline, clock };
  },
});
</script>
