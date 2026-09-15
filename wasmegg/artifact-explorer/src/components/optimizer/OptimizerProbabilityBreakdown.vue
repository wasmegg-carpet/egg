<template>
  <details class="mt-3">
    <summary class="cursor-pointer text-gray-500 hover:text-gray-700 select-none">
      Probability breakdown<template v-if="heading"> — {{ heading }}</template>
    </summary>

    <div class="mt-2 text-xs bg-gray-50 rounded p-2 space-y-0.5">
      <div class="font-medium text-gray-700">
        Chance of at least one legendary: {{ formatProbabilityForDisplay(bestProbability) }}
      </div>
      <div class="pl-3">
        <span class="text-green-700 font-medium">Crafting: {{ formatProbabilityForDisplay(craftProbability) }}</span>
      </div>
      <div class="pl-6 text-gray-500">
        This plan can attempt {{ expectedCrafts.toFixed(2) }} craft{{
          expectedCrafts.toFixed(2) === '1.00' ? '' : 's'
        }}, each with a {{ formatProbabilityForDisplay(pCraft) }} chance of turning up a legendary.
      </div>
      <div class="pl-3">
        <span class="text-blue-700 font-medium">Direct drops: {{ formatProbabilityForDisplay(dropProbability) }}</span>
      </div>
      <div class="pl-6 text-gray-500">
        The missions are expected to drop about {{ lambda.toFixed(3) }} legendaries directly.
      </div>
      <div class="pl-3 text-gray-400">
        You miss out only if every craft and every drop fails, so together they give
        {{ formatProbabilityForDisplay(bestProbability) }} overall.
      </div>
    </div>

    <template v-if="craftChainTree">
      <div class="text-xs font-medium text-gray-500 uppercase tracking-wide mt-3 mb-1">
        Craft chain<template v-if="craftChainCost > 0.5"> — {{ formatGoldenEggs(craftChainCost) }} GE</template>
      </div>
      <div class="flex items-baseline gap-1 text-xs py-0.5 font-medium text-gray-700 pl-1">
        Target: {{ expectedCrafts.toFixed(2) }} craftable
      </div>
      <ul class="text-xs">
        <optimizer-recipe-tree-row :node="craftChainTree">
          <template #metrics="{ node }">
            <span class="font-mono text-xs inline-flex flex-col items-end">
              <span class="whitespace-nowrap">
                <template v-if="hasInventory && node.metrics.ownedShare > 0.005">
                  <span class="text-amber-600">{{ formatCount(node.metrics.ownedShare) }} inv</span>
                  <span class="text-gray-400"> + </span>
                </template>
                <span class="text-blue-600">{{ node.metrics.droppedShare.toFixed(1) }} drop</span>
                <template v-if="node.metrics.craftedShare > 0.005">
                  <span class="text-gray-400"> + </span>
                  <span class="text-purple-600">{{ node.metrics.craftedShare.toFixed(1) }} craft</span>
                </template>
                <span class="text-gray-400"> → </span>
                <span
                  class="font-semibold"
                  :class="
                    node.metrics.ownedShare + node.metrics.droppedShare + node.metrics.craftedShare >=
                    node.metrics.consumedShare - 0.01
                      ? 'text-green-700'
                      : 'text-amber-600'
                  "
                  >{{ node.metrics.consumedShare.toFixed(1) }} used</span
                >
              </span>
              <span v-if="node.metrics.goldenEggCost > 0.5" class="whitespace-nowrap text-yellow-600">
                {{ formatGoldenEggs(node.metrics.goldenEggCost) }} GE
              </span>
            </span>
          </template>
        </optimizer-recipe-tree-row>
      </ul>
    </template>

    <template v-if="missionLegendarySources.length > 0">
      <div class="text-xs font-medium text-gray-500 uppercase tracking-wide mt-3 mb-1">
        Direct legendary sources (expected drops: {{ lambda.toFixed(3) }})
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
import { computed, defineComponent, PropType } from 'vue';

import type { CraftChainMetrics, MissionLegendaryRow, RecipeTreeNode } from '@/lib';
import { formatGoldenEggs, formatProbabilityForDisplay, craftChainCost as computeCraftChainCost } from '@/lib';
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
  setup(props) {
    // Owned stock is whole at n=1 but demand-split (so fractional) for n>=2.
    const formatCount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
    // This target's share of the plan's bill, not the plan total.
    const craftChainCost = computed(() => computeCraftChainCost(props.craftChainTree));
    return { formatCount, craftChainCost, formatGoldenEggs, formatProbabilityForDisplay };
  },
});
</script>
