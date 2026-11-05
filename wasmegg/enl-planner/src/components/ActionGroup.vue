<template>
  <div class="border-l-4 transition-all duration-300" :class="groupClasses">
    <!-- Collapsible header -->
    <button
      class="w-full flex items-center justify-between gap-4 hover:bg-white/50 transition-colors"
      :class="compact ? 'px-3 py-1' : 'px-3 sm:px-5 py-2 sm:py-3'"
      @click="toggleExpanded"
    >
      <!-- Left Side: Expand, Icon + headerText, Time Info -->
      <div class="flex items-center min-w-0" :class="compact ? 'gap-2' : 'gap-3 sm:gap-4'">
        <!-- Expand/collapse icon -->
        <svg
          class="w-4 h-4 text-slate-400 transition-transform duration-300 flex-shrink-0"
          :class="{ 'rotate-90 text-slate-900': isExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
        <!-- Egg icon -->
        <div
          class="flex-shrink-0 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden grid place-items-center"
          :class="compact ? 'w-6 h-6 p-0.5' : 'w-7 h-7 sm:w-8 sm:h-8 p-1'"
        >
          <img :src="iconURL('egginc/egg_enlightenment.png', 64)" class="w-full h-full object-contain" alt="Enlightenment" />
        </div>

        <!-- Time info -->
        <div class="text-left shrink-0">
          <div
            class="text-[9px] sm:text-[10px] font-black text-slate-700 tracking-widest leading-none"
            :class="compact ? 'mb-0.5' : 'mb-1'"
          >
            {{ formattedTimestamp }}
          </div>
          <div class="flex flex-col items-start gap-0.5">
            <div class="text-[9px] sm:text-[10px] font-bold text-slate-400 tracking-tight">Time: {{ formattedTimeElapsed }}</div>
            <div class="text-[9px] sm:text-[10px] font-black text-slate-900 tracking-widest">
              {{ formatNumber(finalPopulation, 3) }} Chickens
            </div>
          </div>
        </div>
      </div>

      <!-- Right Side: Metrics, Actions -->
      <div class="flex flex-col items-end shrink-0" :class="compact ? 'gap-1' : 'gap-1.5'">
        <div class="flex items-center gap-3">
          <!-- Reconciliation Status -->
          <div v-if="actionsStore.isReconciling" class="shrink-0">
            <div v-if="groupReconciliationStatus === 'completed'" class="text-emerald-500" v-tippy="'All actions complete.'">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
            </div>
            <div v-else-if="groupReconciliationStatus === 'pending'" class="text-amber-500 animate-pulse" v-tippy="'Some actions pending.'">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </button>

    <!-- Expanded content (action details) -->
    <div v-if="isExpanded" class="border-t border-slate-300">
      <div ref="scrollContainer" class="max-h-[400px] overflow-y-auto bg-white">
        <!-- Compact multi-day shift: consolidate each calendar day behind its own summary -->
        <template v-if="useDayGrouping">
          <DayGroup
            v-for="day in dayGroups"
            :key="day.key"
            :label="day.label"
            :actions="day.actions"
            :total-cost="day.totalCost"
            :expanded="expandedDayKeys.has(day.key)"
            @update:expanded="value => setDayExpanded(day.key, value)"
            @undo="handleDayUndo"
          />
        </template>

        <!-- Action list -->
        <template v-else>
          <ActionHistoryItem
            v-for="(action, idx) in actions"
            :key="action.id"
            :action="action"
            :compact="compact"
            @undo="handleUndo($event, action)"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { iconURL } from 'lib';
import { useActionsStore } from '@/stores/actions';
import { usePlanStore } from '@/stores/plan';
import type { Action } from '@/types';
import { formatNumber, formatDuration } from '@/lib/format';
import ActionHistoryItem from './ActionHistoryItem.vue';
import DayGroup from './DayGroup.vue';

const props = defineProps<{
  headerAction: Action<'start_ascension'>;
  actions: Action[];
  timeElapsedSeconds: number;
  periodTimestamp: Date;
  compact?: boolean;
}>();

const emit = defineEmits<{
  undo: [action: Action, options: { skipConfirmation: boolean }];
}>();

const actionsStore = useActionsStore();
const planStore = usePlanStore();

const isExpanded = computed(() => actionsStore.expandedGroupIds.has(props.headerAction.id));

const scrollContainer = ref<HTMLElement | null>(null);

// Scroll to bottom when actions are added and we are expanded
watch(
  () => props.actions.length,
  async (newLen, oldLen) => {
    if (isExpanded.value && newLen > oldLen) {
      await nextTick();
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
      }
    }
  }
);

function toggleExpanded() {
  actionsStore.toggleGroupExpansion(props.headerAction.id);
}

const groupClasses = 'border-brand-primary bg-slate-200 shadow-sm';

const finalPopulation = computed(() => (props.actions.at(-1) ?? props.headerAction).endState.population);

const groupReconciliationStatus = computed(() => actionsStore.getGroupReconciliationStatus(props.actions));

