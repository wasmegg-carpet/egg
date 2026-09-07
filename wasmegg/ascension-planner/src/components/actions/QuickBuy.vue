<template>
  <SmartBuyCard title="Quick Buy" note="Quick Buy will never spend gems from your bank." :loading="loading">
    <template #icon>
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    </template>
    <template #description>
      Buys any research that requires less than
      <span
        class="font-mono font-bold text-brand-primary bg-white px-1.5 py-0.5 rounded border border-slate-200 shadow-sm mx-0.5"
        >{{ displayDuration }}</span
      >
      time to save, right now.
    </template>

    <div class="space-y-2">
      <div class="relative group">
        <input
          v-model="timeValue"
          type="text"
          placeholder="Threshold (e.g. 1h 30m or 100s)"
          class="input-premium pl-3 pr-10"
        />
        <div
          class="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300 group-focus-within:text-brand-primary transition-colors uppercase tracking-widest pointer-events-none"
        >
          Time
        </div>
      </div>

      <button
        :disabled="isInvalid || loading || applying"
        class="btn-premium btn-primary w-full text-[10px] inline-flex items-center justify-center gap-1.5"
        @click="emit('buy', parsedSeconds)"
      >
        <InlineSpinner v-if="applying" class="w-3 h-3" />
        {{ applying ? 'Buying…' : 'Buy Now' }}
      </button>

      <ResearchPurchasePreview :items="previewItems" empty-text="Nothing to buy right now" />
      <SmartBuyStats :purchase-count="stats.purchaseCount" :seconds="stats.seconds" :gems="stats.gems" />
      <RatePreviewDelta label="Earnings" :before="earningsSummary.before" :after="earningsSummary.after" unit="/hr" />
    </div>
  </SmartBuyCard>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { formatDuration, parseDuration } from '@/lib/format';
import SmartBuyCard from './SmartBuyCard.vue';
import ResearchPurchasePreview from './ResearchPurchasePreview.vue';
import RatePreviewDelta from './RatePreviewDelta.vue';
import SmartBuyStats from './SmartBuyStats.vue';
import InlineSpinner from '@/components/InlineSpinner.vue';
import type { ResearchSummaryItem } from '@/calculations/smartBuyPreview';

defineProps<{
  previewItems: ResearchSummaryItem[];
  earningsSummary: { before: number; after: number };
  stats: { purchaseCount: number; seconds: number; gems: number };
  /** Whether the preview plan above is currently being (re)computed. */
  loading?: boolean;
  /** Whether a Buy Now click is still being applied. */
  applying?: boolean;
}>();

const emit = defineEmits<{
  (e: 'buy', thresholdSeconds: number): void;
  (e: 'update:thresholdSeconds', value: number): void;
}>();

const timeValue = ref('1s');

const parsedSeconds = computed(() => {
  const seconds = parseDuration(timeValue.value);
  return isNaN(seconds) ? 0 : seconds;
});

const isInvalid = computed(() => parsedSeconds.value <= 0 && timeValue.value !== '');

const displayDuration = computed(() => {
  if (parsedSeconds.value <= 0) return '0s';
  return formatDuration(parsedSeconds.value);
});

// Lets the parent compute a live preview as the user types, without owning this input's state.
watch(parsedSeconds, v => emit('update:thresholdSeconds', v), { immediate: true });
</script>
