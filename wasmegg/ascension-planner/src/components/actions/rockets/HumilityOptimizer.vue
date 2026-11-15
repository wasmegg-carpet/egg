<template>
  <div class="rounded-lg border border-indigo-200 bg-indigo-50/40">
    <button
      type="button"
      class="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
      :aria-expanded="store.open"
      @click="store.open = !store.open"
    >
      <span>
        <span class="text-xs font-bold uppercase tracking-wider text-indigo-700">Mission optimizer</span>
        <span class="block text-[11px] text-gray-500 mt-0.5">
          Find the ship set with the best chance of a legendary on this visit, and stage it into the plan.
        </span>
      </span>
      <span
        class="flex-shrink-0 px-2 py-1 text-xs rounded-md border"
        :class="
          store.open
            ? 'border-gray-300 bg-white text-gray-600'
            : 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700'
        "
      >
        {{ store.open ? 'Hide' : 'Optimize this visit' }}
      </span>
    </button>

    <div v-if="store.open" class="border-t border-indigo-100 p-3">
      <component :is="panel" v-if="panel" />
      <p v-else-if="loadError" class="text-xs text-red-600">Could not load the optimizer: {{ loadError }}</p>
      <p v-else role="status" class="flex items-center gap-2 text-xs text-gray-500">
        <InlineSpinner />
        Loading the optimizer and its drop data…
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { shallowRef, ref, watch, type Component, type ShallowRef } from 'vue';

import { safeImport } from 'lib/planners/import';
import InlineSpinner from 'ui/components/planners/InlineSpinner.vue';

import { useHumilityOptimizerStore } from '@/stores/humilityOptimizer';

const store = useHumilityOptimizerStore();

// The panel brings the solver and the loot dataset with it, several megabytes the Rockets tab should not
// cost anyone who never opens this. Loaded on first open and kept for the rest of the session.
// Annotated rather than passed as a type argument: `shallowRef`'s overloads distribute over `Component`.
const panel: ShallowRef<Component | null> = shallowRef(null);
const loadError = ref('');

watch(
  () => store.open,
  async open => {
    if (!open || panel.value) return;
    loadError.value = '';
    try {
      panel.value = (await safeImport(() => import('./HumilityOptimizerPanel.vue'))).default;
    } catch (err) {
      loadError.value = err instanceof Error ? err.message : String(err);
    }
  },
  { immediate: true }
);
</script>
