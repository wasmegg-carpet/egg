<template>
  <section class="rounded-xl border border-slate-200">
    <button
      type="button"
      class="flex w-full items-center gap-2 px-4 py-3 text-left"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="inline-block w-3 text-slate-400">{{ open ? '⌄' : '›' }}</span>
      <h3 class="text-sm font-bold text-slate-800">Filters</h3>
      <span
        v-if="activeCount"
        class="rounded-md bg-indigo-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-indigo-700"
        >{{ activeCount }} on</span
      >
      <span class="ml-auto truncate text-[11px] text-slate-400">{{ summary }}</span>
    </button>

    <div v-if="open" class="space-y-6 border-t border-slate-200 px-4 py-4">
      <div>
        <div class="mb-1 flex flex-wrap items-baseline gap-2">
          <h4 class="text-xs font-bold text-slate-700">Number of ascensions</h4>
          <span class="text-[11px] text-slate-400">Searches up to the highest picked; lower counts show with no new search.</span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            v-for="n in ALL_COUNTS()"
            :key="n"
            type="button"
            class="h-8 w-9 rounded-lg text-xs font-black transition-colors"
            :class="
              counts.has(n) ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
            "
            :aria-pressed="counts.has(n)"
            :aria-label="`${n} ascension${n === 1 ? '' : 's'}`"
            @click="toggleCount(n)"
          >
            {{ n }}
          </button>
          <button type="button" class="ml-2 text-[11px] font-bold text-emerald-700 hover:underline" @click="setCounts(ALL_COUNTS())">
            All
          </button>
          <button type="button" class="text-[11px] font-bold text-slate-500 hover:underline" @click="setCounts([])">
            None
          </button>
        </div>
      </div>

      <div>
        <label class="flex cursor-pointer items-start gap-2">
          <input v-model="store.waitForEggs" type="checkbox" class="mt-0.5 h-4 w-4 accent-emerald-600" />
          <span>
            <span class="block text-xs font-bold text-slate-700">Wait for eggs before prestiging</span>
            <span class="block text-[11px] text-slate-400">
              A prestige may wait whole hours after reaching its stop when the eggs your farm lays meanwhile (or a
              better hour to start the next build) get you to the target sooner. Makes the search take longer.
            </span>
          </span>
        </label>
      </div>

      <div>
        <div class="mb-2 flex flex-wrap items-baseline gap-2">
          <h4 class="text-xs font-bold text-slate-700">Dates to avoid</h4>
          <span class="text-[11px] text-slate-400">
            No prestige starts on these days (birthdays, holidays, a vacation): one that would is forced to wait until the day is
            over, and the eggs your farm lays meanwhile carry into the next ascension. Continuing your current
            ascension isn't affected.
          </span>
        </div>
        <AvoidDatesPicker v-model="store.avoidDates" :timezone="store.timezone" />
      </div>

      <div>
        <div class="mb-2 flex flex-wrap items-baseline gap-2">
          <h4 class="text-xs font-bold text-slate-700">Hours to avoid</h4>
          <span class="text-[11px] text-slate-400">
            No prestige starts in these hours each week (sleep, work): one that would is forced to wait until they're over, and the
            eggs your farm lays meanwhile carry into the next ascension.
          </span>
        </div>
        <BlockedHoursPicker v-model="store.blockedHours" :timezone="store.timezone" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/** Chain Finder's filters, collapsed by default: which numbers of ascensions to show, whether
 *  prestiges may wait for eggs, and days and hours no prestige may start in (stores/instantSearch.ts
 *  `ascensionCounts`, `waitForEggs`, `avoidDates`, `blockedHours`). */
import { computed, ref } from 'vue';
import AvoidDatesPicker from './AvoidDatesPicker.vue';
import BlockedHoursPicker from './BlockedHoursPicker.vue';
import { ALL_COUNTS, MAX_ASCENSIONS, useInstantSearchStore } from '@/stores/instantSearch';

const store = useInstantSearchStore();
const open = ref(false);

const counts = computed(() => new Set(store.ascensionCounts));
function setCounts(list: number[]) {
  store.ascensionCounts = [...list].sort((a, b) => a - b);
}
function toggleCount(n: number) {
  setCounts(counts.value.has(n) ? store.ascensionCounts.filter(x => x !== n) : [...store.ascensionCounts, n]);
}

const countsFiltered = computed(() => store.ascensionCounts.length < MAX_ASCENSIONS);
const activeCount = computed(
  () =>
    (countsFiltered.value ? 1 : 0) +
    (store.waitForEggs ? 0 : 1) +
    (store.avoidDates.length ? 1 : 0) +
    (store.blockedHours.length ? 1 : 0)
);
/** What's on, for the closed header. */
const summary = computed(() => {
  const bits: string[] = [];
  if (countsFiltered.value) bits.push(store.ascensionCounts.length ? `ascensions ${store.ascensionCounts.join(', ')}` : 'no ascension counts');
  if (!store.waitForEggs) bits.push('no waiting for eggs');
  if (store.avoidDates.length) bits.push(`${store.avoidDates.length} day${store.avoidDates.length === 1 ? '' : 's'} avoided`);
  if (store.blockedHours.length) bits.push(`${store.blockedHours.length} h/week blocked`);
  return bits.join(' · ');
});
</script>