/**
 * Format the period timestamp as "Mon Jan 5, 2:30 PM"
 */
const formattedTimestamp = computed(() => {
  const date = props.periodTimestamp;
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
});

/**
 * Format the time elapsed in a human-readable way.
 */
const formattedTimeElapsed = computed(() => {
  return formatDuration(props.timeElapsedSeconds);
});

// getPreviousOfflineEarnings removed

function handleUndo(event: MouseEvent | { skipConfirmation: boolean }, action: Action) {
  const skipConfirmation = 'shiftKey' in event ? event.shiftKey : event.skipConfirmation;
  emit('undo', action, { skipConfirmation });
}

function handleDayUndo(action: Action, options: { skipConfirmation: boolean }) {
  handleUndo(options, action);
}

/**
 * The absolute (real-world) time an action ended, same formula ActionHistoryItem uses for its
 * hover tooltip — anchors the plan's simulated time to the plan's actual start time.
 */
function actionAbsoluteTime(action: Action): Date {
  const startTime = planStore.planStartTime.getTime();
  const offset = actionsStore.planStartOffset;
  const simTime = action.endState.lastStepTime || 0;
  // `Math.round`, not a bare `new Date(...)` — see `secondsToDate`'s doc comment (lib/format.ts):
  // `simTime` routinely lands a sub-microsecond residue short of a whole second even when it's
  // "really" exactly on a boundary, and `new Date` truncates rather than rounds.
  return new Date(Math.round(startTime + (simTime - offset) * 1000));
}

function formatDayLabel(date: Date, dayNumber: number): string {
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `Day ${dayNumber} · ${dateStr}`;
}

function formatDayRangeLabel(startDate: Date, endDate: Date, startDayNumber: number, endDayNumber: number): string {
  const startStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `Days ${startDayNumber}–${endDayNumber} · ${startStr} – ${endStr}`;
}

interface DayGroupItem {
  key: string;
  label: string;
  actions: Action[];
  totalCost: number;
}

/**
 * Buckets this period's actions by calendar day (in the viewer's local timezone), then merges
 * consecutive research-free days into a single combined group — e.g. a week spent only waiting
 * for events collapses to one "Days 4-10" header instead of seven near-empty single-day ones.
 * Any day with at least one research purchase stays its own standalone group.
 */
const dayGroups = computed<DayGroupItem[]>(() => {
  interface DailyBucket {
    date: Date;
    actions: Action[];
    researchBuyCount: number;
    totalCost: number;
  }

  // Pass 1: one bucket per calendar day.
  const dailyBuckets: DailyBucket[] = [];
  let currentDayKey = '';

  for (const action of props.actions) {
    const date = actionAbsoluteTime(action);
    const dayKey = date.toDateString();
    if (dayKey !== currentDayKey) {
      currentDayKey = dayKey;
      dailyBuckets.push({
        date,
        actions: [],
        researchBuyCount: 0,
        totalCost: 0,
      });
    }
    const bucket = dailyBuckets[dailyBuckets.length - 1];
    bucket.actions.push(action);
    bucket.totalCost += Math.max(action.cost || 0, 0);
    if (action.type === 'buy_research') {
      bucket.researchBuyCount++;
    }
  }

  // Pass 2: merge consecutive research-free days into one combined group each.
  const groups: DayGroupItem[] = [];
  let dayNumber = 1;
  let i = 0;
  while (i < dailyBuckets.length) {
    let runEnd = i;
    if (dailyBuckets[i].researchBuyCount === 0) {
      while (runEnd + 1 < dailyBuckets.length && dailyBuckets[runEnd + 1].researchBuyCount === 0) {
        runEnd++;
      }
    }

    const run = dailyBuckets.slice(i, runEnd + 1);
    const startDayNumber = dayNumber;
    const endDayNumber = dayNumber + run.length - 1;
    const label =
      run.length === 1
        ? formatDayLabel(run[0].date, startDayNumber)
        : formatDayRangeLabel(run[0].date, run[run.length - 1].date, startDayNumber, endDayNumber);

    const actions = run.flatMap(bucket => bucket.actions);

    groups.push({
      key: run[0].date.toDateString(),
      label,
      actions,
      totalCost: run.reduce((sum, bucket) => sum + bucket.totalCost, 0),
    });

    dayNumber = endDayNumber + 1;
    i = runEnd + 1;
  }

  return groups;
});

/**
 * Only worth consolidating by day once compact mode is on and the period actually spans more
 * than one calendar day — otherwise a single day-group would just add a redundant layer.
 */
const useDayGrouping = computed(() => !!props.compact && dayGroups.value.length > 1);

// Which days (by DayGroupItem.key) are currently expanded. Owned here — rather than as local
// state inside each DayGroup.
const expandedDayKeys = ref(new Set<string>());

function setDayExpanded(key: string, value: boolean) {
  if (value) {
    expandedDayKeys.value.add(key);
  } else {
    expandedDayKeys.value.delete(key);
  }
}
</script>
