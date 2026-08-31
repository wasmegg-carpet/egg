<template>
  <div ref="containerRef" :style="{ width: '100%', height }" />
</template>

<script setup lang="ts">
import { ref, shallowRef, onMounted, onBeforeUnmount, watch } from 'vue';
import { echarts, type ChartOption } from '@/lib/charts/echarts';
import type { ECharts } from '@/lib/charts/echarts';

const props = withDefaults(
  defineProps<{
    option: ChartOption;
    height?: string;
  }>(),
  {
    height: '320px',
  }
);

const containerRef = ref<HTMLDivElement | null>(null);
const chart = shallowRef<ECharts | null>(null);
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!containerRef.value) return;
  chart.value = echarts.init(containerRef.value);
  chart.value.setOption(props.option);

  // The modal this lives in can resize (window resize, tab switch reflow) without the chart's own
  // element ever unmounting, so a plain onMounted-time size read isn't enough — keep the canvas in
  // sync with its container for the component's whole lifetime.
  resizeObserver = new ResizeObserver(() => chart.value?.resize());
  resizeObserver.observe(containerRef.value);
});

watch(
  () => props.option,
  option => {
    // notMerge: this component always receives a fully-formed option from its caller (built fresh
    // by a computed), so merging against the previous option would leave stale series/markPoint
    // data around when a variant disappears from the comparison.
    chart.value?.setOption(option, { notMerge: true });
  }
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  chart.value?.dispose();
  chart.value = null;
});
</script>
