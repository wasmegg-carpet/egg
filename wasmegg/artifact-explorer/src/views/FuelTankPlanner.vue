<template>
  <div class="-mx-4 sm:mx-0 mt-2 mb-4 space-y-4">
    <div class="bg-gray-100 px-4 py-4 border-b border-gray-200 sm:px-6 sm:rounded-lg sm:shadow-sm">
      <div class="-ml-4 -mt-2 flex items-center justify-between flex-wrap sm:flex-nowrap">
        <div class="ml-4 mt-2 space-y-1">
          <artifact-name
            v-for="artifact in artifacts"
            :key="artifact.id"
            :artifact="artifact"
            :show-tier="false"
            :no-link="true"
            :no-availability-marker="true"
          />
        </div>
        <div class="ml-4 mt-2 flex-shrink-0">
          <share :id="serializedArtifactIds" :page="'tank'" />
        </div>
      </div>
    </div>

    <div class="px-4 sm:px-0">
      <ArtifactMissionOptimizer :artifact-ids="artifactIds"> </ArtifactMissionOptimizer>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType, toRefs } from 'vue';

import { iconURL } from 'lib';
import { getArtifactTierPropsFromId as id2artifact } from 'lib/artifacts/data';
import { cmpArtifactTiers, serializeTankIds } from '@/lib';
import BaseInfo from 'ui/components/BaseInfo.vue';
import ArtifactName from '@/components/ArtifactName.vue';
import ArtifactMissionOptimizer from '@/components/ArtifactMissionOptimizer.vue';
import Share from '@/components/Share.vue';
import craftingPriceFormulaImage from '@/assets/crafting-price-formula.svg';

function recursiveIngredientsOf(artifact: ReturnType<typeof id2artifact>) {
  if (!artifact.recipe) {
    return [];
  }
  const queue = artifact.recipe.ingredients.map(it => id2artifact(it.id)!);
  const directIngredients = new Set(queue.map(it => it.id));
  const seen = new Set();
  const ingredients = [];
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    if (!directIngredients.has(item.id)) {
      ingredients.push(item);
    }
    if (!item.recipe) {
      continue;
    }
    queue.push(...item.recipe.ingredients.map(it => id2artifact(it.id)));
  }
  return ingredients.sort(cmpArtifactTiers);
}

export default defineComponent({
  components: {
    BaseInfo,
    ArtifactName,
    ArtifactMissionOptimizer,
    Share,
  },
  props: {
    artifactIds: {
      type: Array as PropType<string[]>,
      required: true,
    },
  },
  setup(props) {
    const { artifactIds } = toRefs(props);

    // Still serialized, for `Share`: the ids stopped driving the route, but the link this writes is
    // the one shape every bookmark out there is already in.
    const serializedArtifactIds = computed(() => serializeTankIds(artifactIds.value));
    const artifacts = computed(() => artifactIds.value.map(id => id2artifact(id)));
    const recursiveIngredientsByArtifact = computed(() => {
      const map = new Map<string, ReturnType<typeof id2artifact>[]>();
      for (const artifact of artifacts.value) {
        map.set(artifact.id, recursiveIngredientsOf(artifact));
      }
      return map;
    });

    return {
      id2artifact,
      serializedArtifactIds,
      artifacts,
      recursiveIngredientsByArtifact,
      craftingPriceFormulaImage,
      iconURL,
    };
  },
});
</script>
