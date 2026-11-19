<template>
  <div class="space-y-2">
    <label v-if="label" class="block text-sm font-medium text-gray-700">{{ label }}</label>

    <div v-if="selectedArtifacts.length > 0" class="flex flex-wrap gap-2">
      <span
        v-for="artifact in selectedArtifacts"
        :key="artifact.id"
        class="inline-flex items-center pl-1 pr-1.5 py-1 rounded-full border text-sm"
        :class="
          replacingId === artifact.id
            ? 'bg-indigo-50 border-indigo-400 ring-1 ring-indigo-400 text-indigo-800'
            : 'bg-gray-100 border-gray-300 text-gray-700'
        "
      >
        <button
          type="button"
          class="inline-flex items-center min-w-0 rounded-full focus:outline-none focus:ring-1 focus:ring-indigo-500"
          :aria-label="`Replace ${artifact.display}`"
          @click="beginReplace(artifact.id)"
        >
          <img class="h-5 w-5 flex-shrink-0 mr-1" :src="iconURL('egginc/' + artifact.icon_filename, 32)" alt="" />
          <span class="truncate max-w-[10rem]">{{ artifact.display }}</span>
        </button>
        <button
          type="button"
          class="ml-1 flex-shrink-0 rounded-full p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 focus:outline-none"
          :aria-label="`Remove ${artifact.display}`"
          @click="remove(artifact.id)"
        >
          <XIcon class="h-3.5 w-3.5" />
        </button>
      </span>
    </div>

    <base-select-filterable
      ref="picker"
      :items="availableArtifacts"
      :get-item-id="artifact => artifact.id"
      :get-item-display="artifact => artifact.display"
      :get-item-icon-path="artifact => 'egginc/' + artifact.icon_filename"
      :item-from-id="id => artifactIdToArtifact.get(id)!"
      :search-items="searchAvailableArtifacts"
      :placeholder="replacingArtifact ? `Replace ${replacingArtifact.display} with…` : 'Add artifact (type to filter)'"
      :model-value="pendingId"
      @update:model-value="onPick"
    />

    <p v-if="replacingArtifact" class="text-xs text-gray-500">
      Pick a replacement for {{ replacingArtifact.display }}, or
      <button type="button" class="underline hover:text-gray-700 focus:outline-none" @click="cancelReplace">
        cancel
      </button>
      .
    </p>

    <div
      v-if="modelValue.length > 2 && !warningDismissed"
      role="status"
      class="flex items-start gap-2 rounded-md bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm px-3 py-2"
    >
      <span class="flex-1">
        Optimizing for 3 or more artifacts at once splits your missions across every target, so the joint chance of
        getting all of them drops quickly.
      </span>
      <button
        type="button"
        class="flex-shrink-0 rounded-full p-0.5 text-yellow-500 hover:text-yellow-700 hover:bg-yellow-100 focus:outline-none"
        aria-label="Dismiss warning"
        @click="warningDismissed = true"
      >
        <XIcon class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, PropType, ref, watch } from 'vue';
import { XIcon } from '@heroicons/vue/solid';

import { iconURL } from 'lib';
import {
  artifactIdToArtifact,
  legendaryArtifacts,
  searchLegendaryArtifacts,
} from 'lib/mission-optimizer/artifact-catalog';
import { GenericBaseSelectFilterable } from 'ui/components/BaseSelectFilterable.vue';

const BaseSelectFilterable = GenericBaseSelectFilterable<(typeof legendaryArtifacts)[number]>();

const props = defineProps({
  modelValue: {
    type: Array as PropType<string[]>,
    required: true,
  },
  // The question the picker answers. An empty string drops the label, for a host that has its own heading.
  label: {
    type: String,
    default: 'What is the most efficient ship to get this item, or items, when on the Path of Virtue?',
  },
});

const emit = defineEmits({
  'update:modelValue': (_payload: string[]) => true,
});

const selectedArtifacts = computed(() =>
  props.modelValue
    .map(id => artifactIdToArtifact.get(id))
    .filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== undefined)
);

const selectedIdSet = computed(() => new Set(props.modelValue));
const availableArtifacts = computed(() => legendaryArtifacts.filter(artifact => !selectedIdSet.value.has(artifact.id)));
function searchAvailableArtifacts(query: string) {
  return searchLegendaryArtifacts(query).filter(artifact => !selectedIdSet.value.has(artifact.id));
}

// Set while a chip is being swapped out. Replacing in place avoids passing
// through an empty selection, which would navigate away.
const replacingId = ref<string | null>(null);
const replacingArtifact = computed(() =>
  replacingId.value === null ? null : (artifactIdToArtifact.get(replacingId.value) ?? null)
);

const picker = ref<{ selectButtonRef?: HTMLInputElement | null } | null>(null);

function beginReplace(id: string) {
  replacingId.value = id;
  nextTick(() => picker.value?.selectButtonRef?.focus());
}

function cancelReplace() {
  replacingId.value = null;
}

// Browser Back can replace modelValue out from under us, dropping the chip
// being replaced.
watch(
  () => replacingId.value !== null && !props.modelValue.includes(replacingId.value),
  stale => {
    if (stale) replacingId.value = null;
  }
);

const pendingId = ref<string | null>(null);
function onPick(id: string | null) {
  if (id === null) return;
  const replacing = replacingId.value;
  if (replacing !== null) {
    replacingId.value = null;
    if (replacing !== id && !props.modelValue.includes(id)) {
      emit(
        'update:modelValue',
        props.modelValue.map(existing => (existing === replacing ? id : existing))
      );
    }
  } else if (!props.modelValue.includes(id)) {
    emit('update:modelValue', [...props.modelValue, id]);
  }
  pendingId.value = null;
}

function remove(id: string) {
  if (replacingId.value === id) replacingId.value = null;
  emit(
    'update:modelValue',
    props.modelValue.filter(existing => existing !== id)
  );
}

const warningDismissed = ref(false);
// Re-arm only when the count crosses up past the threshold, so a dismissal
// survives further edits within the same regime.
watch(
  () => props.modelValue.length,
  (newLength, oldLength) => {
    if (oldLength <= 2 && newLength >= 3) {
      warningDismissed.value = false;
    }
  }
);
</script>
