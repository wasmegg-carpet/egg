<template>
  <div class="rounded-2xl border border-indigo-200 bg-white p-4 sm:p-6">
    <div class="flex flex-wrap items-center gap-3 mb-3">
      <h3 class="text-lg font-black text-slate-900">Chain comparison</h3>
      <span
        class="text-[10px] font-black uppercase tracking-widest text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-md"
        >{{ count }} ascension{{ count === 1 ? '' : 's' }}</span
      >
      <button
        type="button"
        class="ml-auto rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100"
        @click="store.closeComparison()"
      >
        Close ✕
      </button>
    </div>

    <div class="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
      <div class="text-[10px] font-black uppercase tracking-widest text-indigo-700">Your plan</div>
      <div class="mt-1 text-lg font-black text-slate-900">{{ chainText(comparison.route) }}</div>
      <div class="text-xs text-slate-600">
        Reaches {{ lastTE(comparison.route) }} on <span class="font-bold">{{ show(comparison.route.end) }}</span> ·
        {{ days(comparison.route.seconds) }}
        <template v-if="answer.deadline !== undefined">
          · {{ days(answer.deadline - comparison.route.end) }} to spare</template
        >
      </div>
      <div v-if="comparison.space?.base && answer.waitForEggs" class="mt-1 text-[11px] text-slate-500">
        Without its waits for eggs: {{ show(comparison.space.base.end) }} ({{
          deltaDays(comparison.space.base.end - comparison.route.end)
        }}).
      </div>
    </div>

    <!-- Filters -->
    <div class="mt-4 grid gap-3 rounded-xl border border-slate-200 p-4 text-xs text-slate-700">
      <label class="flex flex-wrap items-center gap-2">
        At most
        <input
          v-model.number="filter.slackDays"
          type="number"
          min="0"
          step="0.1"
          class="input-premium w-20 py-1.5 px-2 text-sm font-mono-premium font-bold text-slate-900"
        />
        days slower than your plan
      </label>
      <div v-if="hasGaps" class="flex flex-wrap items-center gap-2">
        <span>Between</span>
        <input
          v-model.number="filter.minGap"
          type="number"
          min="1"
          class="input-premium w-20 py-1.5 px-2 text-sm font-mono-premium font-bold text-slate-900"
        />
        <span>and</span>
        <input
          v-model.number="filter.maxGap"
          type="number"
          :min="filter.minGap"
          class="input-premium w-20 py-1.5 px-2 text-sm font-mono-premium font-bold text-slate-900"
        />
        <span>TE between prestiges</span>
        <span class="text-[11px] text-slate-400">
          (yours: {{ planGaps.join(', ') }}; the last ascension isn't counted)
        </span>
      </div>
      <div class="space-y-2">
        <div v-for="(w, i) in filter.windows" :key="i" class="flex flex-wrap items-center gap-2">
          <span>A prestige within</span>
          <input
            v-model.number="w.days"
            type="number"
            min="0"
            class="input-premium w-16 py-1.5 px-2 text-sm font-mono-premium font-bold text-slate-900"
          />
          <span>day{{ w.days === 1 ? '' : 's' }} of</span>
          <input v-model="w.date" type="date" class="input-premium py-1.5 px-2 text-sm text-slate-900" />
          <button
            type="button"
            class="rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            :aria-label="`Remove the day ${w.date}`"
            @click="filter.windows.splice(i, 1)"
          >
            ✕
          </button>
        </div>
        <button type="button" class="text-[11px] font-bold text-indigo-700 hover:underline" @click="addWindow">
          + A prestige near a day
        </button>
      </div>
    </div>

    <!-- Counts and status -->
    <div class="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
      <div>
        <span class="text-2xl font-black text-slate-900">{{ foundText }}</span>
        <span class="ml-1 text-xs text-slate-500">chains found</span>
      </div>
      <div>
        <span class="text-2xl font-black text-indigo-700">{{ comparison.matches?.toLocaleString() ?? '–' }}</span>
        <span class="ml-1 text-xs text-slate-500">match your filters</span>
      </div>
      <span v-if="comparison.space" class="ml-auto text-[11px] text-slate-400">
        searched in {{ (comparison.space.ms / 1000).toFixed(1) }} s
      </span>
    </div>

    <div class="mt-2 space-y-2 text-[11px]">
      <div v-if="comparison.status === 'finding'" class="text-slate-500">
        <template v-if="comparison.progress?.stage === 'bound'">
          Working out the table's quickest ascensions (once per table): {{ comparison.progress.done }} of
          {{ comparison.progress.of }} TEs…
        </template>
        <template v-else-if="comparison.progress?.stage === 'chains'">
          Finding chains: {{ comparison.progress.done.toLocaleString() }} so far…
        </template>
        <template v-else>Finding chains…</template>
      </div>
      <p v-else-if="comparison.status === 'error'" class="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
        {{ comparison.error }}
      </p>
      <template v-else-if="comparison.space">
        <div
          v-if="comparison.space.capped"
          class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800"
        >
          The search stopped early, so there are more chains than this. Lower the days slower or narrow the TE between
          prestiges to see them all.
        </div>
        <div v-if="tooMany" class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
          Narrow the filters to {{ SHOW_LIMIT.toLocaleString() }} chains or fewer to list them.
        </div>
        <template v-else-if="answer.waitForEggs && comparison.matches">
          <div v-if="comparison.waits === 'running'" class="text-slate-500">
            Working out waits for eggs: {{ comparison.progress?.done ?? 0 }} of {{ comparison.progress?.of ?? '…' }}…
          </div>
          <div
            v-else-if="comparison.waits === 'none'"
            class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600"
          >
            These times don't wait for eggs. Narrow the filters to about {{ waitLimit }} chains and each one's waits are
            worked out, for more precise times.
          </div>
          <div v-else class="text-emerald-700">Times include each chain's own waits for eggs.</div>
        </template>
      </template>
    </div>

    <!-- The chains -->
    <ol v-if="plans.length" class="mt-4 space-y-2">
      <li
        v-for="(c, idx) in shown"
        :key="c.route.chain.join(',')"
        class="rounded-xl border p-3"
        :class="isPlan(c) ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200'"
      >
        <button type="button" class="block w-full text-left" @click="toggle(idx)">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span class="text-[11px] text-slate-400">{{ open.has(idx) ? '⌄' : '›' }}</span>
            <span class="text-sm font-bold text-slate-800">
              <template v-for="(te, i) in chainParts(c)" :key="i"
                ><template v-if="i"> → </template
                ><span :class="te.changed ? 'rounded bg-amber-100 px-1 text-amber-800' : ''">{{
                  te.te
                }}</span></template
              >
            </span>
            <span
              v-if="isPlan(c)"
              class="text-[9px] font-black uppercase tracking-widest text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded"
              >your plan</span
            >
            <span class="ml-auto text-sm font-black" :class="deltaClass(c.delta)">{{ deltaDays(c.delta) }}</span>
          </div>
          <div class="mt-0.5 pl-4 text-[11px] text-slate-500">
            Reaches {{ lastTE(c.route) }} on {{ show(c.route.end) }} · prestiges {{ prestigeDays(c.route) }}
          </div>
        </button>

        <div v-if="open.has(idx)" class="mt-2 pl-4">
          <ul class="space-y-0.5 text-xs text-slate-700">
            <li v-for="(line, i) in c.changes" :key="i" class="flex gap-1.5">
              <span class="text-indigo-400">•</span><span>{{ line }}</span>
            </li>
            <li v-if="!c.changes.length" class="text-slate-500">The same stops, builds and waits as your plan.</li>
          </ul>
          <div class="mt-1 text-xs font-bold" :class="deltaClass(c.delta)">
            {{ verdict(c) }} <span class="font-normal text-slate-600">{{ speedStory(c) }}</span>
          </div>

          <table class="mt-3 w-full text-[11px]">
            <thead>
              <tr class="text-left text-[9px] font-black uppercase tracking-widest text-slate-400">
                <th class="py-1 pr-2">#</th>
                <th class="py-1 pr-2">Your plan</th>
                <th class="py-1 pr-2">This chain</th>
                <th class="py-1 text-right">Time</th>
              </tr>
            </thead>
            <tbody v-for="(st, si) in c.stretches" :key="si">
              <tr v-if="st.legs.length > 1" class="border-t border-slate-200 bg-slate-50 text-[10px]">
                <td colspan="3" class="py-1 pr-2 font-bold text-slate-600">
                  {{ st.from }} → {{ st.to }} TE: stops moved inside, so read these together
                </td>
                <td class="py-1 text-right font-black" :class="deltaClass(st.delta)">{{ deltaDays(st.delta) }}</td>
              </tr>
              <tr
                v-for="l in st.legs"
                :key="l.n"
                class="border-t border-slate-100 align-top"
                :class="l.notes.length ? '' : 'text-slate-400'"
              >
                <td class="py-1.5 pr-2 font-bold">{{ l.n }}</td>
                <td class="py-1.5 pr-2">
                  {{ l.base.from }} → {{ l.base.to }} · {{ legBuild(l.base) }}<br />
                  <span class="text-slate-400">{{ shortDays(l.baseSeconds) }}</span>
                </td>
                <td class="py-1.5 pr-2">
                  {{ l.alt.from }} → {{ l.alt.to }} · {{ legBuild(l.alt) }}<br />
                  <span class="text-slate-400"
                    >{{ shortDays(l.altSeconds)
                    }}<template v-if="!l.alt.continued"> · from {{ show(l.alt.start) }}</template></span
                  >
                  <span v-if="l.notes.length" class="block text-slate-500">{{ l.notes.join('; ') }}</span>
                </td>
                <td
                  class="py-1.5 text-right"
                  :class="st.legs.length > 1 ? 'text-slate-400' : ['font-bold', deltaClass(l.delta)]"
                >
                  {{ deltaDays(l.delta) }}
                </td>
              </tr>
            </tbody>
          </table>

          <button
            type="button"
            class="mt-3 rounded-lg bg-indigo-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white hover:bg-indigo-700"
            @click="openInAutoPlanner(c.route)"
          >
            Open in AAP ↗
          </button>
        </div>
      </li>
    </ol>
    <button
      v-if="plans.length > shown.length"
      type="button"
      class="mt-3 text-[11px] font-bold text-indigo-700 hover:underline"
      @click="limit += PAGE"
    >
      Show {{ Math.min(PAGE, plans.length - shown.length) }} more of {{ plans.length - shown.length }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { lastTE, type Route, type RouteLeg } from '@/lib/instantSearch/routeFinder';
import { comparePlans, deltaDays, speedStory, type PlanComparison } from '@/lib/instantSearch/chainComparison';
import { chainGaps } from '@/lib/instantSearch/chainSpace';
import { handoffUrl, routeToHandoff } from '@/lib/instantSearch/autoPlannerHandoff';
import { formatUnixToDateInput } from '@/lib/format';
import { SHOW_LIMIT, useInstantSearchStore, type Comparison, type InstantAnswer } from '@/stores/instantSearch';

const props = defineProps<{ answer: InstantAnswer; comparison: Comparison }>();
const store = useInstantSearchStore();

/** The store's filters, edited in place (it filters again when they settle). */
const filter = computed(() => props.comparison.filter);
const planGaps = computed(() => chainGaps(props.comparison.route.chain, props.answer.startTE));
const hasGaps = computed(() => planGaps.value.length > 0);

/** A new window starts on the day of the plan's middle prestige, a day either side. */
function addWindow() {
  const legs = props.comparison.route.legs.filter(l => !l.continued);
  const mid = legs[Math.floor(legs.length / 2)]?.start ?? props.answer.start;
  filter.value.windows.push({ date: formatUnixToDateInput(mid, props.answer.timezone), days: 1 });
}

/** Chains listed per "Show more". */
const PAGE = 25;
const limit = ref(PAGE);
const open = reactive(new Set<number>());
watch(
  () => [props.comparison.routes, props.comparison.waited],
  () => {
    limit.value = PAGE;
    open.clear();
  }
);
function toggle(i: number) {
  if (open.has(i)) open.delete(i);
  else open.add(i);
}

/** Prestiging now ends the ascension in progress: an ascension of its own (routeFinder.ts). */
const endsInProgress = (r: Route) => !!props.answer.inProgress && !r.legs[0].continued;
const offset = computed(() => (endsInProgress(props.comparison.route) ? 1 : 0));
const count = computed(() => props.comparison.route.legs.length + offset.value);

const foundText = computed(() => {
  const sp = props.comparison.space;
  if (!sp || props.comparison.status === 'finding') return '–';
  return `${sp.count.toLocaleString()}${sp.capped ? '+' : ''}`;
});
const tooMany = computed(() => (props.comparison.matches ?? 0) > SHOW_LIMIT);
/** About how many chains' waits the worker works out at once (its 3-second budget). */
const waitLimit = computed(() => Math.max(1, Math.floor(3000 / Math.max(1, props.comparison.perWait))));

/** The chains listed (with their waits once worked out), each compared with your plan as found: the
 *  days-slower filter is measured from it too. */
const plans = computed<PlanComparison[]>(() => {
  const c = props.comparison;
  const list = c.waited ? [...c.waited].sort((a, b) => a.end - b.end) : (c.routes ?? []);
  return list.map(r => comparePlans(c.route, r, props.answer.start, offset.value, show));
});
const shown = computed(() => plans.value.slice(0, limit.value));
const isPlan = (c: PlanComparison) => c.route.chain.join(',') === props.comparison.route.chain.join(',');

function verdict(c: PlanComparison): string {
  if (Math.abs(c.delta) < 1800) return 'About as fast as your plan.';
  const base = props.comparison.route.seconds;
  const pct = (Math.abs(c.delta) / base) * 100;
  return `${c.delta > 0 ? 'Slower' : 'Faster'} by ${days(Math.abs(c.delta))} (${pct.toFixed(1)}%).`;
}
/** Under half an hour reads as no difference (chainComparison.ts `speedStory`). */
const deltaClass = (d: number) =>
  Math.abs(d) < 1800 ? 'text-slate-500' : d > 0 ? 'text-rose-600' : 'text-emerald-700';

/** The chain as TEs, as the answer writes it (from the TE claimed with an ascension in progress), each
 *  stop marked when it differs from your plan's. */
function chainParts(c: PlanComparison): { te: number; changed: boolean }[] {
  return [
    ...head(c.route).map(te => ({ te, changed: false })),
    ...c.route.chain.map((te, i) => ({ te, changed: c.changedStops.has(i) })),
  ];
}
function head(r: Route): number[] {
  const ip = props.answer.inProgress;
  return ip ? [ip.claimedTE, ...(endsInProgress(r) ? [r.legs[0].from] : [])] : [props.answer.startTE];
}
const chainText = (r: Route) => [...head(r), ...r.chain].join(' → ');
const legBuild = (l: RouteLeg) =>
  l.continued
    ? 'continue'
    : `${l.sales}-sale${l.tier13 ? ' + T13' : ''}${l.waited ? ` · wait ${Math.round(l.waited / 3600)}h` : ''}`;

function openInAutoPlanner(r: Route) {
  window.open(handoffUrl(routeToHandoff(props.answer, r)), '_blank', 'noopener');
}

const days = (seconds: number) => `${(seconds / 86400).toFixed(2)} days`;
const shortDays = (seconds: number) => `${(seconds / 86400).toFixed(2)}d`;
const zone = computed(() => props.answer.timezone);
const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: zone.value,
    })
);
const dayFormat = computed(
  () => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: zone.value })
);
function show(unix: number): string {
  return dateFormat.value.format(new Date(unix * 1000));
}
/** The days a chain prestiges on, for the day filters. */
const prestigeDays = (r: Route) =>
  r.legs
    .filter(l => !l.continued)
    .map(l => dayFormat.value.format(new Date(l.start * 1000)))
    .join(', ');
</script>
