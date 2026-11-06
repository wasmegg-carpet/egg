<template>
  <div
    v-if="isRecalculating"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-white/80 backdrop-blur-sm cursor-wait transition-all duration-300"
  >
    <div
      class="flex flex-col items-center gap-4 bg-white p-8 rounded-3xl shadow-2xl border border-gray-100/50 animate-in fade-in zoom-in duration-300"
    >
      <div class="relative w-16 h-16">
        <svg
          class="animate-spin text-blue-500 w-16 h-16 filter drop-shadow-lg"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle>
          <path
            class="opacity-100"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      </div>
      <div class="space-y-2 text-center">
        <h3 class="text-xl font-black text-gray-900 tracking-tight">Recalculating...</h3>
        <p class="text-sm font-bold text-gray-500 tabular-nums font-mono-premium">
          {{ progress.current }} / {{ progress.total }} actions
        </p>
      </div>

      <!-- Progress Bar -->
      <div class="w-48 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          class="h-full bg-gradient-to-r from-blue-400 to-indigo-500 transition-all duration-100 ease-linear rounded-full"
          :style="{ width: `${(progress.current / Math.max(progress.total, 1)) * 100}%` }"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useActionsStore } from '@/stores/actions';

const actionsStore = useActionsStore();
const isRecalculating = computed(() => actionsStore.isRecalculating);
const progress = computed(() => actionsStore.recalculationProgress);
</script>
