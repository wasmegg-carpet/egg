<template>
  <div class="flex flex-col gap-2">
    <button
      class="group relative overflow-hidden bg-gradient-to-br from-slate-50 to-white border border-slate-100 rounded-2xl p-5 text-left transition-all hover:border-slate-200 hover:shadow-md active:scale-[0.98]"
      @click="$emit('click')"
    >
      <div class="flex justify-between items-start gap-4 mb-2">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center p-2 shadow-sm group-hover:scale-110 transition-transform"
            :class="iconClass"
          >
            <img :src="iconURL(icon, 64)" class="w-full h-full object-contain" />
          </div>
          <div>
            <h4 class="text-sm font-black text-slate-800 uppercase tracking-tight">{{ title }}</h4>
            <p class="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{{ subtitle }}</p>
          </div>
        </div>
        <div class="text-right">
          <span class="text-xs font-mono-premium font-black" :class="secondsClass">
            {{ formatDuration(seconds) }}
          </span>
        </div>
      </div>
    </button>
  </div>
</template>

<script setup lang="ts">
import { iconURL } from 'lib';
import { formatDuration } from 'lib/planners/format';

defineProps<{
  icon: string;
  iconClass: string;
  title: string;
  subtitle: string;
  seconds: number;
  secondsClass: string;
}>();
defineEmits(['click']);
</script>
