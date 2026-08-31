<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-all" @click="$emit('close')" />

      <!-- Dialog -->
      <div
        class="relative w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl rounded-2xl border border-white/50 bg-white/95 transition-all duration-300 animate-in fade-in zoom-in-95"
      >
        <div
          class="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-100 flex items-center gap-3"
        >
          <div class="p-1.5 bg-indigo-100 rounded-lg text-indigo-600">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
              />
            </svg>
          </div>
          <h3 class="text-xs font-black text-slate-800 uppercase tracking-widest">Compare Variants</h3>
        </div>

        <div class="px-6 pt-3 border-b border-slate-100 flex items-center gap-1">
          <button
            v-for="tab in TABS"
            :key="tab.key"
            class="px-3 py-2 text-[9px] font-black uppercase tracking-widest border-b-2 transition-colors"
            :class="
              activeTab === tab.key
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            "
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>

        <div class="flex-1 overflow-y-auto">
          <template v-if="activeTab === 'summary'">
            <div class="p-4 overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="text-[8px] font-black text-slate-400 uppercase tracking-wider">
                    <th class="px-2 py-1.5">Variant</th>
                    <th class="px-2 py-1.5">Tier 13</th>
                    <th class="px-2 py-1.5">Build</th>
                    <th class="px-2 py-1.5">Duration</th>
                    <th class="px-2 py-1.5">Peak ELR</th>
                    <th class="px-2 py-1.5">Peak Earnings</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in rows"
                    :key="row.key"
                    class="text-[10px] font-bold text-slate-700 border-t border-slate-100 cursor-pointer transition-colors"
                    :class="row.key === activeVariantKey ? 'bg-indigo-50' : 'hover:bg-slate-50'"
                    @click="select(row.key)"
                  >
                    <td class="px-2 py-2 flex items-center gap-1.5">
                      <svg
                        v-if="row.key === activeVariantKey"
                        class="w-3 h-3 text-indigo-600 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                      <span v-else class="w-3 flex-shrink-0" />
                      <span class="w-2 h-2 rounded-full flex-shrink-0" :style="{ background: row.color }" />
                      <span :class="row.key === activeVariantKey ? 'text-indigo-700' : ''">{{ row.label }}</span>
                    </td>
                    <td class="px-2 py-2">
                      <span
                        v-if="row.tier13Unlocked"
                        class="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-amber-50 text-amber-600 border border-amber-200"
                      >
                        Unlocked
                      </span>
                      <span v-else class="text-slate-300">—</span>
                    </td>
                    <td class="px-2 py-2 font-mono-premium">{{ formatDuration(row.summary.buildDurationSeconds) }}</td>
                    <td class="px-2 py-2 font-mono-premium">{{ formatDuration(row.summary.totalDurationSeconds) }}</td>
                    <td class="px-2 py-2 font-mono-premium">{{ formatNumber(row.summary.maxELR * 3600, 3) }}/hr</td>
                    <td class="px-2 py-2 font-mono-premium">
                      {{ formatNumber(row.summary.maxEarningsRate * 3600, 3) }}/hr
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="px-4 pb-4 overflow-x-auto">
              <h4 class="px-2 pb-1.5 text-[8px] font-black text-slate-400 uppercase tracking-wider">Research Levels</h4>
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="text-[8px] font-black text-slate-400 uppercase tracking-wider">
                    <th class="px-2 py-1.5">Variant</th>
                    <th v-for="col in RESEARCH_COLUMNS" :key="col.id" class="px-1 py-1.5 w-[4.75rem] align-bottom">
                      <div class="flex flex-col items-center gap-1">
                        <img
                          :src="iconURL(getResearchIconPath(col.id), 64)"
                          class="w-5 h-5 object-contain"
                          :alt="col.name"
                        />
                        <span class="text-[7px] leading-tight text-center normal-case tracking-normal">{{
                          col.name
                        }}</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in rows"
                    :key="row.key"
                    class="text-[10px] font-bold text-slate-700 border-t border-slate-100 cursor-pointer transition-colors"
                    :class="row.key === activeVariantKey ? 'bg-indigo-50' : 'hover:bg-slate-50'"
                    @click="select(row.key)"
                  >
                    <td class="px-2 py-2">
                      <span :class="row.key === activeVariantKey ? 'text-indigo-700' : ''">{{ row.label }}</span>
                    </td>
                    <td
                      v-for="col in RESEARCH_COLUMNS"
                      :key="col.id"
                      class="px-1 py-2 text-center font-mono-premium"
                      :class="(row.researchLevels[col.id] || 0) >= col.maxLevel ? 'text-amber-600' : ''"
                    >
                      {{ (row.researchLevels[col.id] || 0) >= col.maxLevel ? 'Max' : row.researchLevels[col.id] || 0 }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <div v-else-if="activeTab === 'c3'" class="p-4">
            <C3ComparisonChart :variants="variants" />
          </div>

          <div v-else-if="activeTab === 'tewait'" class="p-4">
            <TEWaitComparisonChart :variants="variants" :active-variant-key="activeVariantKey" :target-t-e="targetTE" />
          </div>
        </div>

        <div class="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            class="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all rounded-xl hover:shadow-sm"
            @click="$emit('close')"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { iconURL, allResearches } from 'lib';
import { formatNumber, formatDuration } from '@/lib/format';
import { getResearchIconPath } from '@/lib/assets';
import type { Research } from '@/types';
import type { VariantKey, VariantResult } from '@/stores/autoPlanner';
import { variantLabel, variantColor } from '@/lib/charts/variantComparisonData';
import C3ComparisonChart from './charts/C3ComparisonChart.vue';
import TEWaitComparisonChart from './charts/TEWaitComparisonChart.vue';

const props = defineProps<{
  show: boolean;
  variants: Partial<Record<VariantKey, VariantResult>>;
  activeVariantKey?: VariantKey;
  targetTE?: number | null;
}>();

const emit = defineEmits<{
  close: [];
  select: [variant: VariantKey];
}>();

const TABS: { key: 'summary' | 'c3' | 'tewait'; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'c3', label: 'C3 Shift' },
  { key: 'tewait', label: 'TE-Wait Race' },
];
const activeTab = ref<(typeof TABS)[number]['key']>('summary');

