<template>
  <div v-if="rays.length === 0" class="px-4 py-10 text-center text-[10px] font-bold text-slate-400">
    No variant in this comparison has a TE-wait phase to compare.
  </div>
  <template v-else>
    <EChart :option="option" height="420px" />
    <div
      class="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-2 text-[8px] font-bold text-slate-400 uppercase tracking-wide"
    >
      <span class="flex items-center gap-1"
        ><span class="inline-block w-3 border-t-2 border-slate-400" /> Simulated</span
      >
      <span class="flex items-center gap-1"
        ><span class="inline-block w-3 border-t-2 border-dashed border-slate-400" /> Projected (constant ELR)</span
      >
      <span class="flex items-center gap-1"><span class="text-slate-700">◆</span> TE earned</span>
      <span class="flex items-center gap-1"><span class="text-slate-700">✦</span> Variants cross</span>
      <span v-if="targetTECrossing" class="flex items-center gap-1">
        <span class="inline-block w-0.5 h-3 bg-slate-900" /> Target TE reached ({{
          variantLabel(targetTECrossing.variant)
        }})
      </span>
    </div>

    <div v-if="neverCrossing.length" class="mx-2 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <div class="text-[8px] font-black uppercase tracking-wider text-amber-700 mb-1">Never crosses</div>
      <ul class="space-y-0.5">
        <li v-for="note in neverCrossing" :key="`${note.a}-${note.b}`" class="text-[10px] font-bold text-amber-800">
          <span :style="{ color: variantColor(note.leader) }">{{ variantLabel(note.leader) }}</span>
          stays ahead of
          <span :style="{ color: variantColor(note.other) }">{{ variantLabel(note.other) }}</span>
          for the entire comparison —
          <span class="font-medium normal-case">{{ note.explanation }}</span>
        </li>
      </ul>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import EChart from '@/components/charts/EChart.vue';
import type { ChartOption } from '@/lib/charts/echarts';
import type { VariantKey, VariantResult } from '@/stores/autoPlanner';
import { VIRTUE_EGG_NAMES } from '@/types/actions/virtue';
import { useVirtueStore } from '@/stores/virtue';
import { formatAbsoluteTime, formatNumber } from '@/lib/format';
import {
  VARIANT_KEY_ORDER,
  variantColor,
  variantLabel,
  buildVariantRay,
  projectedSegment,
  computeCrossings,
  computeHorizon,
  findTargetTECrossing,
  formatChartTickDate,
  shiftForChartTimezone,
  type VariantRay,
  type ChartTooltipParams,
} from '@/lib/charts/variantComparisonData';

const props = defineProps<{
  variants: Partial<Record<VariantKey, VariantResult>>;
  activeVariantKey?: VariantKey;
  targetTE?: number | null;
}>();

const virtueStore = useVirtueStore();

// How far below the lowest plotted point the Y axis starts, as a fraction of that point's own
// value — keeps the axis from defaulting to a 0 baseline that dwarfs the actual spread between
// variants (they're all already deep into the quintillions by K3, so 0 is never a meaningful
// reference point on this chart).
const Y_AXIS_MIN_PADDING = 0.0;

const rays = computed<VariantRay[]>(() => {
  const built: VariantRay[] = [];
  for (const key of VARIANT_KEY_ORDER) {
    const result = props.variants[key];
    if (!result) continue;
    const ray = buildVariantRay(key, result);
    if (ray) built.push(ray);
  }
  return built;
});

const crossingResult = computed(() => computeCrossings(rays.value));

// The vertical line marks when the player's actually-chosen plan reaches the target TE — not
// whichever variant happens to get there first, which is a different question this chart already
// answers on its own via the diagonal lines' relative slopes.
const activeRay = computed(() => rays.value.find(r => r.key === props.activeVariantKey));

const targetTECrossing = computed(() =>
  activeRay.value && props.targetTE ? findTargetTECrossing(activeRay.value, props.targetTE) : null
);

const horizon = computed(() =>
  computeHorizon(
    rays.value,
    crossingResult.value.crossings,
    targetTECrossing.value ? [targetTECrossing.value.time] : []
  )
);

const neverCrossing = computed(() =>
  crossingResult.value.neverCrossing.map(note => {
    const other = note.a === note.leader ? note.b : note.a;
    return {
      ...note,
      other,
      explanation:
        note.reason === 'parallel'
          ? 'both reach the exact same peak earnings rate, so the gap between them never closes.'
          : "the math says they'd eventually cross, but only before both variants have settled into their steady rate — it never actually happens on this chart.",
    };
  })
);

