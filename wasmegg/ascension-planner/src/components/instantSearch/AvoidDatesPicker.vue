<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-start gap-4">
      <div class="w-full max-w-xs select-none rounded-xl border border-slate-200 bg-white p-3">
        <div class="mb-2 flex items-center justify-between">
          <button type="button" class="nav-btn" aria-label="Previous month" @click="shiftMonth(-1)">‹</button>
          <span class="text-xs font-black uppercase tracking-wider text-slate-700">{{ monthLabel }}</span>
          <button type="button" class="nav-btn" aria-label="Next month" @click="shiftMonth(1)">›</button>
        </div>
        <div class="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase text-slate-400">
          <span v-for="d in weekdayLabels" :key="d">{{ d }}</span>
        </div>
        <div class="mt-1 grid grid-cols-7 gap-1">
          <span v-for="n in leadingBlanks" :key="`b${n}`" />
          <button
            v-for="day in monthDays"
            :key="day.date"
            type="button"
            class="h-8 rounded-lg text-xs font-bold transition-colors"
            :class="dayClass(day.date)"
            :title="day.date"
            @click="onDayClick(day.date, $event)"
          >
            {{ day.n }}
          </button>
        </div>
      </div>

      <div class="min-w-[12rem] flex-1 space-y-2 text-[11px] text-slate-500">
        <p>
          Click days to add or remove them. <span class="font-bold">Shift-click</span> to add every day from the last
          one you clicked.
        </p>
        <p>Days are read in the time zone above ({{ timezoneLabel }}).</p>
      </div>
    </div>

    <div v-if="ranges.length" class="flex flex-wrap items-center gap-1.5">
      <span
        v-for="r in ranges"
        :key="r.from"
        class="inline-flex items-center gap-1 rounded-lg bg-indigo-100 py-0.5 pl-2 pr-1 text-[11px] font-bold text-indigo-800"
      >
        {{ r.from === r.to ? short(r.from) : `${short(r.from)} – ${short(r.to)}` }}
        <button
          type="button"
          class="rounded px-1 text-indigo-500 hover:bg-indigo-200 hover:text-indigo-900"
          :aria-label="`Remove ${r.from === r.to ? r.from : `${r.from} to ${r.to}`}`"
          @click="removeRange(r)"
        >
          ×
        </button>
      </span>
      <button type="button" class="ml-1 text-[11px] font-bold text-slate-500 hover:underline" @click="model = []">
        Clear all
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Days to avoid, picked on a month calendar: each a YYYY-MM-DD string. Click toggles a day, and
 * shift-click adds every day from the last one clicked. The picked days are listed below as runs of
 * consecutive days.
 */
import { computed, ref } from 'vue';
import { nextDate } from '@/lib/instantSearch/blockedTime';
import { formatUnixToDateInput } from '@/lib/format';

const model = defineModel<string[]>({ required: true });
const props = defineProps<{ timezone: string }>();

const today = computed(() => formatUnixToDateInput(Date.now() / 1000, props.timezone));
/** The month shown: its first day, YYYY-MM-01. */
const month = ref(today.value.slice(0, 8) + '01');

const selected = computed(() => new Set(model.value));

const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const utc = (date: string) => {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d));
};

const monthLabel = computed(() =>
  utc(month.value).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
);
/** Sunday-first weekday initials in the viewer's language. */
const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
  new Date(Date.UTC(2023, 0, 1 + i)).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' })
);
const leadingBlanks = computed(() => utc(month.value).getUTCDay());
const monthDays = computed(() => {
  const out: { date: string; n: number }[] = [];
  for (let d = month.value; d.slice(0, 7) === month.value.slice(0, 7); d = nextDate(d)) out.push({ date: d, n: parts(d)[2] });
  return out;
});

function shiftMonth(by: number) {
  const [y, m] = parts(month.value);
  month.value = new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 10);
}

const timezoneLabel = computed(() => props.timezone.split('/').pop()!.replace(/_/g, ' '));

/** Every day from `a` to `b`, whichever order they come in. */
function daysBetween(a: string, b: string): string[] {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const out: string[] = [];
  for (let d = from; d <= to; d = nextDate(d)) out.push(d);
  return out;
}

function set(days: string[], on: boolean) {
  const next = new Set(model.value);
  for (const d of days) {
    if (on) next.add(d);
    else next.delete(d);
  }
  model.value = [...next].sort();
}

/** The last day clicked, which a shift-click ranges from. */
let anchor: string | null = null;

function onDayClick(date: string, event: MouseEvent) {
  if (event.shiftKey && anchor) set(daysBetween(anchor, date), true);
  else set([date], !selected.value.has(date));
  anchor = date;
}

function dayClass(date: string): string {
  if (selected.value.has(date)) return 'bg-indigo-600 text-white hover:bg-indigo-700';
  const muted = date < today.value ? 'text-slate-300' : 'text-slate-700';
  const ring = date === today.value ? ' ring-1 ring-slate-300' : '';
  return `${muted}${ring} hover:bg-slate-100`;
}

/** The picked days as runs of consecutive days. */
const ranges = computed(() => {
  const out: { from: string; to: string }[] = [];
  for (const d of model.value) {
    const last = out[out.length - 1];
    if (last && nextDate(last.to) === d) last.to = d;
    else out.push({ from: d, to: d });
  }
  return out;
});

function removeRange(r: { from: string; to: string }) {
  set(daysBetween(r.from, r.to), false);
}

const short = (date: string) =>
  utc(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.slice(0, 4) !== today.value.slice(0, 4) ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
</script>

<style scoped>
.nav-btn {
  @apply h-7 w-7 rounded-lg text-sm font-black text-slate-500 hover:bg-slate-100;
}
</style>
