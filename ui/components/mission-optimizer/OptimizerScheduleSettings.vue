<template>
  <div class="space-y-3">
    <div>
      <label class="flex items-center gap-2 cursor-pointer select-none" :class="labelClass">
        <input type="checkbox" :class="checkboxClass" :checked="modelValue.sleepEnabled" @change="onSleepToggle" />
        Sleep
      </label>
      <div class="mt-1 flex items-center gap-2">
        <input
          type="number"
          inputmode="decimal"
          aria-label="Hours of sleep a day"
          :min="MIN_SLEEP_HOURS"
          :max="MAX_SLEEP_HOURS"
          step="0.5"
          :disabled="!modelValue.sleepEnabled"
          :value="modelValue.sleepHours"
          :class="inputClass"
          @change="onSleepHoursChange"
        />
        <span :class="unitClass">h/day</span>
      </div>
      <p v-if="modelValue.sleepEnabled" :class="hintClass" class="text-gray-400">{{ sleepHint }}</p>

      <template v-if="modelValue.sleepEnabled">
        <label :for="`${uid}-since-wake`" :class="labelClass" class="mt-2">Since you woke</label>
        <div class="mt-1 flex items-center gap-2">
          <input
            :id="`${uid}-since-wake`"
            type="number"
            inputmode="decimal"
            min="0"
            :max="MAX_HOURS_SINCE_WAKE"
            step="0.5"
            :value="modelValue.hoursSinceWake"
            :class="inputClass"
            @change="onSinceWakeChange"
          />
          <span :class="unitClass">h</span>
        </div>
      </template>
    </div>

    <div>
      <label class="flex items-center gap-2 cursor-pointer select-none" :class="labelClass">
        <input
          type="checkbox"
          :class="checkboxClass"
          :checked="modelValue.doubleCapacityEnabled"
          @change="update({ doubleCapacityEnabled: ($event.target as HTMLInputElement).checked })"
        />
        <span v-tippy="eventTooltip" class="cursor-help border-b border-dotted border-gray-400/60"
          >2× mission capacity event</span
        >
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

    <p v-if="timingNote" :class="hintClass" class="text-gray-500">
      <span v-tippy="timingExplanation" class="cursor-help border-b border-dotted border-gray-400/60">{{
        timingNote
      }}</span>
    </p>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType } from 'vue';

import { formatDuration } from 'lib';
import {
  clampHoursSinceWake,
  eventWindowInput,
  MAX_HOURS_SINCE_WAKE,
  MAX_SLEEP_HOURS,
  MIN_SLEEP_HOURS,
  normalizeEventRemaining,
  normalizeScheduleSettings,
  timingNote as timingNoteOf,
  timingTooltip,
  withSleepEnabled,
  type Timing,
  type ScheduleSettings,
} from 'lib/mission-optimizer/schedule-settings';
import DoubleCapacityBadge from './DoubleCapacityBadge.vue';

// Sleep and the 2x capacity event, the two settings that say when the player can launch and what a launch
// brings home. Both apps' planners show this one control, so the two read the same fields the same way; the
// rules themselves (range, default, what a typed "time left" means) are `schedule-settings.ts`'s.
let instances = 0;

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

    // Switching sleep on with no hours kept starts at a usual night's; off, the hours stay as they were.
    function onSleepToggle(event: Event) {
      emit('update:modelValue', withSleepEnabled(props.modelValue, (event.target as HTMLInputElement).checked));
    }

    // Committed on change rather than on every keystroke, so typing "10" does not solve for one hour of sleep
    // on the way. The field is rewritten from what was kept, because a clamped value that equals the old one
    // would otherwise leave what was typed on screen. While sleep is on, a number below the step is held at it
    // rather than read as off: switching sleep off is the checkbox's.
    function onSleepHoursChange(event: Event) {
      const input = event.target as HTMLInputElement;
      const next = normalizeScheduleSettings({
        ...props.modelValue,
        sleepHours: input.value.trim() === '' ? 0 : Number(input.value),
      });
      input.value = String(next.sleepHours);
      emit('update:modelValue', next);
    }

    // Held to what the sleep it is typed against allows. A value kept from before the sleep hours changed is left
    // alone until it is typed over, and the solver reads it against the sleep it is handed.
    function onSinceWakeChange(event: Event) {
      const input = event.target as HTMLInputElement;
      const typed = input.value.trim() === '' ? 0 : Number(input.value);
      const next = normalizeScheduleSettings({
        ...props.modelValue,
        hoursSinceWake: clampHoursSinceWake(typed),
      });
      input.value = String(next.hoursSinceWake);
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

    // What the sleep and the event say themselves is in the tooltips; this is what they do not.
    const sleepHint = 'Effort sets how often you launch while awake.';

    const eventWindow = computed(() => eventWindowInput(props.modelValue.doubleCapacityRemaining));
    const eventRejected = computed(() => props.modelValue.doubleCapacityEnabled && eventWindow.value.invalid);
    const eventHint = computed(() => {
      const left = formatDuration(eventWindow.value.seconds, true, { max: 'h' });
      return eventWindow.value.truncated
        ? `An event runs ${left} at most, so that is all the plan counts on.`
        : `Plans around ${left}. A bare number is hours.`;
    });
    const eventTooltip =
      'The event counts down from now. Missions launched inside it bring home double what they otherwise would.';

    // Both settings are clocks, and the plan has to start somewhere on them. "Now" is the only moment the
    // planner can know, and with sleep on it also has to say where in the day that is. The wording, and the
    // explanation the note opens, are `schedule-settings.ts`'s, so the timeline's footnote says the same.
    const timing = computed<Timing>(() => ({
      sleepHours: props.modelValue.sleepEnabled ? props.modelValue.sleepHours : 0,
      hoursSinceWake: props.modelValue.hoursSinceWake,
      event: props.modelValue.doubleCapacityEnabled && !eventWindow.value.invalid,
    }));
    const timingNote = computed(() => timingNoteOf(timing.value));
    const timingExplanation = computed(() => timingTooltip(timing.value));

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
      MIN_SLEEP_HOURS,
      MAX_HOURS_SINCE_WAKE,
      update,
      onSleepToggle,
      onSinceWakeChange,
      onSleepHoursChange,
      onRemainingChange,
      sleepHint,
      eventRejected,
      eventHint,
      eventTooltip,
      timingNote,
      timingExplanation,
      labelClass,
      inputClass,
      unitClass,
      hintClass,
      checkboxClass,
    };
  },
});
</script>
