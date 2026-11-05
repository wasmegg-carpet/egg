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
        <!-- Individual action (current work after last shift) -->
        <ActionHistoryItem
          v-if="item.type === 'single'"
          :action="item.action"
          :compact="compactActionHistory"
          @undo="handleUndoRequest(item.action, $event)"
        />

        <!-- Grouped actions (start or shift period) -->
        <ActionGroup
          v-else-if="item.type === 'group'"
          :header-action="item.headerAction"
          :actions="item.actions"
          :time-elapsed-seconds="item.timeElapsedSeconds"
          :period-timestamp="item.periodTimestamp"
          :eggs-delivered="item.eggsDelivered"
          :visit-count="item.visitCount"
          :is-editing="actionsStore.editingGroupId === item.headerAction.id"
          :is-current="item.isCurrent"
          :compact="compactActionHistory"
          @undo="handleUndoRequest"
          @start-editing="handleStartEditing"
          @stop-editing="handleStopEditing"
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
import type { Action, StoreFuelPayload, WaitForTEPayload, LaunchMissionsPayload } from '@/types';
import { useActionsStore } from '@/stores/actions';
import { useVirtueStore } from '@/stores/virtue';
import { formatNumber, formatGemPrice } from '@/lib/format';
import { compactActionHistory } from '@/composables/useCompactActionHistory';
import ActionHistoryItem from './ActionHistoryItem.vue';
import ActionGroup from './ActionGroup.vue';

const emit = defineEmits<{
  undo: [action: Action, options?: { skipConfirmation: boolean }];
  'clear-all': [options?: { skipConfirmation: boolean }];
}>();

const actionsStore = useActionsStore();
const virtueStore = useVirtueStore();

const actions = computed(() => actionsStore.actions);
const totalCost = computed(() => actionsStore.totalCost);
const actionCount = computed(() => actionsStore.actionCount);
const hasStartAction = computed(() => actionsStore.hasStartAction);

/**
 * Get the ascension start time as a Date object.
 */
