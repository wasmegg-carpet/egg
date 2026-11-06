<template>
  <div class="rounded-2xl border border-emerald-200 bg-white p-4 sm:p-6">
    <div class="flex flex-wrap items-center gap-3" :class="store.answerCollapsed ? '' : 'mb-3'">
      <button
        v-if="store.comparison"
        type="button"
        class="text-slate-400 hover:text-slate-700"
        :aria-expanded="!store.answerCollapsed"
        @click="store.answerCollapsed = !store.answerCollapsed"
      >
        {{ store.answerCollapsed ? '›' : '⌄' }}
      </button>
      <h3 class="text-lg font-black text-slate-900">Instant answer</h3>
      <span
        class="text-[10px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md"
        >precomputed</span
      >
      <span v-if="store.answerCollapsed && lead" class="text-xs text-slate-500">{{ chainText(lead) }}</span>
      <span class="ml-auto text-[11px] text-slate-400">{{ answer.found.checked.toLocaleString() }} routes checked in {{ (answer.ms / 1000).toFixed(1) }} s</span>
    </div>

    <template v-if="!store.answerCollapsed">

    <div v-if="filterNote" class="mb-4 text-[11px] text-slate-500">{{ filterNote }}</div>
    <div v-if="shiftNote" class="mb-4 text-[11px] text-slate-500">{{ shiftNote }}</div>
    <div
      v-if="store.avoidChanged"
      class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
    >
      Your dates or hours to avoid have changed since this answer: press Find routes again to use them.
    </div>
    <div
      v-if="store.waitsChanged"
      class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
    >
      Waiting for eggs was turned {{ store.waitForEggs ? 'on' : 'off' }} since this answer: press Find routes again to
      use it.
    </div>

    <div
      v-if="store.countsPastAnswer"
      class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
    >
      This answer searched up to {{ answer.options.maxAscensions }} ascensions: press Find routes again for higher
      counts.
    </div>

    <div
      v-if="store.artifactsChanged"
      class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
    >
      Your earnings artifacts or stones have changed since this answer: press Find routes again to use them.
    </div>

    <div v-if="!lead" class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      <template v-if="store.countsPastAnswer">Nothing to show yet for {{ countsText }} ascensions.</template>
      <template v-else-if="byDate">No route reaches a higher TE by {{ show(answer.deadline!) }}.</template>
      <template v-else-if="!store.ascensionCounts.length">No numbers of ascensions are picked in Filters.</template>
      <template v-else>No route reaches {{ answer.final }} TE with {{ countsText }} ascensions.</template>
    </div>

    <div v-else class="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
      <template v-if="byDate">
        <div class="text-[10px] font-black uppercase tracking-widest text-emerald-700">
          Highest TE by {{ show(answer.deadline!) }}
        </div>
        <div class="mt-1 flex flex-wrap items-baseline gap-3">
          <span class="text-2xl font-black text-slate-900">{{ lastTE(lead) }} TE</span>
          <span class="text-lg font-black" :class="spareClass(lead)">{{ days(spare(lead)) }} to spare</span>
          <span v-if="tight(lead)" class="text-[10px] font-black uppercase tracking-widest text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md">tight</span>
        </div>
        <div class="mt-1 text-sm font-bold text-slate-800">{{ chainText(lead) }}</div>
        <div class="text-xs text-slate-600">
          Reached {{ show(lead.end) }} · {{ count(lead) }} ascension{{ count(lead) === 1 ? '' : 's' }}
        </div>
      </template>
      <template v-else>
        <div class="text-[10px] font-black uppercase tracking-widest text-emerald-700">Fastest route</div>
        <div class="mt-1 text-lg font-black text-slate-900">{{ chainText(lead) }}</div>
        <div class="text-xs text-slate-600">
          Reaches {{ answer.final }} on <span class="font-bold">{{ show(lead.end) }}</span> · {{ days(lead.seconds) }} ·
          {{ count(lead) }} ascension{{ count(lead) === 1 ? '' : 's' }}
        </div>
      </template>
      <div class="mt-2 text-xs text-slate-700">
        <span class="font-bold">First step:</span> {{ firstStepText(lead) }}
      </div>
    </div>

    <table v-if="rows.length" class="mt-4 w-full text-xs">
      <thead>
        <tr class="text-left text-[10px] font-black uppercase tracking-widest text-slate-400">
          <th class="py-2 pr-2">Ascensions</th>
          <template v-if="byDate">
            <th class="py-2 pr-2">Highest TE</th>
            <th class="py-2 pr-2">Spare</th>
          </template>
          <template v-else>
            <th class="py-2 pr-2">Reaches {{ answer.final }}</th>
            <th class="py-2 pr-2">Behind</th>
          </template>
          <th class="py-2">Route</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="{ k, route } in rows" :key="k">
          <tr
            class="border-t border-slate-100 align-top cursor-pointer hover:bg-slate-50"
            :class="route === lead ? 'bg-emerald-50/60' : ''"
            @click="toggle(k)"
          >
            <td class="py-2 pr-2 font-bold text-slate-800">
              <span class="inline-block w-3 text-slate-400">{{ open.has(k) ? '⌄' : '›' }}</span> {{ k }}
            </td>
            <template v-if="byDate">
              <td class="py-2 pr-2 font-bold text-slate-800">{{ lastTE(route) }} TE</td>
              <td class="py-2 pr-2">
                <span class="font-bold" :class="spareClass(route)">{{ days(spare(route)) }}</span>
                <span v-if="tight(route)" class="ml-1 text-[9px] font-black uppercase text-amber-700 bg-amber-100 px-1 py-0.5 rounded">tight</span>
              </td>
            </template>
            <template v-else>
              <td class="py-2 pr-2 text-slate-700">
                {{ show(route.end) }}<br /><span class="text-slate-400">{{ days(route.seconds) }}</span>
              </td>
              <td class="py-2 pr-2 text-slate-600">{{ route === lead ? 'fastest' : `+${days(route.end - lead!.end)}` }}</td>
            </template>
            <td class="py-2 text-slate-800">{{ chainText(route) }}</td>
          </tr>
          <tr v-if="open.has(k)">
            <td colspan="4" class="pb-3">
              <ol class="ml-5 rounded-lg bg-slate-50 p-3 space-y-1 text-[11px] text-slate-600">
                <li v-if="endsInProgress(route)">
                  <span class="font-bold text-slate-800">{{ answer.inProgress!.claimedTE }} → {{ route.legs[0].from }}</span>:
                  end your current ascension
                  <template v-if="route.legs[0].waited">{{ wait(route.legs[0]) }} after reaching {{ route.legs[0].from }} TE</template>
                  <template v-else>{{ route.legs[0].held ? 'once your blocked dates or hours are past' : 'now' }}</template>, claiming
                  {{ route.legs[0].from - answer.inProgress!.claimedTE }} pending TE ({{ show(route.legs[0].start) }})
                </li>
                <li v-for="(leg, i) in route.legs" :key="i" class="flex gap-1">
                  <span class="shrink-0">
                    <span class="font-bold text-slate-800"
                      >{{ teText(i === 0 && leg.continued ? legFrom(leg, i) : leg.exactFrom) }} →
                      {{ teText(legExactEnd(route, i)) }}</span
                    >
                    <span class="text-slate-500"> ({{ formatNumber(leg.rate * 3600) }})</span>:
                  </span>
                  <span>
                    <span class="block">
                      {{ shortDays(legEnd(route, i) - leg.start) }}
                      <template v-if="leg.continued">· continue your current ascension to {{ show(legEnd(route, i)) }}</template>
                      <template v-else>
                        · {{ leg.sales }}-sale{{ leg.tier13 ? ' + T13' : '' }} · {{ show(leg.start) }} to
                        {{ show(legEnd(route, i)) }}
                      </template>
                    </span>
                    <span v-if="route.legs[i + 1]?.waited" class="block">
                      wait {{ wait(route.legs[i + 1]) }} after reaching {{ route.legs[i + 1].from }}
                    </span>
                    <span v-if="!leg.continued && (leg.held || i === 0)" class="block">
                      <template v-if="i === 0 && endsInProgress(route)">the fresh build</template>
                      <template v-else-if="leg.held">prestige waited for your blocked dates or hours</template>
                      <template v-else-if="i === 0">{{ answer.hypothetical ? 'prestige' : 'prestige now' }}</template>
                    </span>
                  </span>
                </li>
              </ol>
              <div class="ml-5 mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="rounded-lg bg-indigo-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-indigo-700"
                  @click="openInAutoPlanner(route)"
                >
                  Open in AAP ↗
                </button>
                <span class="text-[10px] text-slate-400">
                  New tab: these targets, start, waits and builds{{ answer.siloMode ? ', silo mode on' : '' }}
                </span>
              </div>
              <div class="ml-5 mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                  :disabled="store.status === 'running'"
                  @click="store.exploreSimilar(route)"
                >
                  Explore similar plans
                </button>
                <span class="text-[10px] text-slate-400">
                  Every {{ count(route) }}-ascension chain close to this one, to filter down and compare
                </span>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import { lastTE, type Route } from '@/lib/instantSearch/routeFinder';
