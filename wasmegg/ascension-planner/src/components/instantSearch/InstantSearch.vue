<template>
  <div class="section-premium p-4 sm:p-8 max-w-4xl mx-auto mt-4">
    <div class="flex items-center gap-4 mb-6">
      <div
        class="w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-200"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
          />
        </svg>
      </div>
      <h2 class="text-xl font-black text-slate-900 uppercase tracking-tight">Chain Finder</h2>
    </div>

    <StandardPermitWarning tool="Chain Finder" />

    <p class="text-xs text-slate-500 mb-6">
      Every ascension a maxed account can make was simulated ahead of time, from every TE at every hour of the week, so
      finding a route is arithmetic: it tries every stop at every TE, with up to {{ MAX_ASCENSIONS }} ascensions. Every
      prestige is a fresh build on the next whole hour (or later, when waiting for eggs gets you there sooner), on the
      best table the store has for your gear: your own, one built on the same gear, one built for your delivery set, or
      the maxed one. Weaker earnings artifacts are allowed for (the table is read lower by the Clothed TE they give up).
    </p>

    <fieldset :disabled="store.status === 'running'" class="space-y-6 disabled:opacity-50">
      <section>
        <h3 class="text-sm font-bold text-slate-800 mb-2">Target</h3>
        <SegmentedToggle v-model="store.mode" :options="targetModes" class="mb-3" />
        <label v-if="store.mode === 'te'" class="block text-xs text-slate-600">
          Reach
          <input
            v-model.number="store.targetTE"
            type="number"
            :min="store.startTE + 1"
            :max="MAX_TE"
            class="input-premium mx-1 w-28 text-sm font-mono-premium font-bold text-slate-900 py-2.5 px-4"
          />
          TE as soon as possible
        </label>
        <div v-else class="text-xs text-slate-600 space-y-2">
          <div>The highest TE by</div>
          <div class="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2">
            <DateTimeZonePicker
              v-model:date="store.deadlineDate"
              v-model:time="store.deadlineTime"
              v-model:timezone="store.timezone"
            />
          </div>
        </div>
      </section>

      <section>
        <h3 class="text-sm font-bold text-slate-800 mb-2">Start</h3>
        <SegmentedToggle v-model="startMode" :options="startModes" class="mb-3" />

        <template v-if="store.fromSave">
          <div
            v-if="store.current"
            class="rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-xs text-indigo-900"
          >
            <div class="flex flex-wrap items-start gap-3">
              <div class="flex-1 min-w-[16rem]">
                <span class="font-black">Current ascension detected:</span>
                {{ store.current.claimedTE }} TE claimed + {{ store.current.pendingTE }} pending |
                {{ formatNumber(store.current.elr * 3600) }}/hr delivery rate |
                {{ formatNumber(store.current.catchUpEggs) }} eggs laid since last sync accounted for.
              </div>
              <RefreshBackupButton />
            </div>
            <div class="mt-0.5 text-[11px] text-indigo-700/80">
              On {{ VIRTUE_EGG_NAMES[store.current.egg] }}.
              <template v-if="store.current.pendingTE > store.current.pendingAtBackup">
                {{ store.current.pendingAtBackup }} pending in the backup, +{{
                  store.current.pendingTE - store.current.pendingAtBackup
                }}
                from the eggs laid since.
              </template>
              <template v-if="store.current.lastSync">
                Backup from {{ showTime(store.current.lastSync) }} ({{ formatDuration(syncAge) }} ago).
              </template>
              <template v-else>No backup time in the save, so nothing was added for time since.</template>
            </div>
          </div>
          <div v-else class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            No ascension in progress in your save ({{ store.saveTE }} TE), so every route starts with a prestige on the
            next whole hour.
            <RefreshBackupButton class="ml-2" />
          </div>
        </template>

        <div v-else class="space-y-2 text-xs text-slate-600">
          <div class="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2">
            <DateTimeZonePicker
              v-model:date="store.hypotheticalDate"
              v-model:time="store.hypotheticalTime"
              v-model:timezone="store.timezone"
            />
          </div>
          <label class="block">
            Prestige at
            <input
              v-model.number="hypotheticalTE"
              type="number"
              :min="store.header?.from"
              :max="store.header?.to"
              class="input-premium mx-1 w-28 text-sm font-mono-premium font-bold text-slate-900 py-2.5 px-4"
            />
            TE
          </label>
          <p class="text-[11px] text-slate-400">
            Ignores your save: a fresh prestige on the first whole hour from then, with each egg's count exactly on its
            last threshold.
          </p>
        </div>
      </section>

      <!-- What the search assumes for artifacts: the save's, or edited to try others. -->
      <section class="rounded-xl border border-slate-200">
        <button
          type="button"
          class="flex w-full items-center gap-2 px-4 py-3 text-left"
          :aria-expanded="artifactsOpen"
          @click="artifactsOpen = !artifactsOpen"
        >
          <span class="inline-block w-3 text-slate-400">{{ artifactsOpen ? '⌄' : '›' }}</span>
          <h3 class="text-sm font-bold text-slate-800">Artifacts &amp; stones</h3>
          <span
            v-if="store.header && store.earningsShift > 0"
            class="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-700"
            >−{{ store.earningsShift.toFixed(2) }} CTE</span
          >
          <span class="ml-auto truncate text-[11px] text-slate-400">{{ artifactsSummary }}</span>
        </button>
        <div v-if="artifactsOpen" class="space-y-2 border-t border-slate-200 px-4 py-4">
          <AutoLoadoutEditor
            v-model="store.loadout"
            :default-value="store.defaultLoadout"
            :reset-label="store.backup ? 'Reset to inventory' : 'Reset to maxed'"
            :default-label="store.backup ? 'Inventory' : 'Maxed'"
            :earnings-families="CHAIN_FINDER_EARNINGS_FAMILIES"
            :delivery-families="DELIVERY_CORE_FAMILIES"
            :stone-holders="STONE_HOLDERS"
          />
        </div>
      </section>

      <InstantSearchFilters />
    </fieldset>

    <div class="mt-6 flex flex-wrap items-center gap-3">
      <button
        class="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-[11px] font-black uppercase tracking-[0.15em] shadow-lg shadow-emerald-100 hover:bg-emerald-700 disabled:opacity-50"
        :disabled="store.status === 'running' || store.tableStatus === 'loading' || !!store.problem"
        @click="store.search()"
      >
        {{ store.status === 'running' ? 'Searching…' : 'Find routes' }}
      </button>
      <span v-if="store.status === 'running' && store.progress" class="text-xs text-slate-500">
        {{ store.progress.stage === 'waits' ? 'Finding prestiges worth waiting for…' : 'Finding routes…' }}
      </span>
      <span v-else-if="store.problem" class="text-xs text-amber-700">{{ store.problem }}</span>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
      <template v-if="store.tableStatus === 'loading'">Loading the table…</template>
      <span v-else-if="store.header" class="inline-flex flex-wrap items-center gap-1.5" :title="tableDetails">
        Table:
        <template v-if="tableDelivery.length">
          <span
            v-for="a in tableDelivery"
            :key="a.id"
            class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-bold text-slate-700"
            :style="{ backgroundColor: rarityTint(a.rarity, '#f1f5f9') }"
            :title="a.label"
          >
            <img :src="iconURL(a.iconPath, 64)" class="w-4 h-4" />T{{ a.tier }}{{ a.rarityCode }}
          </span>
        </template>
        <template v-else>{{ store.tableSource }}</template>
        <template v-if="store.header.deferForEarnings">· silo mode</template>
      </span>
      <label class="cursor-pointer font-bold text-emerald-700 hover:underline">
        Load a table file…
        <input type="file" accept=".bin,.gz" class="hidden" @change="onFile" />
      </label>
    </div>
    <p v-if="store.tableNote" class="mt-2 text-[11px] text-amber-700">{{ store.tableNote }}</p>

    <div
      v-if="store.tableStatus === 'ready' && store.headerWarnings.length"
      class="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
    >
      <div class="font-bold">This table's header isn't what this page expects:</div>
      <ul class="mt-1 list-disc pl-5 space-y-0.5">
        <li v-for="w in store.headerWarnings" :key="w">{{ w }}</li>
      </ul>
    </div>

    <div
      v-if="store.tableStatus === 'ready' && store.header"
      class="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
    >
      <div class="font-bold text-slate-800">Changes since this table</div>
      <ol v-if="store.simChanges.length" class="mt-1 space-y-1">
        <li v-for="c in store.simChanges" :key="c.commit">
          <span class="font-bold">{{ showTime(Date.parse(c.date) / 1000) }}</span>
          <span class="mx-1 font-mono-premium text-slate-400">{{ c.commit }}</span>
          {{ c.note }}
        </li>
      </ol>
      <p v-else class="mt-1">None: the simulator hasn't changed since this table was built.</p>
    </div>

    <p v-if="store.error" class="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
      {{ store.error }}
    </p>

    <InstantSearchResults v-if="store.answer" :answer="store.answer" class="mt-6" />
    <ChainComparison
      v-if="store.answer && store.comparison"
      :answer="store.answer"
      :comparison="store.comparison"
      class="mt-4"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import InstantSearchResults from './InstantSearchResults.vue';
