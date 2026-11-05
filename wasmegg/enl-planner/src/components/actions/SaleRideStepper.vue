<template>
  <div class="flex items-center justify-between gap-2 px-0.5">
    <div class="flex flex-col leading-tight">
      <span class="text-[9px] text-slate-500">100% ROI by</span>
      <span class="text-[10px] font-mono text-slate-700">{{ deadlineLabel }}</span>
    </div>
    <div class="flex items-center gap-1.5">
      <button
        class="w-5 h-5 rounded bg-slate-100 text-slate-600 text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-200"
        :disabled="saleCount <= 1"
        aria-label="Ride one fewer sale"
        @click="$emit('decrement')"
      >
        −
      </button>
      <span class="text-[10px] text-slate-500 w-14 text-center">
        {{ saleCount }} sale{{ saleCount === 1 ? '' : 's' }}
      </span>
      <button
        class="w-5 h-5 rounded bg-slate-100 text-slate-600 text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-200"
        :disabled="saleCount >= cap"
        aria-label="Ride one more sale"
        @click="$emit('increment')"
      >
        +
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  /** Formatted "100% ROI by" date/time — already resolved by the composable, this component does no
   *  date math of its own. */
  deadlineLabel: string;
  /** How many sales `deadlineLabel` is out from now — 1 is the default (the very next sale). */
  saleCount: number;
  /** Upper bound `saleCount` can reach (matches C3's own default max `saleCount`). */
  cap: number;
}>();

defineEmits<{
  (e: 'increment'): void;
  (e: 'decrement'): void;
}>();
</script>
