<template>
  <div class="space-y-1 text-sm">
    <div v-if="multi" class="text-lg font-semibold text-green-700">
      <span v-tippy="jointTooltip" class="cursor-help border-b border-dotted border-green-400/60">
        Joint chance of getting all {{ rows.length }} artifacts
      </span>
      : {{ (solution.jointProbability * 100).toFixed(2) }}%
    </div>

    <div
      v-for="row in rows"
      :key="'target-' + row.nodeId"
      :class="multi ? 'mt-2 pl-2 border-l-2 border-green-100' : ''"
    >
      <div v-if="multi" class="flex items-center gap-1.5 font-medium text-gray-700">
        <img :src="row.iconUrl" class="h-4 w-4 flex-shrink-0" alt="" />
        <span>{{ row.name }}</span>
      </div>
      <div :class="multi ? 'text-sm text-green-700 pl-3' : 'text-lg font-semibold text-green-700'">
        <span v-tippy="chanceTooltip" class="cursor-help border-b border-dotted border-green-400/60">
          Chance of a legendary
        </span>
        : {{ (row.perTarget.bestProbability * 100).toFixed(2) }}%<sup
          v-if="row.dropDataIsSparse"
          v-tippy="sparseTooltip"
          class="text-gray-500 cursor-help ml-0.5"
          >?</sup
        >
      </div>
      <div class="text-sm text-green-700" :class="multi ? 'pl-6' : 'pl-3'">
        <span v-tippy="craftTooltip" class="cursor-help border-b border-dotted border-green-400/60">…via crafting</span>
        : {{ (row.perTarget.craftProbability * 100).toFixed(2) }}%
      </div>
      <div class="text-sm text-green-700" :class="multi ? 'pl-6' : 'pl-3'">
        <span v-tippy="dropTooltip" class="cursor-help border-b border-dotted border-green-400/60"
          >…via direct drops</span
        >
        : {{ (row.perTarget.dropProbability * 100).toFixed(2) }}%<sup
          v-if="row.dropDataIsSparse"
          v-tippy="sparseTooltip"
          class="text-gray-500 cursor-help ml-0.5"
          >?</sup
        >
      </div>
      <div class="text-gray-600" :class="multi ? 'pl-3' : ''">
        Expected crafts: {{ row.perTarget.expectedCrafts.toFixed(1) }}
      </div>
    </div>

    <div class="text-gray-600 pt-1">Fuel used: {{ formatEIValue(solution.fuelUsed, { trim: true }) }} Eggs</div>

    <ul>
      <li v-for="[egg, qty] of solution.fuelByEgg.entries()" :key="'egg-' + egg" class="text-gray-600">
        {{ formatEIValue(qty, { trim: true }) }}
        <base-icon :icon-rel-path="eggIconPath(egg)" :size="64" class="inline-block -ml-0.5 h-4 w-4"></base-icon>
      </li>
    </ul>
    <div class="text-gray-600">Ships in flight: {{ formatDuration(solution.runningTimeSeconds, true) }}</div>
    <div v-if="idleTimeSeconds > 0" class="text-gray-600">
      <span v-tippy="idleTooltip" class="cursor-help border-b border-dotted border-gray-400/60">Idle</span>
      : {{ formatDuration(idleTimeSeconds, true) }}
    </div>
    <div class="text-xs font-medium text-gray-500 uppercase tracking-wide mt-3">Launch plan</div>
    <optimizer-choice-list :choices="solution.choiceHistory" />

    <optimizer-expected-drops :drops="solution.expectedDrops" />

    <optimizer-probability-breakdown
      v-for="row in rows"
      :key="'breakdown-' + row.nodeId"
      :heading="multi ? row.name : ''"
      :best-probability="row.perTarget.bestProbability"
      :craft-probability="row.perTarget.craftProbability"
      :drop-probability="row.perTarget.dropProbability"
      :expected-crafts="row.perTarget.expectedCrafts"
      :p-craft="row.pCraft"
      :lambda="row.lambda"
      :craft-chain-tree="row.craftChainTree"
      :mission-legendary-sources="row.missionLegendarySources"
      :has-inventory="hasInventory"
    />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, PropType } from 'vue';

import { eggIconPath, formatDuration, formatEIValue } from 'lib';
import type { OptimizerSolution, TargetView } from '@/lib';
import BaseIcon from 'ui/components/BaseIcon.vue';
import OptimizerChoiceList from './OptimizerChoiceList.vue';
import OptimizerExpectedDrops from './OptimizerExpectedDrops.vue';
import OptimizerProbabilityBreakdown from './OptimizerProbabilityBreakdown.vue';

export default defineComponent({
  components: { BaseIcon, OptimizerChoiceList, OptimizerExpectedDrops, OptimizerProbabilityBreakdown },
  props: {
    solution: { type: Object as PropType<OptimizerSolution>, required: true },
    maxWaitTimeSeconds: { type: Number, required: true },
    hasInventory: { type: Boolean, required: true },
    targets: { type: Array as PropType<TargetView[]>, required: true },
  },
  setup(props) {
    // One row per target for any count. `targets` can be empty, in which case the solution's own top-level
    // fields (which mirror `perTarget[0]`) stand in for the single row.
    const rows = computed<TargetView[]>(() =>
      props.targets.length > 0
        ? props.targets
        : [
            {
              nodeId: '',
              name: '',
              iconUrl: '',
              pCraft: 0,
              lambda: 0,
              craftChainTree: null,
              missionLegendarySources: [],
              dropDataIsSparse: false,
              perTarget: {
                nodeId: '',
                bestProbability: props.solution.bestProbability,
                craftProbability: props.solution.craftProbability,
                dropProbability: props.solution.dropProbability,
                expectedCrafts: props.solution.expectedCrafts,
              },
            },
          ]
    );
    const multi = computed(() => rows.value.length > 1);
    const sparseTooltip =
      'Drop data is sparse: no mission has 5+ recorded legendary observations of this artifact, so the displayed rate may be off by several multiples.';
    const chanceTooltip =
      'Probability of at least one legendary of this artifact from this ship set, via crafting or a direct drop.';
    const jointTooltip = 'The probability of ending up with at least one legendary of every selected artifact.';
    const craftTooltip =
      'Probability of crafting at least one legendary from the gathered ingredients (plus anything already in your inventory).';
    const dropTooltip = 'Probability of at least one legendary dropping directly from the missions.';
    const idleTooltip =
      'Budget time with no ships in flight — gaps between launches (per your effort setting) plus unused budget at the end. Ships in flight + idle = your max wait time.';
    const idleTimeSeconds = computed(() =>
      Math.max(0, Math.round(props.maxWaitTimeSeconds) - props.solution.runningTimeSeconds)
    );
    return {
      eggIconPath,
      formatDuration,
      formatEIValue,
      sparseTooltip,
      chanceTooltip,
      jointTooltip,
      craftTooltip,
      dropTooltip,
      idleTooltip,
      idleTimeSeconds,
      rows,
      multi,
    };
  },
});
</script>