import ChainComparison from './ChainComparison.vue';
import InstantSearchFilters from './InstantSearchFilters.vue';
import AutoLoadoutEditor from '@/components/auto/AutoLoadoutEditor.vue';
import { loadoutInputsEqual } from '@/auto/loadout';
import RefreshBackupButton from './RefreshBackupButton.vue';
import StandardPermitWarning from '@/components/StandardPermitWarning.vue';
import SegmentedToggle from './SegmentedToggle.vue';
import DateTimeZonePicker from 'ui/components/planners/DateTimeZonePicker.vue';
import {
  MAX_ASCENSIONS,
  MAX_TE,
  useInstantSearchStore,
  type InstantTargetMode,
  type StartMode,
} from '@/stores/instantSearch';
import { useInitialStateStore } from '@/stores/initialState';
import { formatDuration, formatNumber } from '@/lib/format';
import { iconURL } from 'lib';
import { getArtifact } from '@/lib/artifacts';
import { rarityTint } from 'lib/planners/artifacts/display';
import type { ArtifactOption } from '@/lib/artifacts/types';
import { DELIVERY_CORE_FAMILIES, deliveryCore } from '@/lib/instantSearch/tableCatalog';
import { CHAIN_FINDER_EARNINGS_FAMILIES, STONE_HOLDERS } from '@/lib/instantSearch/earningsShift';
import { VIRTUE_EGG_NAMES } from '@/types';