import { MAX_ASCENSIONS, useInstantSearchStore, type InstantAnswer } from '@/stores/instantSearch';
import { formatDuration, formatNumber } from '@/lib/format';
import { handoffUrl, routeToHandoff } from '@/lib/instantSearch/autoPlannerHandoff';

const props = defineProps<{ answer: InstantAnswer }>();
const store = useInstantSearchStore();

const byDate = computed(() => props.answer.mode === 'date');
/** Under this much to spare, the date answer is flagged as tight. */
const TIGHT_SECONDS = 86400;

/** Each picked number of ascensions' route (Filters). */
const rows = computed(() => {
  const list = byDate.value ? props.answer.found.byDateByAscensions : props.answer.found.byAscensions;
  const picked = new Set(store.ascensionCounts);
  return list.flatMap((route, k) => (route && picked.has(k) ? [{ k, route }] : []));
});

/** The headline: the fastest of the rows, or by a date the highest TE (then the soonest). */
const lead = computed<Route | null>(() =>
  rows.value.reduce<Route | null>((a, { route: r }) => {
    if (!a) return r;
    if (byDate.value) return lastTE(r) > lastTE(a) || (lastTE(r) === lastTE(a) && r.end < a.end) ? r : a;
    return r.end < a.end ? r : a;
  }, null)
);

