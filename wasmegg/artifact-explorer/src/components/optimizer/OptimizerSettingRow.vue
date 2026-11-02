<template>
  <div class="py-1.5">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="text-sm text-gray-700 truncate">{{ label }}</span>
        <span
          class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide flex-shrink-0"
          :class="badge.class"
        >
          {{ badge.text }}
        </span>
      </div>
      <label
        v-if="hasSave"
        class="flex items-center gap-1 text-xs text-gray-500 cursor-pointer select-none flex-shrink-0"
      >
        <input
          type="checkbox"
          class="h-3.5 w-3.5 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
          :checked="overridden"
          @change="$emit('update:overridden', ($event.target as HTMLInputElement).checked)"
        />
        Override
      </label>
    </div>

    <div v-if="editable" class="mt-1">
      <base-integer-input
        v-slot="{ input, invalid, updateInput }"
        :min="min"
        :max="max"
        :model-value="manualValue"
        @update:model-value="$emit('update:manual', $event)"
      >
        <div class="flex items-center gap-2">
          <div class="w-20">
            <input
              type="number"
              :min="min"
              :max="max"
              :value="input"
              class="block w-full sm:text-sm rounded-md focus:outline-none px-2 py-1"
              :class="
                invalid
                  ? 'border-red-300 text-red-900 placeholder-red-300 focus:ring-red-500 focus:border-red-500'
                  : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
              "
              @input="updateInput"
            />
          </div>
          <span v-if="maxLabel" class="text-xs text-gray-400">{{ maxLabel }}</span>
          <span v-if="hasSave && !perTargetSave && saveValue !== null" class="text-xs text-gray-400">
            Save: {{ saveValue }}
          </span>
          <span v-if="capacity" class="ml-auto text-xs text-gray-500">{{ capacity }}</span>
        </div>
        <p v-if="invalid" class="mt-1 text-xs text-red-500">{{ rangeMessage }}</p>
        <p v-else-if="hint" class="mt-1 text-xs text-gray-400">{{ hint }}</p>
      </base-integer-input>
    </div>
    <div v-else class="mt-1 flex items-center gap-2">
      <span v-if="!perTargetSave" class="font-mono text-sm font-semibold text-gray-800">{{ saveValue }}</span>
      <span v-if="maxLabel" class="text-xs text-gray-400">{{ maxLabel }}</span>
      <span v-if="capacity" class="ml-auto text-xs text-gray-500">{{ capacity }}</span>
    </div>

    <ul v-if="perTargetSave" class="mt-1 space-y-0.5" :class="editable ? 'opacity-60' : ''">
      <li v-for="entry in saveEntries" :key="entry.id" class="flex items-center justify-between gap-2">
        <span class="text-xs text-gray-500 truncate">{{ entry.label }}</span>
        <span class="font-mono text-xs font-semibold text-gray-800 flex-shrink-0">{{ entry.value }}</span>
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType, toRefs } from 'vue';

import BaseIntegerInput from 'ui/components/BaseIntegerInput.vue';

export default defineComponent({
  components: { BaseIntegerInput },
  props: {
    label: { type: String, required: true },
    hasSave: { type: Boolean, required: true },
    overridden: { type: Boolean, default: false },
    saveValue: { type: Number as PropType<number | null>, default: null },
    // Per-target values, shown as a list instead of the single saveValue.
    saveEntries: {
      type: Array as PropType<{ id: string; label: string; value: number }[]>,
      default: () => [],
    },
    manualValue: { type: Number, required: true },
    min: { type: Number, default: 0 },
    max: { type: Number as PropType<number | undefined>, default: undefined },
    maxLabel: { type: String, default: '' },
    capacity: { type: String, default: '' },
    // Shown only while the value is editable, and only when the input isn't currently invalid.
    hint: { type: String, default: '' },
  },
  emits: {
    'update:overridden': (_b: boolean) => true,
    'update:manual': (_n: number) => true,
  },
  setup(props) {
    const { hasSave, overridden, saveEntries, min, max } = toRefs(props);
    // No save data → edit inline; save data + override on → edit inline.
    const editable = computed(() => !hasSave.value || overridden.value);
    const perTargetSave = computed(() => hasSave.value && saveEntries.value.length > 0);
    // Text and colour are one decision, so they are made once: branching twice on the same pair is
    // how a fourth state ends up labelled one way and coloured another. Words match the ones used
    // in the gem-cost mode selector ('Override') so the same source never reads two ways.
    const badge = computed(() => {
      if (!hasSave.value) return { text: 'Manual', class: 'bg-gray-100 text-gray-500' };
      if (overridden.value) return { text: 'Override', class: 'bg-amber-100 text-amber-700' };
      return { text: 'Save', class: 'bg-green-100 text-green-700' };
    });
    const rangeMessage = computed(() =>
      max.value !== undefined
        ? `Enter a whole number from ${min.value} to ${max.value}.`
        : `Enter a whole number of ${min.value} or more.`
    );
    return { editable, perTargetSave, badge, rangeMessage };
  },
});
</script>
