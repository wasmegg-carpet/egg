<template>
  <div class="space-y-4">
    <WaitForResearchSaleButton />

    <!-- Wait for 2x Earnings (All eggs) -->
    <EventWaitButton
      icon="egginc-extras/icon_earnings_boost.png"
      icon-class="bg-orange-500"
      title="Wait for 2x Earnings"
      subtitle="Monday at +0"
      :seconds="secondsUntilNextEarningsBoost"
      seconds-class="text-orange-600"
      @click="waitForNextEarningsBoost"
    />
  </div>
</template>

<script setup lang="ts">
import EventWaitButton from 'ui/components/planners/actions/EventWaitButton.vue';
import { useEventWaits } from 'lib/planners/composables/usePlannerEventWaits';
import WaitForResearchSaleButton from 'ui/components/planners/actions/WaitForResearchSaleButton.vue';

const { secondsUntilNextEarningsBoost, waitForNextEarningsBoost } = useEventWaits();
</script>
