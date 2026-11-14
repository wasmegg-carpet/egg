<template>
  <div
    class="rounded-2xl p-4 border shadow-sm relative overflow-hidden flex items-center justify-between gap-3 transition-all duration-300"
    :class="theme.card"
  >
    <div class="flex flex-col gap-0.5 text-left min-w-0">
      <div class="flex items-center gap-2">
        <div class="w-1.5 h-1.5 rounded-full" :class="isActive ? [theme.dot, 'animate-pulse'] : 'bg-slate-300'"></div>
        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">{{ label }}</span>
      </div>
      <span class="text-[11px] font-black uppercase tracking-tighter" :class="isActive ? theme.text : 'text-slate-400'">
        {{ isActive ? activeText : 'Inactive' }}
      </span>
    </div>

    <button
      type="button"
      v-tippy="tooltip"
      class="shrink-0 flex flex-col items-end rounded-xl border px-3 py-1.5 text-right transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2"
      :class="theme.button"
      @click="$emit('wait')"
    >
      <span class="text-[11px] font-black uppercase tracking-tight leading-tight">
        Wait for {{ eventName }} {{ isActive ? 'end' : 'start' }}
      </span>
      <span class="text-[10px] font-mono-premium font-bold opacity-75 leading-tight">
        {{ formatDuration(secondsUntilChange) }}
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatDuration } from 'lib/planners/format';

// A weekly event's status plus a button that advances the plan to its next edge: the end while it's
// on, the start while it's off. Shared by the Research Sale (ResearchActions.vue) and both planners'
// 2x Earnings cards (App.vue).

const props = defineProps<{
  /** The header line, e.g. "Monday 2x Earnings Event". */
  label: string;
  /** The event as the button names it, e.g. "2x Earnings". */
  eventName: string;
  /** Status text while the event is on (off always reads "Inactive"). */
  activeText: string;
  isActive: boolean;
  secondsUntilChange: number;
  tooltip: string;
  tone: 'indigo' | 'orange';
}>();
defineEmits(['wait']);

// Full class strings so Tailwind's scanner sees them.
const THEMES = {
  indigo: {
    card: 'bg-gradient-to-r from-indigo-50/80 via-white to-purple-50/80 border-indigo-100/50',
    dot: 'bg-indigo-400',
    text: 'text-indigo-600',
    button:
      'bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 focus-visible:ring-indigo-300',
  },
  orange: {
    card: 'bg-gradient-to-r from-orange-50/80 via-white to-amber-50/80 border-orange-100/50',
    dot: 'bg-orange-400',
    text: 'text-orange-600',
    button:
      'bg-white border-orange-200 text-orange-700 hover:bg-orange-50 hover:border-orange-300 focus-visible:ring-orange-300',
  },
} as const;

const theme = computed(() => THEMES[props.tone]);
</script>
