<template>
  <div class="lg:grid lg:grid-cols-[minmax(280px,340px)_1fr] lg:gap-6 space-y-6 lg:space-y-0">
    <div class="lg:sticky lg:top-4 self-start">
      <optimizer-sidebar
        :player-id="playerId"
        :pending-compute="pendingCompute"
        :computing="computing"
        :wait-time-days="waitTimeDays"
        :time-budget-invalid="!timeBudgetValid"
        @submit-player-id="submitPlayerId"
        @run-compute="runCompute"
        @update:wait-time-days="setWaitTimeDays"
      />
    </div>

    <div class="min-w-0 space-y-4">
      <div class="border border-gray-200 rounded-lg p-4">
        <h3 class="text-base font-semibold text-gray-700 mb-3">Best Ship Set</h3>
        <div class="relative">
          <div :class="dimSolution ? 'opacity-40 pointer-events-none transition-opacity' : ''">
            <optimizer-solution-card
              v-for="(view, i) in solutionViews"
              :key="'solution-' + i"
              :solution="view.solution"
              :max-wait-time-seconds="lastComputedMaxWaitTimeSeconds"
              :has-inventory="!!playerInventory"
              :golden-egg-balance="playerGoldenEggs"
              :targets="view.targets"
              :plan-cost="view.planCost"
            />
            <p
              v-if="computing && solutionViews.length === 0"
              role="status"
              class="flex items-center gap-2 text-sm text-gray-500"
            >
              <svg class="animate-spin h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Computing the best ship set…
            </p>
            <p v-else-if="computeError" class="text-sm text-red-600">Could not compute a plan: {{ computeError }}</p>
            <p v-else-if="solutionViews.length === 0" class="text-sm text-gray-400">
              {{
                timeBudgetValid
                  ? 'No ship set found for the current settings.'
                  : 'Enter a time budget (e.g. 30, 12d12h, 10h5m) to compute a plan.'
              }}
            </p>
          </div>
          <div v-if="dimSolution" role="status" class="absolute inset-0 flex items-start justify-center pt-8">
            <svg class="animate-spin h-8 w-8 text-gray-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span class="sr-only">Computing the best ship set…</span>
          </div>
        </div>
      </div>

      <template v-for="target in inventoryTrees" :key="'inventory-' + target.nodeId">
        <div
          v-if="inventoryTrees.length > 1 && target.tree && playerInventory"
          class="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1"
        >
          <img :src="target.iconUrl" class="h-4 w-4 flex-shrink-0" alt="" />
          <span>{{ target.name }}</span>
        </div>
        <optimizer-inventory-panel :tree="target.tree" :has-inventory="!!playerInventory" />
      </template>

      <slot />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onUnmounted, PropType, ref, toRefs, watch, watchEffect } from 'vue';

import {
  getArtifactTierPropsFromId,
  getSavedPlayerID,
  iconURL,
  parseDurationDays,
  requestFirstContact,
  savePlayerID,
} from 'lib';

import {
  autoCompute,
  currentOptimizerArtifactIds,
  effectiveConfig,
  effectiveFuelTankCapacity,
  effectivePreviousCraftsOverride,
  effectiveCraftingLevel,
  EFFORT_LAUNCH_PERIOD_SECONDS,
  missionFilters,
  playerGoldenEggs,
  playerInventory,
  setPlayerData,
  setWaitTimeDays,
} from '@/store';
import {
  buildRecipeDag,
  computeBaseYield,
  computeCraftChainTree,
  computeInventoryTree,
  computeCraftUnitPrices,
  computeMissionLegendaryRows,
  computePlanCraftingCost,
  finalizeSolutions,
  lambdaFromDropProbability,
  legendaryCraftProbabilityOf,
  legendaryDataIsSparse,
  type OptimizerSolution,
  type TargetView,
} from '@/lib';
import { enumerateLaunchOptions } from '@/lib/phases';
import { createOptimizerClient, type OptimizerClient, type OptimizerRequestInput } from '@/lib/optimizer-client';
import OptimizerSidebar from './optimizer/OptimizerSidebar.vue';
import OptimizerInventoryPanel from './optimizer/OptimizerInventoryPanel.vue';
import OptimizerSolutionCard from './optimizer/OptimizerSolutionCard.vue';

