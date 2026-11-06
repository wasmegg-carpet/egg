<template>
  <div
    v-if="!initialStateStore.proPermit"
    class="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex gap-3"
    role="alert"
  >
    <svg class="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
    <p class="leading-relaxed">
      <span class="font-bold">Standard permit is not supported in the {{ tool }}.</span>
      Its tables are simulated with Pro permit: full offline earnings, up to 10 silos and 4 active artifacts. With
      Standard permit, real ascensions take longer than it shows. The manual and automatic planners do support Standard
      permit.
    </p>
  </div>
</template>

<script setup lang="ts">
/** Warns Standard permit players on the Pro-only Chain Finder and Table Builder tabs. */
import { useInitialStateStore } from '@/stores/initialState';

defineProps<{ tool: string }>();

const initialStateStore = useInitialStateStore();
</script>
