<template>
  <div class="rounded-xl border p-3 text-xs" :class="boxClass">
    <template v-if="store.existingStatus === 'checking' || store.existingStatus === 'idle'">
      <span class="text-slate-500">Checking the table store for this delivery set…</span>
    </template>

    <template v-else-if="store.existingStatus === 'error'">
      <span class="text-amber-800">Couldn't reach the table store, so it isn't known whether this table exists.</span>
      <button type="button" class="ml-2 font-bold text-emerald-700 hover:underline" @click="store.checkExisting()">
        Try again
      </button>
    </template>

    <template v-else-if="!table">
      <div class="font-bold text-slate-800">No table yet</div>
      <p class="mt-1 text-slate-600">
        The table store has no table for this delivery set.
      </p>
    </template>

    <template v-else>
      <div class="font-bold text-slate-800">
        {{ outOfDate ? 'A table exists, but the simulator has changed since' : 'A table already exists' }}
      </div>
      <p class="mt-1 text-slate-600">
        <span class="font-mono-premium">{{ table.entry.name }}</span>
        · start TE {{ table.header.from }}–{{ table.header.to }}
        <template v-if="builtAt">· built {{ builtAt }}</template>
        · simulator {{ table.header.simVersion ?? 'unstamped' }}
      </p>

      <div class="mt-2 font-bold text-slate-800">Changes since this table</div>
      <ol v-if="outOfDate" class="mt-1 space-y-1 text-slate-600">
        <li v-for="c in table.simChanges" :key="c.commit">
          <span class="font-bold">{{ showTime(Date.parse(c.date)) }}</span>
          <span class="mx-1 font-mono-premium text-slate-400">{{ c.commit }}</span>
          {{ c.note }}
        </li>
        <li v-for="c in table.colleggtibleChanges" :key="c.id">{{ c.note }}</li>
      </ol>
      <p v-else class="mt-1 text-slate-600">
        None: the simulator hasn't changed since this table was built, so building it again gives the same table.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useChainFinderStore } from '@/stores/chainFinder';

const store = useChainFinderStore();

// Read the catalog again on opening the tab: tables are uploaded while the site is up.
onMounted(() => store.checkExisting());

const table = computed(() => store.existing);
const outOfDate = computed(() => !!table.value && (table.value.simChanges.length + table.value.colleggtibleChanges.length > 0));

const boxClass = computed(() => {
  if (store.existingStatus === 'error') return 'border-amber-200 bg-amber-50';
  if (store.existingStatus === 'ready' && table.value)
    return outOfDate.value ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50';
  return 'border-slate-200 bg-slate-50';
});

const showTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const builtAt = computed(() => {
  const t = Date.parse(table.value?.header.builtAt ?? '');
  return Number.isNaN(t) ? '' : showTime(t);
});
</script>