const ascensionStartTime = computed(() => {
  const { ascensionDate, ascensionTime } = virtueStore;

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
 * Represents a group of actions collapsed under a header (start_ascension or shift).
 */
interface GroupItem {
  type: 'group';
  key: string;
  headerAction: Action<'start_ascension'> | Action<'shift'>;
  actions: Action[]; // Actions AFTER the header, until next shift
  timeElapsedSeconds: number;
  periodTimestamp: Date; // When this period started
  eggsDelivered: number; // Total eggs delivered during this period (for the current egg)
  visitCount: number; // Which visit number this is for the egg (1st, 2nd, etc.)
  isCurrent: boolean; // Whether this is the current (last) period
}

type GroupedItem = SingleItem | GroupItem;

// getActionTimeSeconds removed, usage replaced by action.totalTimeSeconds

/**
 * Group actions by periods.
 *
 * Logic:
 * - start_ascension + actions AFTER it (until first shift) = first group
 * - Each shift + actions AFTER it (until next shift) = subsequent groups
 * - Actions after the last shift (current work) are shown individually
 */
const groupedActions = computed<GroupedItem[]>(() => {
  const result: GroupedItem[] = [];
  const allActions = actions.value;

  const visitCounts: Record<string, number> = {
    curiosity: 0,
    integrity: 0,
    humility: 0,
    resilience: 0,
    kindness: 0,
  };

  // Find all shift indices
  const shiftIndices: number[] = [];
  allActions.forEach((action, idx) => {
    if (action.type === 'shift') {
      shiftIndices.push(idx);
    }
  });

  let cumulativeTimeSeconds = 0;

  // Handle start_ascension
  if (allActions[0]?.type === 'start_ascension') {
    const startAction = allActions[0] as Action<'start_ascension'>;

    if (shiftIndices.length > 0) {
      // There are shifts - group start_ascension with actions until first shift
      const firstShiftIdx = shiftIndices[0];
      // Actions between start_ascension (exclusive) and first shift (exclusive)
      const groupActions = allActions.slice(1, firstShiftIdx);

      // Calculate time elapsed in this period
      let periodTimeSeconds = 0;
      groupActions.forEach(action => {
        periodTimeSeconds += action.totalTimeSeconds || 0;
      });

      // Add the duration of the shift that ENDS this period
      const firstShift = allActions[firstShiftIdx] as Action<'shift'>;
      periodTimeSeconds += firstShift.totalTimeSeconds || 0;

      visitCounts[startAction.payload.initialEgg]++;

      result.push({
        type: 'group',
        key: `group_start`,
        headerAction: startAction,
        actions: groupActions,
        timeElapsedSeconds: periodTimeSeconds,
        periodTimestamp: ascensionStartTime.value,
        eggsDelivered: computePeriodEggsDelivered(startAction, groupActions),
        visitCount: visitCounts[startAction.payload.initialEgg],
        isCurrent: false,
      });

      cumulativeTimeSeconds = periodTimeSeconds;
    } else {
      // No shifts yet - show start_ascension as a group (current period)
      const groupActions = allActions.slice(1);
      let periodTimeSeconds = 0;
      groupActions.forEach(action => {
        periodTimeSeconds += action.totalTimeSeconds || 0;
      });

      visitCounts[startAction.payload.initialEgg]++;

      result.push({
        type: 'group',
        key: `group_start`,
        headerAction: startAction,
        actions: groupActions,
        timeElapsedSeconds: periodTimeSeconds,
        periodTimestamp: ascensionStartTime.value,
        eggsDelivered: computePeriodEggsDelivered(startAction, groupActions),
        visitCount: visitCounts[startAction.payload.initialEgg],
        isCurrent: true,
      });
      return result;
    }
  }

  // Process each shift period
  for (let i = 0; i < shiftIndices.length; i++) {
    const shiftIdx = shiftIndices[i];
    const nextShiftIdx = shiftIndices[i + 1];
    const shiftAction = allActions[shiftIdx] as Action<'shift'>;
    const isLastShift = nextShiftIdx === undefined;

    // Actions AFTER this shift, until next shift (or end of list)
    const endIdx = isLastShift ? allActions.length : nextShiftIdx;
    const groupActions = allActions.slice(shiftIdx + 1, endIdx);

    // Calculate time elapsed in this period
    let periodTimeSeconds = 0;
    groupActions.forEach(action => {
      periodTimeSeconds += action.totalTimeSeconds || 0;
    });

    // Add the duration of the next shift that ENDS this period
    if (nextShiftIdx !== undefined) {
      const nextShiftAction = allActions[nextShiftIdx] as Action<'shift'>;
      periodTimeSeconds += nextShiftAction.totalTimeSeconds || 0;
    }

    visitCounts[shiftAction.payload.toEgg]++;

    result.push({
      type: 'group',
      key: `group_${shiftAction.id}`,
      headerAction: shiftAction,
      actions: groupActions,
      timeElapsedSeconds: periodTimeSeconds,
      // `Math.round`, not a bare `new Date(...)` — see `secondsToDate`'s doc comment (lib/format.ts):
      // `cumulativeTimeSeconds` routinely lands a sub-microsecond residue short of a whole second.
      periodTimestamp: new Date(Math.round(ascensionStartTime.value.getTime() + cumulativeTimeSeconds * 1000)),
      eggsDelivered: computePeriodEggsDelivered(shiftAction, groupActions),
      visitCount: visitCounts[shiftAction.payload.toEgg],
      isCurrent: isLastShift,
    });

    cumulativeTimeSeconds += periodTimeSeconds;
  }

  return result;
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
        const shiftStatus = actionsStore.getShiftReconciliationStatus(group.actions);

        // If all internal actions of the shift are completed, hide it.
        if (shiftStatus === 'completed') return null;

        // Filter actions to show only incomplete/NA
        const filteredActions = group.actions.filter(a => {
          const status = actionsStore.getActionReconciliationStatus(a);
          return status !== 'completed';
        });

        // Recalculate time for only incomplete items in this period.
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

function handleStartEditing(groupId: string) {
  actionsStore.setEditingGroup(groupId);
}

function handleStopEditing() {
  actionsStore.setEditingGroup(null);
}

/**
 * Calculate eggs delivered during a period.
 * Uses the delta of eggsDelivered[egg] between the header action and the last action in the group.
 */
function computePeriodEggsDelivered(
  headerAction: Action<'start_ascension'> | Action<'shift'>,
  groupActions: Action[]
): number {
  const egg = headerAction.endState.currentEgg;
  const startDelivered = headerAction.endState.eggsDelivered[egg] || 0;
  const lastAction = groupActions.length > 0 ? groupActions[groupActions.length - 1] : null;
  const endDelivered = lastAction ? lastAction.endState.eggsDelivered[egg] || 0 : startDelivered;
  return Math.max(0, endDelivered - startDelivered);
}

// getPreviousOfflineEarnings removed
</script>
