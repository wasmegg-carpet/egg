<template>
  <li>
    <div class="flex flex-wrap items-center gap-1.5" :class="node.isDuplicate ? 'opacity-40' : ''">
      <img :src="node.iconUrl" class="h-5 w-5 flex-shrink-0" />
      <span class="flex-shrink-0" :class="node.isDuplicate ? 'text-gray-400' : 'text-gray-700'">{{ node.name }}</span>
      <span v-if="node.qty > 1" class="text-xs text-gray-400 ml-0.5 flex-shrink-0">×{{ node.qty }}</span>
      <span class="ml-auto">
        <slot name="metrics" :node="node" />
      </span>
    </div>
    <ul v-if="node.children.length" class="ml-2.5 mt-1 space-y-1 border-l border-gray-200 pl-3">
      <optimizer-recipe-tree-row v-for="child in node.children" :key="child.nodeId + '-' + child.depth" :node="child">
        <template #metrics="slotProps">
          <slot name="metrics" v-bind="slotProps" />
        </template>
      </optimizer-recipe-tree-row>
    </ul>
  </li>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue';

import type { RecipeTreeNode } from '@/lib';

export default defineComponent({
  // named for template self-recursion
  name: 'OptimizerRecipeTreeRow',
  props: {
    node: { type: Object as PropType<RecipeTreeNode<unknown>>, required: true },
  },
});
</script>
