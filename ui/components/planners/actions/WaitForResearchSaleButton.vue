<template>
  <!-- Only on the egg the research sale applies to -->
  <EventWaitButton
    v-if="isVisible"
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
import { PROFILE } from '@planner/lib/profile';
import { computed } from 'vue';
import EventWaitButton from 'ui/components/planners/actions/EventWaitButton.vue';
import { useActionsStore } from '@planner/stores/actions';
import { useEventWaits } from 'lib/planners/composables/usePlannerEventWaits';

// The Wait tab's research sale wait (WaitForEventActions.vue). It runs the same sequence as the
// Research Sale card's button (EventEdgeWaitCard.vue in ResearchActions.vue).

const actionsStore = useActionsStore();
const { secondsUntilNextSale, waitForNextSale } = useEventWaits();

const isVisible = computed(
  () => PROFILE.researchSaleEgg === null || actionsStore.effectiveSnapshot.currentEgg === PROFILE.researchSaleEgg
);
</script>
