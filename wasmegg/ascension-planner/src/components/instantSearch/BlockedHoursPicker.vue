<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-1.5">
      <button v-for="p in presets" :key="p.label" type="button" class="preset-btn" @click="add(p.hours)">
        + {{ p.label }}
      </button>
      <button
        v-if="model.length"
        type="button"
        class="ml-1 text-[11px] font-bold text-slate-500 hover:underline"
        @click="model = []"
      >
        Clear all
      </button>
    </div>

    <div class="overflow-x-auto">
      <div class="inline-grid select-none gap-px" :style="{ gridTemplateColumns: `2.25rem repeat(24, minmax(1.1rem, 1fr))` }">
        <span />
        <span
          v-for="h in 24"
          :key="`h${h}`"
          class="text-center text-[9px] font-bold text-slate-400"
          :class="(h - 1) % 3 ? 'invisible' : ''"
          >{{ hourLabel(h - 1) }}</span
        >
        <template v-for="(day, d) in dayLabels" :key="day">
          <span class="pr-1 text-right text-[10px] font-black uppercase text-slate-400 leading-6">{{ day }}</span>
          <button
            v-for="h in 24"
            :key="`${d}-${h}`"
            type="button"
            class="h-6 rounded-sm transition-colors"
            style="touch-action: none"
            :class="blocked.has(d * 24 + h - 1) ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-100 hover:bg-slate-200'"
            :aria-pressed="blocked.has(d * 24 + h - 1)"
            :aria-label="`${day} ${hourLabel(h - 1)}`"
            @pointerdown="startPaint(d * 24 + h - 1, $event)"
            @pointerenter="paint(d * 24 + h - 1)"
            @keydown.enter.prevent="toggle(d * 24 + h - 1)"
            @keydown.space.prevent="toggle(d * 24 + h - 1)"
          />
        </template>
      </div>
    </div>

    <p class="text-[11px] text-slate-500">
      Click or drag across hours to block or unblock them. Hours are read in the time zone above ({{ timezoneLabel }}).
      <template v-if="model.length"> {{ model.length }} hour{{ model.length === 1 ? '' : 's' }} a week blocked.</template>
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * Weekly hours no prestige may start in (sleep, work), as a week of 24-hour rows: each blocked hour an
 * index 0-167, Monday 00:00-01:00 first (lib/instantSearch/blockedTime.ts). Click or drag paints: the
 * first cell decides whether the drag blocks or unblocks.
 */
import { computed, onUnmounted } from 'vue';

const model = defineModel<number[]>({ required: true });
const props = defineProps<{ timezone: string }>();

const blocked = computed(() => new Set(model.value));

/** Monday-first weekday names in the viewer's language (2024-01-01 was a Monday). */
const dayLabels = Array.from({ length: 7 }, (_, i) =>
  new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })
);
const hourLabel = (h: number) =>
  new Date(Date.UTC(2024, 0, 1, h)).toLocaleTimeString(undefined, { hour: 'numeric', timeZone: 'UTC' });
const timezoneLabel = computed(() => props.timezone.split('/').pop()!.replace(/_/g, ' '));

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
const everyDay = (hours: number[]) => range(0, 7).flatMap(d => hours.map(h => d * 24 + h));
const presets = [
  { label: 'Sleep 11 PM–7 AM', hours: everyDay([23, ...range(0, 7)]) },
  { label: 'Work 9–5 weekdays', hours: range(0, 5).flatMap(d => range(9, 17).map(h => d * 24 + h)) },
];

function set(hours: number[], on: boolean) {
  const next = new Set(model.value);
  for (const h of hours) {
    if (on) next.add(h);
    else next.delete(h);
  }
  model.value = [...next].sort((a, b) => a - b);
}
const add = (hours: number[]) => set(hours, true);
const toggle = (h: number) => set([h], !blocked.value.has(h));

/** While dragging: whether cells passed over are blocked or unblocked. */
let painting: boolean | null = null;
function startPaint(h: number, event: PointerEvent) {
  // Touch captures the pointer to the first cell; release it so the cells dragged over get pointerenter.
  (event.target as Element).releasePointerCapture?.(event.pointerId);
  painting = !blocked.value.has(h);
  set([h], painting);
}
function paint(h: number) {
  if (painting !== null && blocked.value.has(h) !== painting) set([h], painting);
}
const stopPaint = () => (painting = null);
window.addEventListener('pointerup', stopPaint);
window.addEventListener('pointercancel', stopPaint);
onUnmounted(() => {
  window.removeEventListener('pointerup', stopPaint);
  window.removeEventListener('pointercancel', stopPaint);
});
</script>

<style scoped>
.preset-btn {
  @apply rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50;
}
</style>