export default defineComponent({
  components: { OptimizerSidebar, OptimizerInventoryPanel, OptimizerSolutionCard },
  props: {
    artifactIds: { type: Array as PropType<string[]>, required: true },
  },
  setup(props) {
    const { artifactIds } = toRefs(props);

    // In the store so it survives this component unmounting when the selection empties.
    const waitTimeDays = computed(() => missionFilters.value.waitTimeDays);
    const maxWaitTimeSeconds = computed(() => parseDurationDays(waitTimeDays.value));

    const timeBudgetValid = computed(() => Number.isFinite(maxWaitTimeSeconds.value) && maxWaitTimeSeconds.value > 0);

    const playerId = ref(new URLSearchParams(window.location.search).get('playerId') || getSavedPlayerID() || '');
    if (playerId.value) {
      requestFirstContact(playerId.value).then(data => {
        if (data.backup) setPlayerData(data.backup);
      });
    }

    // let the settings UI show each target's prior craft count
    watch(
      artifactIds,
      v => {
        currentOptimizerArtifactIds.value = [...v];
      },
      { immediate: true }
    );
    onUnmounted(() => {
      currentOptimizerArtifactIds.value = [];
    });

    const submitPlayerId = async (id: string) => {
      playerId.value = id;
      savePlayerID(id);
      const data = await requestFirstContact(id);
      if (data.backup) setPlayerData(data.backup);
    };

    const pendingCompute = ref(false);
    const computing = ref(false);
    const computeError = ref('');
    const computedResults = ref<OptimizerSolution[]>([]);
    // what the displayed plan was computed against, not the live input
    const lastComputedMaxWaitTimeSeconds = ref(0);

    const recipeDag = computed<ReturnType<typeof buildRecipeDag>>(() =>
      buildRecipeDag(
        artifactIds.value,
        effectiveCraftingLevel.value,
        playerInventory.value,
        effectivePreviousCraftsOverride.value
      )
    );

    const playerBaseYield = computed<ReturnType<typeof computeBaseYield>>(() =>
      computeBaseYield(playerInventory.value, artifactIds.value, recipeDag.value)
    );

    // Launch-option enumeration stays on the main thread: it is the only step needing the loot dataset, which this bundle already loads.
    const computeInputs = computed<OptimizerRequestInput | null>(() => {
      if (!timeBudgetValid.value) return null;
      const launchPeriodSeconds = EFFORT_LAUNCH_PERIOD_SECONDS[missionFilters.value.effort];
      const maxGemCost = missionFilters.value.maxGemCostEnabled ? missionFilters.value.maxGemCost : undefined;
      const craftBudget = missionFilters.value.maxGoldenEggCostEnabled
        ? {
            capacity: missionFilters.value.maxGoldenEggCost,
            unitPrices: computeCraftUnitPrices(recipeDag.value, playerInventory.value),
          }
        : undefined;
      return {
        options: enumerateLaunchOptions(effectiveConfig.value, recipeDag.value, launchPeriodSeconds),
        recipeDag: recipeDag.value,
        desiredArtifactNodeIds: [...artifactIds.value],
        fuelCapacity: effectiveFuelTankCapacity.value,
        timeCapacityPerSlot: maxWaitTimeSeconds.value,
        baseYield: playerBaseYield.value,
        maximumCost: maxGemCost,
        craftBudget,
      };
    });

    // Lazy so a page that never opens the planner doesn't pay for the worker
    // bundle.
    let client: OptimizerClient | null = null;
    const optimizerClient = () => (client ??= createOptimizerClient());

    async function runCompute() {
      const input = computeInputs.value;
      if (!input) {
        computedResults.value = [];
        pendingCompute.value = false;
        computing.value = false;
        computeError.value = '';
        return;
      }
      const budget = maxWaitTimeSeconds.value;
      pendingCompute.value = false;
      computing.value = true;
      computeError.value = '';
      try {
        const solutions = await optimizerClient().run(input);
        // null: a newer request owns the results and the spinner now.
        if (solutions === null) return;
        // Inputs went invalid mid-flight; nothing supersedes the request, so
        // the stale plan has to be dropped here.
        if (!computeInputs.value) {
          computedResults.value = [];
          computing.value = false;
          return;
        }
        if (autoCompute.value && computeInputs.value !== input) return;
        lastComputedMaxWaitTimeSeconds.value = budget;
        computedResults.value = finalizeSolutions(solutions, input.recipeDag);
        computing.value = false;
      } catch (err) {
        computeError.value = err instanceof Error ? err.message : String(err);
        computedResults.value = [];
        computing.value = false;
      }
    }

    const AUTO_COMPUTE_DEBOUNCE_MS = 250;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    // Reading computeInputs.value HERE is what registers the dependency; if
    // only the debounced callback read it the effect would track autoCompute
    // alone.
    watchEffect(() => {
      const input = computeInputs.value;
      // Every exit must cancel the queued solve first, or a timer armed by the
      // previous run still fires.
      clearTimeout(debounceTimer);
      if (!autoCompute.value) {
        pendingCompute.value = true;
        return;
      }
      if (!input) {
        computedResults.value = [];
        return;
      }
      debounceTimer = setTimeout(runCompute, AUTO_COMPUTE_DEBOUNCE_MS);
    });

    onUnmounted(() => {
      clearTimeout(debounceTimer);
      client?.terminate();
    });

    function artifactDisplay(nodeId: string): { name: string; iconUrl: string } {
      const props = getArtifactTierPropsFromId(nodeId);
      return { name: props.name, iconUrl: iconURL('egginc/' + props.icon_filename, 64) };
    }

    const inventoryTrees = computed(() =>
      artifactIds.value.map(nodeId => ({
        nodeId,
        ...artifactDisplay(nodeId),
        tree: computeInventoryTree(nodeId, recipeDag.value, playerInventory.value),
      }))
    );

    const solutionViews = computed(() =>
      computedResults.value.map(solution => {
        // Iterate solution.perTarget, never the live artifactIds: the solution
        // is stale between a selection change and the next completed solve.
        const targets: TargetView[] = solution.perTarget.map(perTarget => {
          const nodeId = perTarget.nodeId;
          const display = artifactDisplay(nodeId);
          return {
            nodeId,
            name: display.name,
            iconUrl: display.iconUrl,
            perTarget,
            pCraft: legendaryCraftProbabilityOf(solution, nodeId),
            lambda: lambdaFromDropProbability(perTarget.dropProbability),
            craftChainTree: computeCraftChainTree(solution, nodeId, playerInventory.value),
            missionLegendarySources: computeMissionLegendaryRows(solution, nodeId),
            dropDataIsSparse: legendaryDataIsSparse(nodeId),
          };
        });
        return { solution, targets, planCost: computePlanCraftingCost(solution, playerInventory.value) };
      })
    );

    const dimSolution = computed(() => computing.value && solutionViews.value.length > 0);

    return {
      waitTimeDays,
      setWaitTimeDays,
      dimSolution,
      lastComputedMaxWaitTimeSeconds,
      timeBudgetValid,
      pendingCompute,
      computing,
      computeError,
      playerId,
      runCompute,
      submitPlayerId,
      playerInventory,
      playerGoldenEggs,
      inventoryTrees,
      solutionViews,
    };
  },
});
</script>
