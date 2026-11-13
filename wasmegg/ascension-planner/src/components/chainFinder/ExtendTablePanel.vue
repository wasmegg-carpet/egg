<template>
  <fieldset :disabled="store.status === 'running'" class="rounded-xl border border-slate-200 p-3 text-xs space-y-2 disabled:opacity-50">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <label class="flex items-center gap-2 text-slate-600">
        Lowest start TE
        <input
          v-model.number="store.minTE"
          type="number"
          :min="CHAIN_FINDER_MIN_TE"
          :max="CHAIN_FINDER_TE_TO"
          class="w-16 px-2 py-1 rounded-lg border border-slate-200 text-xs"
          :class="store.minTEValid ? '' : 'border-red-300'"
        />
        <span class="text-slate-400">{{ CHAIN_FINDER_MIN_TE }}–{{ CHAIN_FINDER_TE_TO }}, usually {{ CHAIN_FINDER_TE_FROM }}</span>
      </label>

      <label v-if="store.existing && !store.uploaded" class="flex items-center gap-2 text-slate-600">
        <input v-model="store.extendStored" type="checkbox" class="rounded" />
        Extend the stored table (start TE {{ store.existing.header.from }}–{{ store.existing.header.to }})
      </label>

      <label class="flex items-center gap-2 text-slate-600">
        <span
          class="px-2 py-1 rounded-md border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >{{ store.uploaded ? 'Pick another file' : 'Extend a table file…' }}</span
        >
        <input type="file" accept=".gz,.bin" class="sr-only" @change="pick" />
      </label>
    </div>

    <p v-if="!store.minTEValid" class="text-red-600">
      Lowest start TE must be a whole number from {{ CHAIN_FINDER_MIN_TE }} to {{ CHAIN_FINDER_TE_TO }}.
    </p>

    <div v-if="store.uploaded" class="flex items-center gap-2 text-slate-700">
      <span class="font-mono-premium truncate">{{ store.uploaded.name }}</span>
      <span class="text-slate-500 shrink-0">start TE {{ store.uploaded.header.from }}–{{ store.uploaded.header.to }}</span>
      <button type="button" class="ml-auto shrink-0 font-bold text-slate-500 hover:underline" @click="store.clearFile()">
        Remove
      </button>
    </div>
    <p v-if="store.uploadError" class="text-red-600">Couldn't read that file: {{ store.uploadError }}</p>

    <template v-if="store.base">
      <div v-if="store.baseProblems.length" class="text-amber-800">
        <div class="font-bold">This table can't be extended, so the build starts from scratch:</div>
        <ul class="list-disc ml-4">
          <li v-for="p in store.baseProblems" :key="p">{{ p }}</li>
        </ul>
      </div>
      <p v-else-if="!store.plan.tes.length" class="text-emerald-700">
        It already covers start TE {{ store.lowestTE }}–{{ CHAIN_FINDER_TE_TO }}: nothing to build.
      </p>
      <p v-else class="text-emerald-700">{{ planText }}</p>
    </template>
  </fieldset>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  CHAIN_FINDER_MIN_TE,
  CHAIN_FINDER_TE_FROM,
  CHAIN_FINDER_TE_TO,
  useChainFinderStore,
} from '@/stores/chainFinder';

const store = useChainFinderStore();

function pick(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void store.loadFile(file);
  // Picking the same file again (after Remove) should still fire.
  input.value = '';
}

/** e.g. "Keeps start TE 120–489 and builds 100–119 (20 start TEs)." */
const planText = computed(() => {
  const { tes, keep } = store.plan;
  if (!keep) return '';
  const below = tes.filter(te => te < keep.from);
  const above = tes.filter(te => te > keep.to);
  const range = (r: number[]) => (r.length === 1 ? `${r[0]}` : `${r[0]}–${r[r.length - 1]}`);
  const parts = [below, above].filter(r => r.length).map(range);
  return `Keeps start TE ${keep.from}–${keep.to} and builds ${parts.join(' and ')} (${tes.length} start TE${tes.length === 1 ? '' : 's'}).`;
});
</script>
