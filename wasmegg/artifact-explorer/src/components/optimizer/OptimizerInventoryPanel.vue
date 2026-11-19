<template>
  <div v-if="tree && hasInventory" class="mt-4 border border-gray-200 rounded-lg p-4">
    <details>
      <summary class="text-base font-semibold text-gray-700 mb-3">Inventory</summary>
      <ul class="space-y-1 text-sm">
        <optimizer-recipe-tree-row :node="tree">
          <template #metrics="{ node }">
            <span
              class="font-mono text-xs"
              :class="node.metrics.have > 0 ? 'text-green-700 font-semibold' : 'text-gray-400'"
              >{{ node.metrics.have }}</span
            >
          </template>
        </optimizer-recipe-tree-row>
      </ul>
    </details>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue';

import type { RecipeTreeNode } from '@/lib';
import OptimizerRecipeTreeRow from 'ui/components/mission-optimizer/OptimizerRecipeTreeRow.vue';

export default defineComponent({
  components: { OptimizerRecipeTreeRow },
  props: {
    tree: { type: Object as PropType<RecipeTreeNode<{ have: number }> | null>, required: true },
    hasInventory: { type: Boolean, required: true },
  },
});
</script>
