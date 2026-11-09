<template>
  <!-- Population -->
  <div class="summary-item">
    <span class="summary-label">Population</span>
    <span class="summary-value font-mono-premium font-black text-slate-600">{{ formatNumber(finalPopulation, 3) }}</span>
  </div>

  <!-- Next Goal -->
  <div class="summary-item">
    <span class="summary-label">Next Goal</span>
    <span class="summary-value text-slate-900">{{ nextGoalLabel }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useActionsStore } from '@/stores/actions';
import { computeGoalStatuses } from '@/calculations/goals';
import { formatNumber } from '@/lib/format';

const actionsStore = useActionsStore();

const finalPopulation = computed(() => actionsStore.currentSnapshot.population);

const nextGoalLabel = computed(() => {
  const goals = computeGoalStatuses(actionsStore.actions, actionsStore.initialSnapshot, actionsStore.planStartOffset);
  return goals.find(goal => goal.reachedAfterSeconds === null)?.label ?? 'All reached';
});
</script>
