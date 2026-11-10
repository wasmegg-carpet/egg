<template>
  <!-- Wait for Population Section -->
  <div
    class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md"
  >
    <button
      class="w-full px-5 py-4 bg-slate-50/50 flex justify-between items-center hover:bg-white transition-colors group"
      @click="populationExpanded = !populationExpanded"
    >
      <div class="flex items-center gap-3">
        <div
          class="w-8 h-8 rounded-xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-1.5 group-hover:scale-110 transition-transform"
        >
          <img
            :src="iconURL('egginc/egg_enlightenment.png', 64)"
            class="w-full h-full object-contain"
          />
        </div>
        <h3 class="font-black text-[10px] uppercase tracking-[0.2em] text-slate-500">Wait for Population</h3>
      </div>
      <svg
        class="w-5 h-5 text-slate-300 transition-transform duration-300"
        :class="{ 'rotate-180 text-slate-900': populationExpanded }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
    <div v-show="populationExpanded" class="p-6 border-t border-slate-50">
      <WaitForPopulationActions ref="populationActionsRef" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { iconURL } from 'lib';
import WaitForPopulationActions from './WaitForPopulationActions.vue';

const populationExpanded = ref(false);
const populationActionsRef = ref<InstanceType<typeof WaitForPopulationActions> | null>(null);

watch(populationExpanded, val => { if (val) nextTick(() => populationActionsRef.value?.focus()); });
</script>
