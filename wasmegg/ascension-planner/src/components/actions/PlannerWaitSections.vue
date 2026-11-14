<template>
  <!-- Wait for TE Section -->
  <div
    class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md"
  >
    <button
      class="w-full px-5 py-4 bg-slate-50/50 flex justify-between items-center hover:bg-white transition-colors group"
      @click="teExpanded = !teExpanded"
    >
      <div class="flex items-center gap-3">
        <div
          class="w-8 h-8 rounded-xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-1.5 group-hover:scale-110 transition-transform"
        >
          <img
            :src="iconURL(`egginc/egg_${actionsStore.effectiveSnapshot.currentEgg}.png`, 64)"
            class="w-full h-full object-contain"
          />
        </div>
        <h3 class="font-black text-[10px] uppercase tracking-[0.2em] text-slate-500">Wait for TE</h3>
      </div>
      <svg
        class="w-5 h-5 text-slate-300 transition-transform duration-300"
        :class="{ 'rotate-180 text-slate-900': teExpanded }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
    <div v-show="teExpanded" class="p-6 border-t border-slate-50">
      <WaitForTEActions ref="teActionsRef" />
    </div>
  </div>

  <!-- Bulk Wait for TE Section -->
  <div
    class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md"
  >
    <button
      class="w-full px-5 py-4 bg-slate-50/50 flex justify-between items-center hover:bg-white transition-colors group"
      @click="bulkTEExpanded = !bulkTEExpanded"
    >
      <div class="flex items-center gap-3">
        <div
          class="w-8 h-8 rounded-xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-1.5 group-hover:scale-110 transition-transform"
        >
          <img :src="iconURL('egginc/egg_truth.png', 64)" class="w-full h-full object-contain" />
        </div>
        <h3 class="font-black text-[10px] uppercase tracking-[0.2em] text-slate-500">Bulk Wait for TE</h3>
      </div>
      <svg
        class="w-5 h-5 text-slate-300 transition-transform duration-300"
        :class="{ 'rotate-180 text-slate-900': bulkTEExpanded }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
    <div v-show="bulkTEExpanded" class="p-6 border-t border-slate-50">
      <BulkWaitForTEActions ref="bulkTEActionsRef" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { iconURL } from 'lib';
import { useActionsStore } from '@/stores/actions';
import WaitForTEActions from './WaitForTEActions.vue';
import BulkWaitForTEActions from './BulkWaitForTEActions.vue';

const actionsStore = useActionsStore();
const teExpanded = ref(false);
const bulkTEExpanded = ref(false);
const teActionsRef = ref<InstanceType<typeof WaitForTEActions> | null>(null);
const bulkTEActionsRef = ref<InstanceType<typeof BulkWaitForTEActions> | null>(null);

watch(teExpanded, val => { if (val) nextTick(() => teActionsRef.value?.focus()); });
watch(bulkTEExpanded, val => { if (val) nextTick(() => bulkTEActionsRef.value?.focus()); });
</script>
