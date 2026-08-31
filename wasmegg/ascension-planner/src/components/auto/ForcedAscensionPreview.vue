<template>
  <div class="bg-white rounded-xl sm:rounded-2xl p-3.5 sm:p-4 text-slate-900 relative overflow-hidden shadow-md border border-violet-100">
    <!-- Background accents -->
    <div class="absolute -right-20 -top-20 w-64 h-64 bg-violet-500/5 rounded-full blur-3xl"></div>
    <div class="absolute -left-20 -bottom-20 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl"></div>

    <div class="relative z-10">
      <!-- Header -->
      <div class="flex items-center gap-2.5 sm:gap-3 mb-4">
        <div class="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-violet-500 to-violet-600 rounded-lg sm:rounded-xl flex items-center justify-center shadow-md shadow-violet-100/50 flex-shrink-0">
          <svg class="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </div>
        <div>
          <div class="flex items-baseline gap-2">
            <h3 class="text-base sm:text-lg font-black uppercase tracking-tight text-slate-800 leading-none">
              Next Ascension preview
            </h3>
          </div>
        </div>
      </div>

      <!-- Peak ELR row. Minimal/unstyled list of whatever variants are present — visual layout for
           up to 7 variants is deferred to a later pass. -->
      <div class="flex items-center gap-3 mb-4 px-1 flex-wrap">
        <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Peak Delivery Rate</span>
        <template v-for="(entry, i) in presentVariants" :key="entry.key">
          <div v-if="i > 0" class="w-px h-4 bg-slate-200"></div>
          <div class="flex items-center gap-1.5">
            <span class="text-[9px] font-black text-slate-500 uppercase tracking-wider">{{ entry.key }}</span>
            <span class="text-[13px] font-mono-premium font-black text-indigo-600">
              {{ formatNumber(entry.result.summary.maxELR * 3600, 3) }}
            </span>
            <span class="text-[9px] font-black text-slate-400">/hr</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatNumber } from '@/lib/format';
import type { VariantKey, VariantResult } from '@/stores/autoPlanner';

const props = defineProps<{
  variants: Partial<Record<VariantKey, VariantResult>>;
  index: number;
  total: number;
}>();

const presentVariants = computed(() =>
  (Object.entries(props.variants) as [VariantKey, VariantResult | undefined][])
    .filter((entry): entry is [VariantKey, VariantResult] => !!entry[1])
    .sort((a, b) => a[1].summary.totalDurationSeconds - b[1].summary.totalDurationSeconds)
    .map(([key, result]) => ({ key, result }))
);
</script>

<style scoped>
.font-mono-premium { font-family: 'JetBrains Mono', 'Roboto Mono', monospace; }
</style>