// Tier 11-13 researches to break out in the research-levels table below the main comparison,
// in the order they should be displayed. `maxLevel` (looked up from researches.json) lets the
// table show "Max" instead of a number once a variant has fully maxed that research.
const RESEARCH_COLUMNS: { id: string; name: string; maxLevel: number }[] = [
  { id: 'dark_containment', name: 'Dark Containment' },
  { id: 'multi_layering', name: 'Multiversal Layering' },
  { id: 'timeline_diversion', name: 'Timeline Diversion' },
  { id: 'wormhole_dampening', name: 'Wormhole Dampening' },
  { id: 'micro_coupling', name: 'Graviton Coupling' },
  { id: 'neural_net_refine', name: 'Neural Net Refinement' },
  { id: 'hyper_portalling', name: 'Hyper Portalling' },
  { id: 'relativity_optimization', name: 'Relativity Optimization' },
].map(col => ({
  ...col,
  maxLevel: (allResearches as Research[]).find(r => r.id === col.id)?.levels ?? Infinity,
}));

const rows = computed(() =>
  (Object.entries(props.variants) as [VariantKey, VariantResult | undefined][])
    .filter((entry): entry is [VariantKey, VariantResult] => !!entry[1])
    .map(([key, result]) => ({
      key,
      label: variantLabel(key),
      color: variantColor(key),
      summary: result.summary,
      tier13Unlocked: result.summary.tier13Unlocked,
      // Research resets to empty at the start of every ascension (see deriveNextStartState),
      // so the final snapshot's level for a given research IS the highest level purchased
      // during this plan — no need to scan every buy_research action for it.
      researchLevels: result.actions[result.actions.length - 1]?.endState.researchLevels ?? {},
    }))
    .sort((a, b) => a.summary.totalDurationSeconds - b.summary.totalDurationSeconds)
);

const select = (variant: VariantKey) => {
  emit('select', variant);
};
</script>

<style scoped>
.font-mono-premium {
  font-family: 'JetBrains Mono', 'Roboto Mono', monospace;
}

.animate-in {
  animation-duration: 200ms;
}
</style>
