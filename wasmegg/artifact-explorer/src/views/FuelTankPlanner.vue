<template>
  <div v-if="artifactIds.length > 0" class="-mx-4 sm:mx-0 mt-2 mb-4 space-y-4">
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
      <ArtifactMissionOptimizer :artifact-ids="artifactIds">
        <template v-for="artifact in artifacts" :key="artifact.id">
          <template v-if="artifact.recipe">
            <div class="px-4 py-4 sm:px-6 space-y-2">
              <div class="text-sm font-medium text-gray-500">Crafting recipe:</div>
              <div>
                <table class="tabular-nums">
                  <tbody>
                    <tr v-for="ingredient in artifact.recipe.ingredients" :key="ingredient.id">
                      <td class="text-left text-sm">{{ ingredient.count }}&times;</td>
                      <td class="pl-1">
                        <artifact-name :artifact="id2artifact(ingredient.id)" :show-tier="true" />
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div class="my-0.5 -mx-0.5 flex items-center space-x-1">
                  <img class="h-4 w-4" :src="iconURL('egginc-extras/icon_golden_egg.png', 64)" />
                  <span class="text-sm">
                    {{ artifact.recipe.crafting_price.initial.toLocaleString('en-US') }} &ndash;
                    {{ artifact.recipe.crafting_price.minimum.toLocaleString('en-US') }}
                  </span>
                  <base-info
                    v-tippy="{
                      content:
                        `The crafting price is determined by the following formula: ` +
                        `<img class='p-2 bg-white' src='${craftingPriceFormulaImage}'>`,
                      allowHTML: true,
                    }"
                  />
                </div>
                <span class="text-sm"> {{ artifact.crafting_xp.toLocaleString('en-US') }} Crafting XP </span>
              </div>
            </div>
            <hr />
          </template>

          <template v-if="!artifact.ingredients_available_from_missions">
            <div class="px-4 py-4 sm:px-6 space-y-2">
              <div class="flex items-center space-x-1">
                <span class="text-sm font-medium text-gray-500">Hard dependencies</span>
                <base-info
                  v-tippy="{
                    content:
                      'For an item unobtainable from missions, the hard dependencies are the highest level mission-obtainable items in the crafting ingredient tree; i.e., you absolutely have to gather these ingredients to craft the item in question, no way to skip them.',
                  }"
                />
              </div>
              <div>
                <table class="tabular-nums">
                  <tbody>
                    <tr v-for="ingredient in artifact.hard_dependencies" :key="ingredient.id">
                      <td class="text-left text-sm">{{ ingredient.count }}&times;</td>
                      <td class="pl-1">
                        <artifact-name :artifact="id2artifact(ingredient.id)" :show-tier="true" />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <hr />
          </template>

          <template v-if="recursiveIngredientsByArtifact.get(artifact.id)?.length">
            <div class="px-4 py-4 sm:px-6 space-y-2">
              <div class="flex items-center space-x-1">
                <span class="text-sm font-medium text-gray-500">Recursive ingredients</span>
                <base-info
                  v-tippy="{
                    content: 'Ingredients of ingredients, ingredients of ingredients of ingredients, etc.',
                  }"
                />
              </div>
              <ul class="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                <li v-for="ingredient in recursiveIngredientsByArtifact.get(artifact.id)" :key="ingredient.id">
                  <artifact-name :artifact="ingredient" :show-tier="true" />
                </li>
              </ul>
            </div>
            <hr />
          </template>
        </template>
      </ArtifactMissionOptimizer>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, toRefs, watchEffect } from 'vue';
import { useRouter } from 'vue-router';

import { iconURL } from 'lib';
import { getArtifactTierPropsFromId as id2artifact } from 'lib/artifacts/data';
import { cmpArtifactTiers, serializeTankIds } from '@/lib';
import { parseKnownTankIds } from '@/lib/filter';
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
    tankPlannerArtifactId: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const { tankPlannerArtifactId: rawParam } = toRefs(props);
    const router = useRouter();

    // Drop any id that doesn't resolve before it reaches id2artifact()/getArtifactTierPropsFromId(), which
    // throw for unrecognized ids. The route param comes straight from the URL, so a stale bookmark must not crash this view.
    const artifactIds = computed(() => parseKnownTankIds(rawParam.value));
    const serializedArtifactIds = computed(() => serializeTankIds(artifactIds.value));
    const artifacts = computed(() => artifactIds.value.map(id => id2artifact(id)));
    const recursiveIngredientsByArtifact = computed(() => {
      const map = new Map<string, ReturnType<typeof id2artifact>[]>();
      for (const artifact of artifacts.value) {
        map.set(artifact.id, recursiveIngredientsOf(artifact));
      }
      return map;
    });

    // Every id in the URL was unknown, so there is nothing to plan for. Bounce home, matching Main.vue where
    // zero selected artifacts simply means this route is never navigated to.
    watchEffect(() => {
      if (rawParam.value && artifactIds.value.length === 0) {
        router.replace({ name: 'home' });
      }
    });

    return {
      id2artifact,
      artifactIds,
      serializedArtifactIds,
      artifacts,
      recursiveIngredientsByArtifact,
      craftingPriceFormulaImage,
      iconURL,
    };
  },
});
</script>
