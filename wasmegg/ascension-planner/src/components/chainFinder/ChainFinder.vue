<template>
  <div class="section-premium p-4 sm:p-8 max-w-4xl mx-auto mt-4">
    <div class="flex items-center gap-4 mb-8">
      <div
        class="w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-200"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M3 10h18M3 14h18M10 4v16M14 4v16M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z"
          />
        </svg>
      </div>
      <h2 class="text-xl font-black text-slate-900 uppercase tracking-tight">Table Builder</h2>
    </div>

    <StandardPermitWarning tool="Table Builder" />

    <h3 class="text-sm font-bold text-slate-800 mb-1">Delivery artifacts</h3>
    <p class="text-xs text-slate-500 mb-4">
      Choose the metronome, compass, and gusset you deliver with. The set's fourth artifact is a 3-slot stone
      holder.
    </p>
    <fieldset :disabled="store.status === 'running'" class="disabled:opacity-50">
      <DeliveryArtifactPicker v-model="store.deliverySelection" />
    </fieldset>

    <h3 class="text-sm font-bold text-slate-800 mt-8 mb-1">Lookup table</h3>
    <p class="text-xs text-slate-500 mb-4">
      Simulates every hour of the week for each start TE on a maxed account with this delivery set, then downloads
      the table as a .bin file.
    </p>
    <TableBuildPanel />
  </div>
</template>

<script setup lang="ts">
import DeliveryArtifactPicker from './DeliveryArtifactPicker.vue';
import TableBuildPanel from './TableBuildPanel.vue';
import StandardPermitWarning from '@/components/StandardPermitWarning.vue';
import { useChainFinderStore } from '@/stores/chainFinder';

const store = useChainFinderStore();
</script>
