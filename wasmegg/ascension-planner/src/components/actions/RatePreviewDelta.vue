<template>
  <div class="mt-1 px-2 py-1 bg-gray-50 border border-gray-200 rounded-md">
    <div class="flex items-center justify-between gap-1.5">
      <span class="text-[9px] font-bold text-gray-400 uppercase tracking-wide">{{ label }}</span>
      <span class="text-[9px] font-bold" :class="deltaColorClass">{{ deltaText }}</span>
    </div>
    <div class="flex items-center justify-center gap-1.5 mt-0.5">
      <span class="text-[10px] font-mono font-bold text-gray-600">{{ formatNumber(before) }}{{ unit }}</span>
      <span class="text-[10px] text-gray-300">&#8594;</span>
      <span class="text-[10px] font-mono font-bold text-gray-900">{{ formatNumber(after) }}{{ unit }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatNumber } from '@/lib/format';

const props = defineProps<{
  label: string;
  before: number;
  after: number;
  unit?: string;
}>();

// null means "can't be expressed as a percent change" (before is 0) — shown as "New" or an em dash
// instead of a misleading/undefined percentage.
const deltaPercent = computed<number | null>(() => {
  if (props.before === 0) return null;
  return ((props.after - props.before) / props.before) * 100;
});

const deltaText = computed(() => {
  if (deltaPercent.value === null) return props.after > 0 ? 'New' : '—';
  const sign = deltaPercent.value > 0 ? '+' : '';
  return `${sign}${deltaPercent.value.toFixed(1)}%`;
});

const deltaColorClass = computed(() => {
  if (deltaPercent.value === null) return props.after > 0 ? 'text-emerald-600' : 'text-gray-400';
  if (deltaPercent.value > 0) return 'text-emerald-600';
  if (deltaPercent.value < 0) return 'text-red-500';
  return 'text-gray-400';
});
</script>