const store = useInstantSearchStore();
const initialState = useInitialStateStore();

// The current ascension is read on opening the tab and whenever another save is loaded; its catch-up
// is worked out again when a search starts.
onMounted(() => store.detect());
watch(
  () => initialState.rawBackup,
  () => store.onSaveLoaded()
);

/** The loaded table's metronome, compass and gusset, shown as the section shows artifacts. */
const tableDelivery = computed(() =>
  deliveryCore(store.header?.delivery ?? [])
    .map(id => getArtifact(id))
    .filter((a): a is ArtifactOption => !!a)
);
/** The rest of what the table line used to say, on hover. */
const tableDetails = computed(() => {
  const h = store.header;
  if (!h) return '';
  return [
    store.tableSource,
    `start TE ${h.from}–${h.to}`,
    `simulator ${h.simVersion ?? 'unstamped'}`,
    ...(h.builtAt ? [`built ${showTime(Date.parse(h.builtAt) / 1000)}`] : []),
  ].join(' · ');
});

/** Ticks once a minute so "last sync … ago" stays current. */
/** Artifacts & stones, folded away until asked for. */
const artifactsOpen = ref(false);
const artifactsSummary = computed(() => {
  const from = !loadoutInputsEqual(store.loadout, store.defaultLoadout)
    ? 'Edited'
    : store.backup
      ? 'From your save'
      : 'Maxed';
  return store.deliveryMatches ? from : `${from} · delivery differs from the table`;
});

const now = ref(Date.now() / 1000);
const timer = setInterval(() => (now.value = Date.now() / 1000), 60_000);
onUnmounted(() => clearInterval(timer));
const syncAge = computed(() => Math.max(0, now.value - (store.current?.lastSync ?? now.value)));

const showTime = (unix: number) =>
  new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: store.timezone,
  });

const targetModes: { id: InstantTargetMode; label: string }[] = [
  { id: 'te', label: 'Target TE' },
  { id: 'date', label: 'By a date' },
];
/** Right now needs a save; without one the start is hypothetical. */
const startModes = computed<{ id: StartMode; label: string; disabled?: boolean }[]>(() => [
  { id: 'now', label: 'Right now', disabled: store.saveTE === null },
  { id: 'hypothetical', label: 'Hypothetical' },
]);
const startMode = computed({
  get: () => (store.fromSave ? 'now' : 'hypothetical'),
  set: (m: StartMode) => (store.startMode = m),
});
/** The hypothetical TE, shown as the save's until one is typed. */
const hypotheticalTE = computed({
  get: () => store.startTE,
  set: (v: number) => (store.hypotheticalTE = Number.isFinite(v) ? v : null),
});

onMounted(() => {
  if (store.tableStatus === 'idle') store.loadTable();
});

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) store.loadFile(file);
  input.value = '';
}
</script>
