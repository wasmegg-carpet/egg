<template>
  <div class="space-y-4">
    <!-- Empty state (only show if no start_ascension exists) -->
    <div v-if="!hasStartAction" class="text-center py-12 bg-white rounded-2xl border border-slate-100 border-dashed">
      <div class="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg class="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      </div>
      <p class="text-[11px] font-bold text-slate-400 uppercase tracking-widest">No actions yet.</p>
    </div>

    <!-- Action list with grouping -->
    <div
      v-else
      class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm divide-y divide-slate-100"
    >
      <template v-for="(item, idx) in filteredGroupedActions" :key="item.key">
        <!-- Individual action -->
        <ActionHistoryItem
          v-if="item.type === 'single'"
          :action="item.action"
          :compact="compactActionHistory"
          @undo="handleUndoRequest(item.action, $event)"
        />

        <!-- The plan's actions, under its start -->
        <ActionGroup
          v-else-if="item.type === 'group'"
          :header-action="item.headerAction"
          :actions="item.actions"
          :time-elapsed-seconds="item.timeElapsedSeconds"
          :period-timestamp="item.periodTimestamp"
          :compact="compactActionHistory"
          @undo="handleUndoRequest"
        />
      </template>
    </div>

    <!-- Footer Actions -->
    <div v-if="actionCount > 0" class="flex justify-center pt-2">
      <button
        class="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest transition-colors py-2 px-4 rounded-xl hover:bg-red-50"
        @click="handleClearAll"
      >
        Clear All
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Action } from '@/types';
import { useActionsStore } from '@/stores/actions';
import { usePlanStore } from '@/stores/plan';
import { compactActionHistory } from '@/composables/useCompactActionHistory';
import ActionHistoryItem from './ActionHistoryItem.vue';
import ActionGroup from './ActionGroup.vue';

const emit = defineEmits<{
  undo: [action: Action, options?: { skipConfirmation: boolean }];
  'clear-all': [options?: { skipConfirmation: boolean }];
}>();

const actionsStore = useActionsStore();
const planStore = usePlanStore();

const actions = computed(() => actionsStore.actions);
const totalCost = computed(() => actionsStore.totalCost);
const actionCount = computed(() => actionsStore.actionCount);
const hasStartAction = computed(() => actionsStore.hasStartAction);

/**
 * Get the ascension start time as a Date object.
 */
const ascensionStartTime = computed(() => {
  const { ascensionDate, ascensionTime } = planStore;

  // Parse the date and time
  // Format: "YYYY-MM-DD HH:MM"
  const dateTimeStr = `${ascensionDate}T${ascensionTime}:00`;

  try {
    // Parse the date (assumes local timezone for simplicity)
    // A more robust solution would use a proper timezone library
    return new Date(dateTimeStr);
  } catch {
    return new Date();
  }
});

/**
 * Represents a single action displayed individually.
 */
interface SingleItem {
  type: 'single';
  key: string;
  action: Action;
}

/**
 * The plan's actions collapsed under its start action. A plan has no shifts, so there's only this one.
 */
interface GroupItem {
  type: 'group';
  key: string;
  headerAction: Action<'start_ascension'>;
  actions: Action[];
  timeElapsedSeconds: number;
  periodTimestamp: Date;
}

type GroupedItem = SingleItem | GroupItem;

const groupedActions = computed<GroupedItem[]>(() => {
  const [startAction, ...groupActions] = actions.value;
  if (startAction?.type !== 'start_ascension') return [];
  return [
    {
      type: 'group',
      key: 'group_start',
      headerAction: startAction,
      actions: groupActions,
      timeElapsedSeconds: groupActions.reduce((sum, action) => sum + (action.totalTimeSeconds || 0), 0),
      periodTimestamp: ascensionStartTime.value,
    },
  ];
});

/**
 * Apply "Incomplete Only" filtering to the grouped actions list.
 */
const filteredGroupedActions = computed<GroupedItem[]>(() => {
  const groups = groupedActions.value;
  if (!actionsStore.isReconciling || !actionsStore.showIncompleteOnly) return groups;

  return groups
    .map(group => {
      if (group.type === 'group') {
        // If all of the plan's actions are completed, hide it.
        if (actionsStore.getGroupReconciliationStatus(group.actions) === 'completed') return null;

        // Filter actions to show only incomplete/NA
        const filteredActions = group.actions.filter(a => {
          const status = actionsStore.getActionReconciliationStatus(a);
          return status !== 'completed';
        });

        // Recalculate time for only incomplete items.
        let incompleteTime = 0;
        for (const a of filteredActions) {
          incompleteTime += a.totalTimeSeconds || 0;
        }

        return {
          ...group,
          actions: filteredActions,
          timeElapsedSeconds: incompleteTime,
        };
      } else {
        const status = actionsStore.getActionReconciliationStatus(group.action);
        return status !== 'completed' ? group : null;
      }
    })
    .filter((g): g is GroupedItem => g !== null);
});

function handleUndoRequest(action: Action, options?: { skipConfirmation: boolean }) {
  emit('undo', action, options);
}

function handleClearAll(event: MouseEvent) {
  emit('clear-all', { skipConfirmation: event.shiftKey });
}
</script>
