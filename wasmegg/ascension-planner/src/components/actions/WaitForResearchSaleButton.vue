<template>
  <!-- Wait for Research Sale (Only on Curiosity) -->
  <div v-if="isCuriosity" class="flex flex-col gap-2">
    <button
      class="group relative overflow-hidden bg-gradient-to-br from-slate-50 to-white border border-slate-100 rounded-2xl p-5 text-left transition-all hover:border-slate-200 hover:shadow-md active:scale-[0.98]"
      @click="handleWaitResearchSale"
    >
      <div class="flex justify-between items-start gap-4 mb-2">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center p-2 shadow-sm group-hover:scale-110 transition-transform"
          >
            <img :src="iconURL('egginc-extras/icon_research_sale.png', 64)" class="w-full h-full object-contain" />
          </div>
          <div>
            <h4 class="text-sm font-black text-slate-800 uppercase tracking-tight">Wait for Research Sale</h4>
            <p class="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Friday at +0</p>
          </div>
        </div>
        <div class="text-right">
          <span class="text-xs font-mono-premium font-black text-rose-500">
            {{ formatDuration(researchSaleWait) }}
          </span>
        </div>
      </div>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { iconURL } from 'lib';
import { useActionsStore } from '@/stores/actions';
import { useResearchSaleWaits } from '@/composables/useResearchSaleWaits';
import { formatDuration } from '@/lib/format';

// Shared by the Wait tab (WaitForEventActions.vue) and the Smart Buy view (SmartBuyView.vue, shown
// between the Earnings and Delivery cards while no research sale is active) so both run the exact
// same wait sequence.

const actionsStore = useActionsStore();
const { secondsUntilNextSale: researchSaleWait, waitForNextSale: handleWaitResearchSale } = useResearchSaleWaits();

const isCuriosity = computed(() => actionsStore.effectiveSnapshot.currentEgg === 'curiosity');
</script>
