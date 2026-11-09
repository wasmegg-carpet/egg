<template>
  <!-- Wait for Research Sale (Only on Curiosity) -->
  <EventWaitButton
    v-if="isCuriosity"
    icon="egginc-extras/icon_research_sale.png"
    icon-class="bg-slate-900"
    title="Wait for Research Sale"
    subtitle="Friday at +0"
    :seconds="secondsUntilNextSale"
    seconds-class="text-rose-500"
    @click="waitForNextSale"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import EventWaitButton from 'ui/components/planners/actions/EventWaitButton.vue';
import { useActionsStore } from '@/stores/actions';
import { useEventWaits } from '@/composables/useEventWaits';

// Shared by the Wait tab (WaitForEventActions.vue) and the Smart Buy view (SmartBuyView.vue, shown
// between the Earnings and Delivery cards while no research sale is active) so both run the exact
// same wait sequence.

const actionsStore = useActionsStore();
const { secondsUntilNextSale, waitForNextSale } = useEventWaits();

const isCuriosity = computed(() => actionsStore.effectiveSnapshot.currentEgg === 'curiosity');
</script>
