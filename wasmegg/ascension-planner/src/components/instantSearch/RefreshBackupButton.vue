<template>
  <button
    type="button"
    class="shrink-0 rounded-lg border border-indigo-300 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
    :disabled="store.refreshing || store.status === 'running'"
    title="Fetch your latest backup from the game server"
    @click="store.refreshBackup()"
  >
    {{ store.refreshing ? 'Refreshing…' : 'Refresh backup' }}
  </button>
</template>

<script setup lang="ts">
/** Fetches the player's latest backup for Chain Finder only (stores/instantSearch.ts `refreshBackup`). */
import { useInstantSearchStore } from '@/stores/instantSearch';

const store = useInstantSearchStore();
</script>
