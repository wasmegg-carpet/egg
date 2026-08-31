<template>
  <div class="space-y-4">
    <QuickBuy
      :preview-items="quickBuyPreview"
      :earnings-summary="quickBuyEarningsSummary"
      :stats="quickBuyStats"
      :loading="quickBuyLoading"
      :applying="quickBuyApplying"
      @buy="$emit('quick-buy', $event)"
      @update:threshold-seconds="$emit('update:quickBuyThresholdSeconds', $event)"
    />

    <SmartBuyCard title="Buy Earnings research" :loading="saleAwareLoading">
      <template #icon>
        <img
          :src="iconURL('egginc-extras/icon_research_sale.png', 64)"
          class="w-3.5 h-3.5 object-contain"
          alt="Research Sale"
        />
      </template>
      <template #description>
        Buys earnings research that pays for itself by the end of your last research sale.
        This automatically considers whether to buy before a sale or wait until the sale to purchase.
      </template>

      <SaleRideStepper
        :deadline-label="smartBuyDeadlineLabel"
        :sale-count="smartBuySaleCount"
        :cap="smartBuySaleCountCap"
        @increment="$emit('increment-smart-buy-sale-count')"
        @decrement="$emit('decrement-smart-buy-sale-count')"
      />

      <div class="flex flex-col gap-1.5">
        <button
          class="btn-premium btn-primary w-full text-[10px] disabled:opacity-20 inline-flex items-center justify-center gap-1.5"
          :disabled="!canBuyUntilSaleWarning || saleAwareLoading || saleAwareApplying"
          @click="$emit('buy-until-sale-warning')"
        >
          <InlineSpinner v-if="saleAwareApplying" class="w-3 h-3" />
          {{ saleAwareApplying ? 'Buying…' : 'Buy Now' }}
        </button>
        <ResearchPurchasePreview :items="saleAwarePreview" empty-text="Nothing to buy right now" />
        <SmartBuyStats
          :purchase-count="saleAwareStats70.purchaseCount"
          :seconds="saleAwareStats70.seconds"
          :gems="saleAwareStats70.gems"
        />
        <RatePreviewDelta
          label="Earnings"
          :before="saleAwareEarningsSummary70.before"
          :after="saleAwareEarningsSummary70.after"
          unit="/hr"
        />
      </div>
    </SmartBuyCard>

    <SmartBuyCard title="Buy Delivery Research" :loading="saleEndsLoading">
      <template #icon>
        <img
          :src="iconURL('egginc-extras/icon_research_sale.png', 64)"
          class="w-3.5 h-3.5 object-contain"
          alt="Research Sale"
        />
      </template>
      <template #description>
        Buys earnings and delivery research during this sale to maximize delivery rate.
      </template>
      <button
        class="btn-premium btn-primary w-full text-[10px] disabled:opacity-20 inline-flex items-center justify-center gap-1.5"
        :disabled="!canBuyUntilSaleDeadline || saleEndsLoading || saleEndsApplying"
        @click="$emit('buy-until-sale-deadline')"
      >
        <InlineSpinner v-if="saleEndsApplying" class="w-3 h-3" />
        {{ saleEndsApplying ? 'Buying…' : 'Buy Now' }}
      </button>
      <SmartBuyStats
        :purchase-count="saleEndsStats.purchaseCount"
        :seconds="saleEndsStats.seconds"
        :gems="saleEndsStats.gems"
      />
      <ResearchPurchasePreview
        :items="saleEndsEarningsPreview"
        label="100% ROI before end of sale. Maximizes buying speed of delivery research"
        empty-text="None needed"
      />
      <RatePreviewDelta
        label="Earnings"
        :before="saleEndsEarningsSummary.before"
        :after="saleEndsEarningsSummary.after"
        unit="/hr"
      />
      <ResearchPurchasePreview
        :items="saleEndsPreview"
        label="Most efficient delivery research until sale ends"
        empty-text="Nothing to buy right now"
      />
      <RatePreviewDelta
        v-if="saleEndsDeliverySummary"
        label="Delivery Rate"
        :before="saleEndsDeliverySummary.before"
        :after="saleEndsDeliverySummary.after"
        unit="/hr"
      />
    </SmartBuyCard>

    <AutoBuy
      :always-on="autoBuyAlwaysOn"
      @update:always-on="$emit('update:autoBuyAlwaysOn', $event)"
      @update="$emit('auto-buy-update', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { iconURL } from 'lib';
import type { ResearchSummaryItem } from '@/calculations/smartBuyPreview';
import QuickBuy from './QuickBuy.vue';
import AutoBuy from './AutoBuy.vue';
import SmartBuyCard from './SmartBuyCard.vue';
import SaleRideStepper from './SaleRideStepper.vue';
import ResearchPurchasePreview from './ResearchPurchasePreview.vue';
import RatePreviewDelta from './RatePreviewDelta.vue';
import SmartBuyStats from './SmartBuyStats.vue';
import InlineSpinner from '@/components/InlineSpinner.vue';

interface RateSummary {
  before: number;
  after: number;
}

interface BuyStats {
  purchaseCount: number;
  seconds: number;
  gems: number;
}

defineProps<{
  autoBuyAlwaysOn: boolean;
  canBuyUntilSaleWarning: boolean;
  canBuyUntilSaleDeadline: boolean;
  quickBuyPreview: ResearchSummaryItem[];
  quickBuyEarningsSummary: RateSummary;
  quickBuyStats: BuyStats;
  saleAwarePreview: ResearchSummaryItem[];
  saleAwareStats70: BuyStats;
  /** "70% Return"'s Gate B target — formatted deadline label, current sale count, and the count's
   *  upper bound, all already resolved by the composable (see useResearchViews.ts's
   *  `smartBuyFullRoiDeadline`/`smartBuySaleCount`/`SMART_BUY_SALE_COUNT_CAP`). */
  smartBuyDeadlineLabel: string;
  smartBuySaleCount: number;
  smartBuySaleCountCap: number;
  saleEndsPreview: ResearchSummaryItem[];
  saleEndsEarningsPreview: ResearchSummaryItem[];
  saleEndsEarningsSummary: RateSummary;
  saleAwareEarningsSummary70: RateSummary;
  saleEndsDeliverySummary: RateSummary | null;
  saleEndsStats: BuyStats;
  /** Whether each card's own plan is currently being (re)computed — dims that card only. */
  quickBuyLoading?: boolean;
  saleAwareLoading?: boolean;
  saleEndsLoading?: boolean;
  /** Whether that card's button was clicked and its purchases are still being applied. */
  quickBuyApplying?: boolean;
  saleAwareApplying?: boolean;
  saleEndsApplying?: boolean;
}>();

defineEmits<{
  (e: 'update:autoBuyAlwaysOn', value: boolean): void;
  (e: 'quick-buy', thresholdSeconds: number): void;
  (e: 'update:quickBuyThresholdSeconds', value: number): void;
  (e: 'auto-buy-update', state: { threshold: number; alwaysOn: boolean }): void;
  (e: 'increment-smart-buy-sale-count'): void;
  (e: 'decrement-smart-buy-sale-count'): void;
  (e: 'buy-until-sale-warning'): void;
  (e: 'buy-until-sale-deadline'): void;
}>();
</script>