const countsText = computed(() => store.ascensionCounts.join(', '));
/** The filters this answer shows under. */
const filterNote = computed(() => {
  const bits: string[] = [];
  if (store.ascensionCounts.length < MAX_ASCENSIONS && store.ascensionCounts.length)
    bits.push(`Showing ${countsText.value} ascensions`);
  const n = props.answer.blocks.dates.length;
  const h = props.answer.blocks.hours.length;
  if (n) bits.push(`no prestige on the ${n} avoided day${n === 1 ? '' : 's'}`);
  if (h) bits.push(`none in your ${h} blocked hour${h === 1 ? '' : 's'} a week`);
  const text = bits.join('; ');
  return text ? `${text[0].toUpperCase()}${text.slice(1)}.` : '';
});

/** Once per answer: how the table was read for weaker earnings artifacts (store `earningsShift`). */
const shiftNote = computed(() => {
  const shift = props.answer.earningsShift;
  if (!(shift > 0)) return '';
  const te = props.answer.startTE;
  return (
    `Searched as TE ${Math.floor(te - shift)} for your ${te}: your earnings artifacts are ${shift.toFixed(2)} CTE below the ` +
    "table's, and every lookup rounds down to a whole TE so routes never promise more than your artifacts earn. " +
    'The TEs shown are your real ones.'
  );
});

