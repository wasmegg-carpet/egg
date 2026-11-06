/**
 * Central, tree-shaken echarts registration.
 *
 * Import `echarts` from here (never from the top-level `echarts` package) so every chart in this
 * app shares one registration call and one bundle-sized subset of components — pulling in
 * `echarts/core` + only the pieces below keeps the chart bundle to a fraction of the full
 * `echarts` package (which registers every chart type, including many this app never uses).
 */
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import type { LineSeriesOption } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkPointComponent,
  MarkLineComponent,
  DataZoomComponent,
} from 'echarts/components';
import type {
  GridComponentOption,
  TooltipComponentOption,
  LegendComponentOption,
  DataZoomComponentOption,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ComposeOption } from 'echarts/core';

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkPointComponent,
  MarkLineComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export type ChartOption = ComposeOption<
  LineSeriesOption | GridComponentOption | TooltipComponentOption | LegendComponentOption | DataZoomComponentOption
>;

export { echarts };
export type { ECharts } from 'echarts/core';
