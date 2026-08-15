<template>
  <details class="mt-3">
    <summary class="cursor-pointer text-gray-500 hover:text-gray-700 select-none">
      Probability breakdown<template v-if="heading"> — {{ heading }}</template>
    </summary>

    <div class="mt-2 text-xs bg-gray-50 rounded p-2 space-y-0.5">
      <div class="font-medium text-gray-700">
        P(legendary) = {{ (bestProbability * 100).toFixed(2) }}%
        <span class="text-gray-400 font-normal ml-1">= 1 − (1 − P(craft)) × (1 − P(drop))</span>
      </div>
      <div class="pl-3">
        <span class="text-green-700 font-medium">P(craft) = {{ (craftProbability * 100).toFixed(2) }}%</span>
        <span class="text-gray-400 ml-1">via 1 − (1 − p)^α</span>
      </div>
      <div class="pl-6 text-gray-500">
        α = {{ expectedCrafts.toFixed(2) }} craftable × {{ (pCraft * 100).toFixed(2) }}% per craft
      </div>
      <div class="pl-3">
        <span class="text-blue-700 font-medium">P(drop) = {{ (dropProbability * 100).toFixed(2) }}%</span>
        <span class="text-gray-400 ml-1">via 1 − e^(−λ)</span>
      </div>
      <div class="pl-6 text-gray-500">λ = {{ lambda.toFixed(3) }} expected direct legendary drops</div>
    </div>

    <template v-if="craftChainTree">
      <div class="text-xs font-medium text-gray-500 uppercase tracking-wide mt-3 mb-1">Craft chain</div>
      <div class="flex items-baseline gap-1 text-xs py-0.5 font-medium text-gray-700 pl-1">
        Target: α = {{ expectedCrafts.toFixed(2) }} craftable
      </div>
      <ul class="text-xs">
        <optimizer-recipe-tree-row :node="craftChainTree">
          <template #metrics="{ node }">
            <span class="font-mono text-xs whitespace-nowrap flex-shrink-0">
              <template v-if="hasInventory && node.metrics.owned > 0.005">
                <span class="text-amber-600">{{ formatCount(node.metrics.owned) }} inv</span>
                <span class="text-gray-400"> + </span>
              </template>
              <span class="text-blue-600">{{ node.metrics.dropped.toFixed(1) }} drop</span>
              <template v-if="node.metrics.crafted > 0.005">
                <span class="text-gray-400"> + </span>
                <span class="text-purple-600">{{ node.metrics.crafted.toFixed(1) }} craft</span>
              </template>
              <span class="text-gray-400"> → </span>
              <span
                class="font-semibold"
                :class="
                  node.metrics.owned + node.metrics.dropped + node.metrics.crafted >= node.metrics.consumed - 0.01
                    ? 'text-green-700'
                    : 'text-amber-600'
                "
                >{{ node.metrics.consumed.toFixed(1) }} used</span
              >
            </span>
          </template>
        </optimizer-recipe-tree-row>
      </ul>
    </template>

    <template v-if="missionLegendarySources.length > 0">
      <div class="text-xs font-medium text-gray-500 uppercase tracking-wide mt-3 mb-1">
        Direct legendary sources (λ = {{ lambda.toFixed(3) }})
      </div>
      <div
        v-for="(contrib, ci) in missionLegendarySources"
        :key="'contrib-' + ci"
        class="flex items-center gap-1.5 text-xs py-0.5"
      >
        <span class="w-2 h-2 rounded-full flex-shrink-0 bg-green-500"></span>
        <span class="text-gray-700 flex-1">
          {{ contrib.numShipsLaunched }}×
          <mission-name :mission="contrib.ship" :target="contrib.targetAfxId" :no-link="true" class="inline-block" />
        </span>
        <span class="font-mono text-blue-700">+{{ contrib.legendaryDrops.toFixed(4) }}</span>
      </div>
    </template>
  </details>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue';

import type { CraftChainMetrics, MissionLegendaryRow, RecipeTreeNode } from '@/lib';
import MissionName from '@/components/MissionName.vue';
import OptimizerRecipeTreeRow from './OptimizerRecipeTreeRow.vue';

export default defineComponent({
  components: { MissionName, OptimizerRecipeTreeRow },
  props: {
    heading: { type: String, default: '' },
    bestProbability: { type: Number, required: true },
    craftProbability: { type: Number, required: true },
    dropProbability: { type: Number, required: true },
    expectedCrafts: { type: Number, required: true },
    pCraft: { type: Number, required: true },
    lambda: { type: Number, required: true },
    craftChainTree: { type: Object as PropType<RecipeTreeNode<CraftChainMetrics> | null>, required: true },
    missionLegendarySources: { type: Array as PropType<MissionLegendaryRow[]>, required: true },
    hasInventory: { type: Boolean, required: true },
  },
  setup() {
    // Owned stock is whole at n=1 but demand-split (so fractional) for n>=2.
    const formatCount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
    return { formatCount };
  },
});
</script>
