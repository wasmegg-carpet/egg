<template>
  <div class="section-goals">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 class="text-lg font-semibold text-gray-800">Goals</h2>
      <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
        Time from the start of this plan
      </span>
    </div>
    <ul class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      <li
        v-for="goal in goals"
        :key="goal.id"
        v-tippy="goal.description"
        class="rounded-xl border px-3 py-2 text-center"
        :class="goal.reachedAfterSeconds === null ? 'border-slate-100 bg-slate-50' : 'border-emerald-100 bg-emerald-50'"
      >
        <div class="text-[10px] font-black uppercase tracking-widest text-slate-500">{{ goal.label }}</div>
        <div
          class="mt-1 text-xs font-mono-premium font-bold"
          :class="goal.reachedAfterSeconds === null ? 'text-slate-400' : 'text-emerald-700'"
        >
          {{ goal.reachedAfterSeconds === null ? 'Not reached' : formatDuration(goal.reachedAfterSeconds) }}
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useActionsStore } from '@/stores/actions';
import { computeGoalStatuses } from '@/calculations/goals';
import { formatDuration } from '@/lib/format';

const actionsStore = useActionsStore();

const goals = computed(() =>
  computeGoalStatuses(actionsStore.actions, actionsStore.initialSnapshot, actionsStore.planStartOffset)
);
</script>

<style scoped>
.section-goals {
  @apply bg-white rounded-3xl border border-slate-100 shadow-sm p-4;
}
</style>