const open = reactive(new Set<number>());
function toggle(k: number) {
  if (open.has(k)) open.delete(k);
  else open.add(k);
}

/** The route loaded into the Auto Planner in a new tab, so this answer stays put. */
function openInAutoPlanner(r: Route) {
  window.open(handoffUrl(routeToHandoff(props.answer, r)), '_blank', 'noopener');
}

/** Prestiging now ends the ascension in progress: that is an ascension of its own (routeFinder.ts). */
const endsInProgress = (r: Route) => !!props.answer.inProgress && !r.legs[0].continued;
/** Ascensions, the one in progress counted (continuing it, or ending it now). */
const count = (r: Route) => r.legs.length + (endsInProgress(r) ? 1 : 0);
/** A continued first leg runs from the TE already claimed. */
const legFrom = (leg: Route['legs'][number], i: number) =>
  i === 0 && leg.continued && props.answer.inProgress ? props.answer.inProgress.claimedTE : leg.from;
const spare = (r: Route) => props.answer.deadline! - r.end;
const tight = (r: Route) => spare(r) < TIGHT_SECONDS;
const spareClass = (r: Route) => (tight(r) ? 'text-amber-700' : 'text-emerald-700');
/** The first ascension in words: continue to its stop, or prestige (on the next whole hour). */
function firstStepText(r: Route): string {
  const l = r.legs[0];
  if (l.waited)
    return `keep your current farm laying until ${wait(l)} after reaching ${l.from} TE, then prestige (the build starts ${show(l.start)}).`;
  if (l.held) return `prestige once your blocked dates or hours are past (the build starts ${show(l.start)}).`;
  return l.continued
    ? `continue your current ascension to ${l.to} TE (${show(l.end)})${r.legs.length > 1 ? ', then prestige' : ''}.`
    : `${props.answer.hypothetical ? 'prestige' : 'prestige now'} (the build starts ${show(l.start)}).`;
}
/**
 * The route as TEs. With an ascension in progress it starts at the TE claimed: straight to the first
 * stop when continuing (201 → 225 → 250), or through the TE that prestiging now claims (201 → 207 →
 * 225 → 250). Otherwise from the start TE.
 */
function chainText(r: Route): string {
  const ip = props.answer.inProgress;
  const head = ip ? [ip.claimedTE, ...(endsInProgress(r) ? [r.legs[0].from] : [])] : [props.answer.startTE];
  return [...head, ...r.chain].join(' → ');
}
const days = (seconds: number) => `${(seconds / 86400).toFixed(2)} days`;
const shortDays = (seconds: number) => `${(seconds / 86400).toFixed(2)}d`;
/** When a leg's farm is done: its stop reached, or, when the next prestige waits for eggs, that
 *  prestige (the wait is spent on this leg's farm). */
/** TE with fractions where a leg's farm leaves off: what the next build starts from (the farm lays on
 *  until that prestige), or, for the last, its stop. */
const legExactEnd = (r: Route, i: number) => r.legs[i + 1]?.exactFrom ?? r.legs[i].exactEnd;
/** TE to a tenth, always with one decimal so the rows line up, cut rather than rounded (288.97 is
 *  not 289). */
const teText = (te: number) => (Math.floor(te * 10 + 1e-9) / 10).toFixed(1);
const legEnd = (r: Route, i: number) => (r.legs[i + 1]?.waited ? r.legs[i + 1].start : r.legs[i].end);
/** How long to wait before a prestige that waits for eggs: from reaching the TE it starts from (the
 *  last whole TE the wait passed, else the stop) to the prestige. */
const wait = (leg: Route['legs'][number]) => formatDuration(leg.start - (leg.waitFrom ?? leg.start - (leg.waited ?? 0)));

/** In the time zone the search was run with (the picker's). */
const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: props.answer.timezone,
    })
);
const show = (unix: number) => dateFormat.value.format(new Date(unix * 1000));
</script>
