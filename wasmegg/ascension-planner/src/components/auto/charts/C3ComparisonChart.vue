<template>
  <div v-if="series.length === 0" class="px-4 py-10 text-center text-[10px] font-bold text-slate-400">
    No variant in this comparison has a C3 shift to compare (build phase skipped or not reached).
  </div>
  <template v-else>
    <EChart :option="option" height="380px" />
    <div
      class="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-2 text-[8px] font-bold text-slate-400 uppercase tracking-wide"
    >
      <span class="flex items-center gap-1"
        ><span class="text-slate-400">●</span> Graviton Coupling / Multiversal Layering purchase</span
      >
      <span class="flex items-center gap-1"><span class="text-amber-500">◆</span> Tier 13 unlocked</span>
      <span class="flex items-center gap-1"
        ><span class="text-slate-400">▲ / ▼</span> Research sale or 2× earnings start / end</span
      >
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import EChart from '@/components/charts/EChart.vue';
import type { ChartOption } from '@/lib/charts/echarts';
import type { VariantKey, VariantResult } from '@/stores/autoPlanner';
import { useVirtueStore } from '@/stores/virtue';
import { formatAbsoluteTime, formatNumber } from '@/lib/format';
import {
  VARIANT_KEY_ORDER,
  variantColor,
  variantLabel,
  getC3Actions,
  buildC3EarningsSeries,
  buildC3Markers,
  formatChartTickDate,
  shiftForChartTimezone,
  type C3MarkerKind,
  type ChartTooltipParams,
} from '@/lib/charts/variantComparisonData';

const props = defineProps<{
  variants: Partial<Record<VariantKey, VariantResult>>;
}>();

const virtueStore = useVirtueStore();

// Shape (not color — color already carries variant identity) encodes marker kind. `_start`/`_end`
// pairs share a symbol, distinguished by rotation (up = starts, down = ends).
const MARKER_SYMBOL: Record<C3MarkerKind, string> = {
  graviton_coupling: 'circle',
  multi_layering: 'circle',
  tier13_unlocked: 'diamond',
  research_sale_start: 'triangle',
  research_sale_end: 'triangle',
  earnings_boost_start: 'triangle',
  earnings_boost_end: 'triangle',
};
const MARKER_ROTATE: Record<C3MarkerKind, number> = {
  graviton_coupling: 0,
  multi_layering: 0,
  tier13_unlocked: 0,
  research_sale_start: 0,
  research_sale_end: 180,
  earnings_boost_start: 0,
  earnings_boost_end: 180,
};

interface BuiltMarkerDatum {
  coord: [number, number];
  symbol: string;
  symbolRotate: number;
  symbolSize: number;
  markerLabel: string;
}

interface BuiltSeries {
  key: VariantKey;
  name: string;
  color: string;
  data: [number, number][];
  markData: BuiltMarkerDatum[];
}

const series = computed<BuiltSeries[]>(() => {
  const built: BuiltSeries[] = [];
  for (const key of VARIANT_KEY_ORDER) {
    const result = props.variants[key];
    if (!result) continue;
    const c3 = getC3Actions(result.actions, result.summary.startTime);
    if (!c3 || c3.length < 2) continue;

    const points = buildC3EarningsSeries(c3);
    const markers = buildC3Markers(c3);

    built.push({
      key,
      name: variantLabel(key),
      color: variantColor(key),
      data: points.map(p => [p.time, p.value]),
      markData: markers.map(m => ({
        coord: [m.time, m.value],
        symbol: MARKER_SYMBOL[m.kind as C3MarkerKind],
        symbolRotate: MARKER_ROTATE[m.kind as C3MarkerKind],
        symbolSize: m.kind === 'tier13_unlocked' ? 16 : 10,
        markerLabel: m.label,
      })),
    });
  }
  return built;
});

const option = computed<ChartOption>(() => {
  const tz = virtueStore.ascensionTimezone;

  // echarts' time axis can only compute its own "nice" day/week tick boundaries in the browser's
  // local zone or UTC — never an arbitrary IANA zone — so every x-value below is pre-shifted by
  // `tz`'s offset and the axis is told (`useUTC: true`) to treat that shifted value as UTC. See
  // `shiftForChartTimezone`'s doc comment for the full mechanics. Every formatter that reads a
  // value back out of the chart (tooltip, axis labels) must format it with `'UTC'` to match.
  const shift = (ms: number) => shiftForChartTimezone(ms, tz);

  return {
    useUTC: true,
    tooltip: {
      trigger: 'item',
      formatter: rawParams => {
        // echarts' own formatter param type is a broad, deeply-nested union (and can be an array
        // under `trigger: 'axis'`) — this chart only ever uses `trigger: 'item'`, which always
        // calls back with a single point, so narrow to the handful of fields actually used here.
        const params = rawParams as ChartTooltipParams;
        const timeMs = params.componentType === 'markPoint' ? params.data!.coord![0] : params.value![0];
        const dateStr = formatAbsoluteTime(0, timeMs, 'UTC');
        if (params.componentType === 'markPoint') {
          return `<b>${params.seriesName}</b><br/>${params.data!.markerLabel}<br/>${dateStr}`;
        }
        return `<b>${params.seriesName}</b><br/>${formatNumber(params.value![1], 3)}/hr<br/>${dateStr}`;
      },
    },
    legend: { top: 0, itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 10 } },
    grid: { left: 60, right: 20, top: 32, bottom: 60 },
    xAxis: {
      type: 'time',
      axisLabel: { formatter: (value: number) => formatChartTickDate(value, 'UTC'), fontSize: 9, hideOverlap: true },
      axisLine: { lineStyle: { color: '#c3c2b7' } },
      splitLine: { lineStyle: { color: '#e1e0d9' } },
    },
    yAxis: {
      type: 'value',
      name: 'Earnings rate ($/hr)',
      nameLocation: 'middle',
      nameGap: 44,
      nameTextStyle: { fontSize: 9, color: '#52514e' },
      axisLabel: { formatter: (v: number) => formatNumber(v, 1), fontSize: 9 },
      axisLine: { show: true, lineStyle: { color: '#c3c2b7' } },
      splitLine: { lineStyle: { color: '#e1e0d9' } },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      { type: 'slider', xAxisIndex: 0, height: 16, bottom: 8 },
    ],
    series: series.value.map(s => ({
      id: s.key,
      name: s.name,
      type: 'line',
      showSymbol: false,
      lineStyle: { width: 2, color: s.color },
      itemStyle: { color: s.color },
      data: s.data.map(([time, value]) => [shift(time), value]),
      markPoint: {
        symbolSize: 10,
        itemStyle: { color: s.color, borderColor: '#fff', borderWidth: 1.5 },
        label: { show: false },
        data: s.markData.map(m => ({ ...m, coord: [shift(m.coord[0]), m.coord[1]] })),
      },
    })) as ChartOption['series'],
  };
});
</script>
