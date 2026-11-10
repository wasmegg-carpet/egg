<template>
  <div v-if="store.existingStatus === 'ready'" class="space-y-2">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        class="flex items-center gap-2 text-left"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      >
        <span class="inline-block w-3 text-slate-400">{{ collapsed ? '›' : '⌄' }}</span>
        <h3 class="text-sm font-bold text-slate-800">Every table</h3>
      </button>
      <span class="text-[11px] text-slate-500">
        {{ counts.current }} up to date · {{ counts.behind }} behind · {{ counts.missing }} not built
      </span>
      <div v-if="!collapsed" class="ml-auto flex gap-1">
        <button
          v-for="f in filters"
          :key="f.id"
          type="button"
          class="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border transition-colors"
          :class="
            filter === f.id
              ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
          "
          :aria-pressed="filter === f.id"
          @click="filter = f.id"
        >
          {{ f.label }}
        </button>
      </div>
    </div>

    <ul v-if="!collapsed" class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
      <li
        v-for="row in shown"
        :key="row.key"
        class="flex items-center gap-2 px-2 py-1 rounded-lg"
        :class="row.selected ? 'bg-indigo-50 ring-1 ring-indigo-300' : 'hover:bg-slate-50'"
      >
        <span class="flex gap-0.5 shrink-0">
          <span
            v-for="a in row.artifacts"
            :key="a.id"
            class="w-6 h-6 rounded-md flex items-center justify-center"
            :style="{ backgroundColor: rarityTint(a.rarity, '#e2e8f0') }"
            :title="a.label"
          >
            <img :src="iconURL(a.iconPath, 64)" class="w-5 h-5" :alt="a.label" />
          </span>
        </span>
        <span class="flex-1 min-w-0 truncate text-[11px]" :class="statusClass[row.status]">{{ row.text }}</span>
        <span v-if="row.selected" class="shrink-0 text-[10px] font-black uppercase tracking-wider text-indigo-600"
          >Selected</span
        >
        <button
          v-else-if="row.status !== 'current'"
          type="button"
          class="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border border-emerald-200 text-emerald-700 bg-white hover:bg-emerald-50 disabled:opacity-50"
          :disabled="store.status === 'running'"
          :title="'Set the delivery artifacts to these, ready to build'"
          @click="store.deliverySelection = { ...row.selection }"
        >
          Set up
        </button>
      </li>
    </ul>
    <p v-if="!collapsed && !shown.length" class="text-[11px] text-slate-400">None.</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { iconURL } from 'lib';
import { rarityTint } from 'lib/planners/artifacts/display';
import { getArtifact } from '@/lib/artifacts';
import type { ArtifactOption } from '@/lib/artifacts/types';
import { changesBehind } from '@/lib/chainFinder/existingTable';
import { CHAIN_FINDER_DELIVERY_FAMILIES } from '@/lib/chainFinder/deliveryArtifacts';
import { useChainFinderStore } from '@/stores/chainFinder';

const store = useChainFinderStore();

type Status = 'current' | 'behind' | 'missing';
type Filter = 'all' | 'missing' | 'behind';

const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'missing', label: 'No table' },
  { id: 'behind', label: 'Needs update' },
];
const filter = ref<Filter>('all');

/** Folded away while a table builds, so the progress is what shows; either way it can be toggled. */
const collapsed = ref(store.status === 'running');
watch(
  () => store.status,
  (status, was) => {
    if (status === 'running' && was !== 'running') collapsed.value = true;
  }
);

const statusClass: Record<Status, string> = {
  current: 'text-emerald-700 font-bold',
  behind: 'text-amber-700',
  missing: 'text-slate-400',
};

const rows = computed(() => {
  const picked = store.deliverySelection;
  return store.allTables.map(({ selection, table }) => {
    const behind = table ? changesBehind(table) : 0;
    const status: Status = !table ? 'missing' : behind ? 'behind' : 'current';
    return {
      key: CHAIN_FINDER_DELIVERY_FAMILIES.map(f => selection[f]).join(','),
      selection,
      selected: CHAIN_FINDER_DELIVERY_FAMILIES.every(f => selection[f] === picked[f]),
      artifacts: CHAIN_FINDER_DELIVERY_FAMILIES.map(f => getArtifact(selection[f])).filter(
        (a): a is ArtifactOption => !!a
      ),
      status,
      text:
        status === 'missing'
          ? 'Not built'
          : status === 'current'
            ? 'Up to date'
            : `${behind} change${behind === 1 ? '' : 's'} behind the latest`,
    };
  });
});

const counts = computed(() => ({
  current: rows.value.filter(r => r.status === 'current').length,
  behind: rows.value.filter(r => r.status === 'behind').length,
  missing: rows.value.filter(r => r.status === 'missing').length,
}));

const shown = computed(() =>
  rows.value.filter(r => filter.value === 'all' || r.status === filter.value)
);
</script>