const option = computed<ChartOption>(() => {
  const tz = virtueStore.ascensionTimezone;
  const horizonMs = horizon.value;

  // echarts' time axis can only compute its own "nice" day/week tick boundaries in the browser's
  // local zone or UTC — never an arbitrary IANA zone — so every x-value below is pre-shifted by
  // `tz`'s offset and the axis is told (`useUTC: true`) to treat that shifted value as UTC. See
  // `shiftForChartTimezone`'s doc comment for the full mechanics. Every formatter that reads a
  // value back out of the chart (tooltip, axis labels) must format it with `'UTC'` to match.
  const shift = (ms: number) => shiftForChartTimezone(ms, tz);

  const variantSeries = rays.value.flatMap(ray => {
    const color = variantColor(ray.key);
    const name = variantLabel(ray.key);
    const projected = projectedSegment(ray, horizonMs);

    return [
      {
        id: `${ray.key}-real`,
        name,
        type: 'line' as const,
        showSymbol: false,
        lineStyle: { width: 2, color },
        itemStyle: { color },
        data: ray.realPoints.map(p => [shift(p.time), p.value]),
        markPoint: {
          symbol: 'diamond',
          symbolSize: 12,
          itemStyle: { color, borderColor: '#fff', borderWidth: 1.5 },
          label: { show: false },
          data: ray.teMarkers.map((m, i) => ({
            coord: [shift(m.time), m.value],
            kind: 'te' as const,
            egg: m.egg ? VIRTUE_EGG_NAMES[m.egg] : '',
            perEggTE: m.perEggTE ?? 0,
            // teMarkers is chronological, one whole TE per entry, so the running grand total
            // (across all 5 eggs) at the i-th marker is just startTE + i + 1.
            grandTotalTE: ray.startTE + i + 1,
            markerLabel: m.label,
          })),
        },
      },
      {
        id: `${ray.key}-projected`,
        name,
        type: 'line' as const,
        showSymbol: false,
        legendHoverLink: true,
        lineStyle: { width: 2, color, type: 'dashed' as const },
        itemStyle: { color },
        data: projected.map(p => [shift(p.time), p.value]),
        tooltip: { show: false },
      },
    ];
  });

  const crossing = targetTECrossing.value;

  const crossingSeries = {
    id: 'crossings',
    name: 'Crossings',
    type: 'line' as const,
    data: [] as [number, number][],
    showSymbol: false,
    markPoint: {
      symbol: 'path://M12 0 L15 9 L24 9 L17 14 L19 23 L12 18 L5 23 L7 14 L0 9 L9 9 Z',
      symbolSize: 14,
      itemStyle: { color: '#0b0b0b', borderColor: '#fff', borderWidth: 1 },
      label: { show: false },
      data: crossingResult.value.crossings.map(c => ({
        coord: [shift(c.time), c.eggs],
        kind: 'crossing' as const,
        markerLabel: `${variantLabel(c.overtaker)} overtakes ${variantLabel(c.overtaken)}`,
      })),
    },
    markLine: crossing
      ? {
          symbol: 'none',
          silent: false,
          label: {
            show: true,
            formatter: () => 'Target TE reached',
            position: 'insideEndTop' as const,
            fontSize: 9,
            fontWeight: 'bold' as const,
            color: '#0b0b0b',
          },
          lineStyle: { color: '#0b0b0b', width: 1.5 },
          data: [
            {
              xAxis: shift(crossing.time),
              markerLabel: `Target TE (${crossing.totalTE}) reached by ${variantLabel(crossing.variant)}`,
            },
          ],
        }
      : undefined,
  };

  return {
    useUTC: true,
    tooltip: {
      trigger: 'item',
      formatter: rawParams => {
        // See `C3ComparisonChart.vue`'s identical formatter for why this narrows the type here
        // instead of fighting echarts' own broad `TopLevelFormatterParams` union.
        const params = rawParams as ChartTooltipParams;
        if (params.componentType === 'markLine') {
          const dateStr = formatAbsoluteTime(0, params.data!.xAxis!, 'UTC');
          return `<b>${params.data!.markerLabel}</b><br/>${dateStr}`;
        }
        if (params.componentType === 'markPoint') {
          const timeMs = params.data!.coord![0];
          const dateStr = formatAbsoluteTime(0, timeMs, 'UTC');
          if (params.data!.kind === 'te') {
            return `<b>${params.data!.egg} #${params.data!.perEggTE}, ${params.data!.grandTotalTE} Total</b><br/>${dateStr}`;
          }
          return `<b>${params.data!.markerLabel}</b><br/>${dateStr}`;
        }
        const timeMs = params.value?.[0];
        if (timeMs === undefined) return '';
        const dateStr = formatAbsoluteTime(0, timeMs, 'UTC');
        return `<b>${params.seriesName}</b><br/>${formatNumber(params.value![1], 3)} eggs<br/>${dateStr}`;
      },
    },
    legend: {
      top: 0,
      itemWidth: 14,
      itemHeight: 8,
      textStyle: { fontSize: 10 },
      data: rays.value.map(r => variantLabel(r.key)),
    },
    grid: { left: 64, right: 20, top: 32, bottom: 60 },
    xAxis: {
      type: 'time',
      min: shift(Math.min(...rays.value.map(r => r.anchorTime)) * 1000),
      max: shift(horizonMs),
      axisLabel: { formatter: (value: number) => formatChartTickDate(value, 'UTC'), fontSize: 9, hideOverlap: true },
      axisLine: { lineStyle: { color: '#c3c2b7' } },
      splitLine: { lineStyle: { color: '#e1e0d9' } },
    },
    yAxis: {
      type: 'value',
      name: 'Total eggs delivered',
      nameLocation: 'middle',
      nameGap: 54,
      nameTextStyle: { fontSize: 9, color: '#52514e' },
      // Every ray is monotonically increasing from its own anchor point, so the lowest value any
      // series ever plots is the smallest `anchorEggs` across variants — start the axis a little
      // below that (rather than echarts' default 0 baseline) so differences between lines near the
      // bottom of the chart are actually visible instead of being squashed against a huge unused
      // 0-to-lowest-anchor gap.
      min: Math.min(...rays.value.map(r => r.anchorEggs)) * (1 - Y_AXIS_MIN_PADDING),
      axisLabel: { formatter: (v: number) => formatNumber(v, 1), fontSize: 9 },
      axisLine: { show: true, lineStyle: { color: '#c3c2b7' } },
      splitLine: { lineStyle: { color: '#e1e0d9' } },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      { type: 'slider', xAxisIndex: 0, height: 16, bottom: 8 },
    ],
    series: [...variantSeries, crossingSeries] as ChartOption['series'],
  };
});
</script>
