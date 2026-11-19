<template>
  <div class="space-y-3">
    <div>
      <label :for="`${uid}-sleep`" :class="labelClass">Sleep</label>
      <div class="mt-1 flex items-center gap-2">
        <input
          :id="`${uid}-sleep`"
          type="number"
          inputmode="decimal"
          min="0"
          :max="MAX_SLEEP_HOURS"
          step="0.5"
          :value="modelValue.sleepHours"
          :class="inputClass"
          @change="onSleepHoursChange"
        />
        <span :class="unitClass">hours a day</span>
      </div>
      <p :class="hintClass" class="text-gray-400">{{ sleepHint }}</p>
    </div>

    <div>
      <label class="flex items-center gap-2 cursor-pointer select-none" :class="labelClass">
        <input
          type="checkbox"
          :class="checkboxClass"
          :checked="modelValue.doubleCapacityEnabled"
          @change="update({ doubleCapacityEnabled: ($event.target as HTMLInputElement).checked })"
        />
        2× mission capacity event
        <double-capacity-badge />
      </label>
      <div class="mt-1 flex items-center gap-2">
        <input
          type="text"
          aria-label="Time left in the 2× mission capacity event"
          :disabled="!modelValue.doubleCapacityEnabled"
          :value="modelValue.doubleCapacityRemaining"
          placeholder="e.g. 48h, 3h30m"
          :class="[inputClass, eventRejected ? 'border-red-300' : '']"
          @change="onRemainingChange"
        />
        <span :class="unitClass">left</span>
      </div>
      <p v-if="eventRejected" :class="[hintClass, 'text-red-600']">
        Enter the time left as a positive duration (e.g. 48h, 3h30m).
      </p>
      <p v-else-if="modelValue.doubleCapacityEnabled" :class="hintClass" class="text-gray-400">{{ eventHint }}</p>
    </div>

    <p v-if="startsNowNote" :class="hintClass" class="text-gray-500">{{ startsNowNote }}</p>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType } from 'vue';

import { formatDuration } from 'lib';
import {
  eventWindowInput,
  MAX_SLEEP_HOURS,
  normalizeEventRemaining,
  normalizeScheduleSettings,
  type ScheduleSettings,
} from 'lib/mission-optimizer/schedule-settings';
import DoubleCapacityBadge from './DoubleCapacityBadge.vue';

let instances = 0;

// Sleep and the 2x capacity event, the two settings that say when the player can launch and what a launch
// brings home. Both apps' planners show this one control, so the two read the same fields the same way; the
// rules themselves (range, default, what a typed "time left" means) are `schedule-settings.ts`'s.
export default defineComponent({
  components: { DoubleCapacityBadge },
  props: {
    modelValue: { type: Object as PropType<ScheduleSettings>, required: true },
    // The ascension planner's panel sets its controls a size smaller than the explorer's sidebar.
    compact: { type: Boolean, default: false },
  },
  emits: {
    'update:modelValue': (_settings: ScheduleSettings) => true,
  },
  setup(props, { emit }) {
    const uid = `schedule-settings-${++instances}`;

    function update(patch: Partial<ScheduleSettings>) {
      emit('update:modelValue', normalizeScheduleSettings({ ...props.modelValue, ...patch }));
    }

    // Committed on change rather than on every keystroke, so typing "10" does not solve for one hour of sleep
    // on the way. The field is rewritten from what was kept, because a clamped value that equals the old one
    // would otherwise leave what was typed on screen.
    function onSleepHoursChange(event: Event) {
      const input = event.target as HTMLInputElement;
      const next = normalizeScheduleSettings({
        ...props.modelValue,
        sleepHours: input.value.trim() === '' ? 0 : Number(input.value),
      });
      input.value = String(next.sleepHours);
      emit('update:modelValue', next);
    }

    // A valid entry is rewritten to its tidy spelling (and an over-long one to the cap); anything else is kept
    // as typed for the hint below to flag.
    function onRemainingChange(event: Event) {
      const input = event.target as HTMLInputElement;
      const typed = input.value.trim();
      const remaining = normalizeEventRemaining(typed) ?? typed;
      input.value = remaining;
      update({ doubleCapacityRemaining: remaining });
    }

    const sleepHours = computed(() => props.modelValue.sleepHours);
    const sleepHint = computed(() => {
      const hours = sleepHours.value;
      if (!(hours > 0)) return 'Hours a day you cannot launch. At 0 the plan relaunches around the clock.';
      return (
        `No launches for ${hours} ${hours === 1 ? 'hour' : 'hours'} a day. Ships still fly and land ` +
        'while you sleep, and Effort sets how often you launch while awake.'
      );
    });

    const eventWindow = computed(() => eventWindowInput(props.modelValue.doubleCapacityRemaining));
    const eventRejected = computed(() => props.modelValue.doubleCapacityEnabled && eventWindow.value.invalid);
    const eventHint = computed(() => {
      const left = formatDuration(eventWindow.value.seconds, true, { max: 'h' });
      return eventWindow.value.truncated
        ? `An event runs ${left} at most, so that is all the plan counts on.`
        : `Missions launched in the next ${left} bring home twice the loot. A bare number is hours.`;
    });

    // Both settings are clocks, and the plan has to start somewhere on them. "Now" is the only moment the
    // planner can know, and with sleep on it also has to say where in the day that is.
    const startsNowNote = computed(() => {
      const sleeping = sleepHours.value > 0;
      const event = props.modelValue.doubleCapacityEnabled && !eventWindow.value.invalid;
      if (sleeping && event) return 'The plan starts now, as you wake up, with the event already running.';
      if (sleeping) return 'The plan starts now, as you wake up.';
      if (event) return 'The plan starts now.';
      return '';
    });

    const labelClass = computed(() =>
      props.compact ? 'block text-xs font-medium text-gray-700' : 'block text-sm text-gray-600'
    );
    const inputClass = computed(() => [
      'block w-24 rounded-md border border-gray-300 px-2 py-1 focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400',
      props.compact ? 'text-xs' : 'sm:text-sm',
    ]);
    const unitClass = computed(() => (props.compact ? 'text-[11px] text-gray-500' : 'text-xs text-gray-500'));
    const hintClass = computed(() => (props.compact ? 'mt-1 text-[11px] leading-normal' : 'mt-1 text-xs'));
    const checkboxClass = computed(() =>
      props.compact
        ? 'h-3.5 w-3.5 rounded text-blue-600 border-gray-300'
        : 'h-4 w-4 text-green-600 border-gray-300 rounded focus:ring-green-500'
    );

    return {
      uid,
      MAX_SLEEP_HOURS,
      update,
      onSleepHoursChange,
      onRemainingChange,
      sleepHint,
      eventRejected,
      eventHint,
      startsNowNote,
      labelClass,
      inputClass,
      unitClass,
      hintClass,
      checkboxClass,
    };
  },
});
</script>
