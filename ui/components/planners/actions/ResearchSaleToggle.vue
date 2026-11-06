<template>
  <div
    class="bg-gradient-to-r from-indigo-50/80 via-white to-purple-50/80 rounded-2xl p-4 border border-indigo-100/50 shadow-sm relative overflow-hidden flex items-center justify-between transition-all duration-300"
  >
    <div class="flex items-center gap-2 relative z-10">
      <div class="flex flex-col gap-0.5">
        <div class="flex items-center gap-2">
          <div class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></div>
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none"
            >Research Sale</span
          >
        </div>
        <span class="text-[11px] font-black text-indigo-600 uppercase tracking-tighter">70% OFF</span>
      </div>
    </div>

    <button
      v-tippy="tooltip"
      @click="$emit('toggle')"
      class="relative inline-flex h-5 w-10 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner"
      :class="isActive ? 'bg-indigo-500' : 'bg-slate-200'"
    >
      <span
        class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-all duration-300 shadow-sm"
        :class="isActive ? 'translate-x-[22px]' : 'translate-x-1'"
      />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatDuration } from 'lib/planners/format';

const props = defineProps<{
  isActive: boolean;
  secondsUntilChange: number;
}>();
defineEmits(['toggle']);

const tooltip = computed(() =>
  props.isActive
    ? `Sale ends Saturday at +0. Click to wait ${formatDuration(props.secondsUntilChange)} until it ends.`
    : `Next sale starts Friday at +0. Click to wait ${formatDuration(props.secondsUntilChange)} until it starts.`
);
</script>
