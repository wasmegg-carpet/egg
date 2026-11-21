<template>
  <div>
    <div :class="headingClass">Launch plan</div>

    <template v-if="totals.length > 0">
      <div :class="headingClass">Totals</div>
      <!-- A sleep-aware plan is a day and night routine: what to launch while awake, and what to have in the air overnight. -->
      <template v-if="sleepHours > 0">
        <p class="text-xs text-gray-500">
          Over all three slots, planned around {{ sleepHours }} {{ sleepHours === 1 ? 'hour' : 'hours' }} of sleep a
          day.
        </p>
        <template v-if="daytime.length > 0">
          <div class="mt-2 -mb-1 font-medium text-gray-700">While awake</div>
          <optimizer-choice-list :lines="daytime" />
        </template>
        <template v-if="overnight.length > 0">
          <div class="mt-2 -mb-1 font-medium text-gray-700">
            <span v-tippy="overnightTooltip" class="cursor-help border-b border-dotted border-gray-400/60"
              >Overnight</span
            >
          </div>
          <optimizer-choice-list :lines="overnight" />
        </template>
      </template>
      <optimizer-choice-list v-else :lines="totals" />
    </template>

    <!-- A rule and a heading of its own, so the last line of the totals does not read as slot 1's first. -->
    <div :class="{ 'mt-3 border-t border-gray-200 pt-1': totals.length > 0 }">
      <div :class="headingClass">By slot</div>
      <optimizer-slot-timeline :solution="solution" />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType } from 'vue';

import { launchTotals, type OptimizerSolution } from 'lib/mission-optimizer';
import OptimizerChoiceList from './OptimizerChoiceList.vue';
import OptimizerSlotTimeline from './OptimizerSlotTimeline.vue';

// The plan as the player flies it: the launches totalled over the three slots, then each slot's launches in
// order. Both are read off one solution, so a mission's count in the totals is the sum of its lines in the
// timeline. The explorer's solution card and the ascension planner's inline panel both show this.
export default defineComponent({
  components: { OptimizerChoiceList, OptimizerSlotTimeline },
  props: {
    solution: { type: Object as PropType<OptimizerSolution>, required: true },
    // The heading style of the surrounding card, which differs between the two apps.
    headingClass: { type: String, default: 'text-xs font-medium text-gray-500 uppercase tracking-wide mt-3' },
  },
  setup(props) {
    const totals = computed(() => launchTotals(props.solution));
    // Absent on a plan made around the clock, whose totals are one undivided list.
    const sleepHours = computed(() => Number(((props.solution.sleepSeconds ?? 0) / 3600).toFixed(2)));
    // `launchTotals` has sorted each list: doubled before 1x, then by ship, duration and target.
    const daytime = computed(() => totals.value.filter(line => !line.overnight));
    const overnight = computed(() => totals.value.filter(line => line.overnight));
    const overnightTooltip =
      'Launch each of these so it is in the air when you go to sleep. A ship that lands during the night ' +
      'waits for you, and its slot launches again after you wake.';
    return { totals, sleepHours, daytime, overnight, overnightTooltip };
  },
});
</script>
