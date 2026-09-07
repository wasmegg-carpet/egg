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

        <!-- Egg icon + headerText -->
        <div class="flex flex-col items-center gap-0.5">
          <span class="text-[17px] font-black text-slate-800 uppercase tracking-tighter leading-none">{{ headerText }}</span>
          <div
            class="flex-shrink-0 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden group-hover:scale-110 transition-transform"
            :class="compact ? 'w-6 h-6 p-0.5' : 'w-7 h-7 sm:w-8 sm:h-8 p-1'"
          >
            <img
              :src="iconURL(`egginc/egg_${currentEgg}.png`, 64)"
              class="w-full h-full object-contain"
              :alt="currentEgg"
            />
          </div>
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
              {{ formatNumber(props.eggsDelivered, 3) }} Eggs
            </div>
          </div>
        </div>
      </div>

      <!-- Right Side: Metrics, Actions -->
      <div class="flex flex-col items-end shrink-0" :class="compact ? 'gap-1' : 'gap-1.5'">
        <div class="flex items-center gap-3">
          <!-- Shift info -->
          <div v-if="isShiftAction && headerAction.cost > 0" class="flex items-center gap-1 opacity-80">
            <span class="text-[9px] sm:text-[10px] font-bold text-slate-700 font-mono-premium">
              {{ formatNumber(headerAction.cost, 3) }}
            </span>
            <img :src="iconURL('egginc/egg_soul.png', 32)" class="w-3.5 h-3.5" alt="SE" />
          </div>

          <!-- Reconciliation Status -->
          <div v-if="actionsStore.isReconciling" class="shrink-0">
            <div v-if="shiftReconciliationStatus === 'completed'" class="text-emerald-500" v-tippy="'All actions complete.'">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
            </div>
            <div v-else-if="shiftReconciliationStatus === 'pending'" class="text-amber-500 animate-pulse" v-tippy="'Some actions pending.'">
              <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        <!-- Editor/Undo Actions -->
        <div class="flex items-center gap-1 sm:gap-2" @click.stop>
          <button
            v-if="!isEditing && !(isCurrent && !actionsStore.editingGroupId)"
            class="text-slate-400 hover:text-slate-900 hover:bg-brand-primary/5 rounded-xl transition-all active:scale-95"
            :class="compact ? 'p-1' : 'p-1.5 sm:p-2'"
            v-tippy="'Edit this shift'"
            @click="$emit('start-editing', headerAction.id)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>

          <button
            v-if="isEditing"
            class="p-1 px-3 bg-brand-primary text-white rounded-xl shadow-lg shadow-brand-primary/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5 border border-brand-primary/20"
            v-tippy="'Finish editing'"
            @click="$emit('stop-editing')"
          >
            <span class="text-[9px] font-black uppercase tracking-widest">Done</span>
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
            </svg>
          </button>

          <button
            v-if="isShiftAction"
            class="text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all active:scale-95"
            :class="compact ? 'p-1' : 'p-1.5 sm:p-2'"
            v-tippy="'Undo this shift and all its actions'"
            @click="handleUndo($event, headerAction)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
        </div>
      </div>
    </button>

    <!-- Expanded content (summary + action details) -->
    <div v-if="isExpanded" class="border-t border-slate-300">
      <!-- Egg Summary (for the egg we were ON during this period) -->
      <component
        :is="summaryComponent"
        :header-action="headerAction"
        :actions="actions"
        :compact="compact"
        @scroll-to-action="handleScrollToAction"
      />

      <div ref="scrollContainer" class="max-h-[400px] overflow-y-auto bg-white">
        <!-- Compact multi-day shift: consolidate each calendar day behind its own summary -->
        <template v-if="useDayGrouping">
          <DayGroup
            v-for="day in dayGroups"
            :key="day.key"
            :label="day.label"
            :actions="day.actions"
            :summary-header-action="day.summaryHeaderAction"
            :summary-component="summaryComponent"
            :total-cost="day.totalCost"
            :eggs-delivered="day.eggsDelivered"
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
import { useVirtueStore } from '@/stores/virtue';
import type { Action, VirtueEgg, StartAscensionPayload, ShiftPayload } from '@/types';
import { VIRTUE_EGG_NAMES } from '@/types';
import { formatNumber, formatDuration } from '@/lib/format';
import { safeAsyncComponent } from '@/lib/import';
import { scrollToAndHighlight } from '@/lib/scrollToAndHighlight';
import ActionHistoryItem from './ActionHistoryItem.vue';
import DayGroup from './DayGroup.vue';

// Lazy load summary components
const CuriositySummary = safeAsyncComponent(() => import('./summaries/CuriositySummary.vue'));
const IntegritySummary = safeAsyncComponent(() => import('./summaries/IntegritySummary.vue'));
const HumilitySummary = safeAsyncComponent(() => import('./summaries/HumilitySummary.vue'));
const ResilienceSummary = safeAsyncComponent(() => import('./summaries/ResilienceSummary.vue'));
const KindnessSummary = safeAsyncComponent(() => import('./summaries/KindnessSummary.vue'));

const summaryComponents: Record<VirtueEgg, any> = {
  curiosity: CuriositySummary,
  integrity: IntegritySummary,
  humility: HumilitySummary,
  resilience: ResilienceSummary,
  kindness: KindnessSummary,
};
``
const props = defineProps<{
  headerAction: Action<'start_ascension'> | Action<'shift'>;
  actions: Action[];
  timeElapsedSeconds: number;
  periodTimestamp: Date;
  eggsDelivered: number;
  isEditing?: boolean;
  isCurrent?: boolean; // Whether this is the current (last) period
  visitCount?: number;
  compact?: boolean;
}>();

const emit = defineEmits<{
  undo: [action: Action, options: { skipConfirmation: boolean }];
  'start-editing': [groupId: string];
  'stop-editing': [];
}>();

const actionsStore = useActionsStore();
const virtueStore = useVirtueStore();

// Internal state for manually collapsing/expanding the current group
// This is now managed by the store, but we keep the ref if needed for transition (actually we can remove it)

/**
 * Determine if the group should be expanded.
 * - If editing this group: expanded
 * - If force collapsed (another group being edited): collapsed
 * - If current period: expanded by default, but can be manually collapsed
 * - Otherwise: collapsed
 */
const isExpanded = computed(() => {
  if (props.isEditing) return true;
  return actionsStore.expandedGroupIds.has(props.headerAction.id);
});

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

/**
 * Whether the header is a shift action (vs start_ascension).
 */
const isShiftAction = computed(() => props.headerAction.type === 'shift');

const groupClasses = computed(() => {
  const isBeingEdited = props.isEditing || (props.isCurrent && !actionsStore.editingGroupId);
  if (isBeingEdited) {
    return 'border-brand-primary bg-slate-200 shadow-sm';
  }
  return 'border-slate-300 bg-slate-200';
});

/**
 * The egg we're ON during this period.
 * - For start_ascension: the initial egg
 * - For shift: the egg we shifted TO
 */
const currentEgg = computed<VirtueEgg>(() => {
  if (props.headerAction.type === 'start_ascension') {
    return (props.headerAction.payload as StartAscensionPayload).initialEgg;
  } else {
    return (props.headerAction.payload as ShiftPayload).toEgg;
  }
});

/**
 * The header text to display.
 */
const headerText = computed(() => {
  const name = VIRTUE_EGG_NAMES[currentEgg.value];
  const letter = name.charAt(0).toUpperCase();
  const count = props.visitCount || 1;
  return `${letter}${count}`;
});

/**
 * Get the appropriate summary component for the current egg.
 */
const summaryComponent = computed(() => summaryComponents[currentEgg.value]);

const shiftReconciliationStatus = computed(() => {
  return actionsStore.getShiftReconciliationStatus(props.actions);
});

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
 * hover tooltip — anchors the plan's simulated time to the ascension's actual start time.
 */
function actionAbsoluteTime(action: Action): Date {
  const startTime = virtueStore.planStartTime.getTime();
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
  summaryHeaderAction: Action;
  totalCost: number;
  eggsDelivered: number;
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
    summaryHeaderAction: Action;
    researchBuyCount: number;
    totalCost: number;
    startEggsDelivered: number;
  }

  // Pass 1: one bucket per calendar day.
  const dailyBuckets: DailyBucket[] = [];
  let prevAction: Action | null = null;
  let currentDayKey = '';

  for (const action of props.actions) {
    const date = actionAbsoluteTime(action);
    const dayKey = date.toDateString();
    if (dayKey !== currentDayKey) {
      currentDayKey = dayKey;
      const dayHeaderAction = prevAction ?? props.headerAction;
      dailyBuckets.push({
        date,
        actions: [],
        summaryHeaderAction: dayHeaderAction,
        researchBuyCount: 0,
        totalCost: 0,
        startEggsDelivered: dayHeaderAction.endState.eggsDelivered[currentEgg.value] || 0,
      });
    }
    const bucket = dailyBuckets[dailyBuckets.length - 1];
    bucket.actions.push(action);
    bucket.totalCost += Math.max(action.cost || 0, 0);
    if (action.type === 'buy_research') {
      bucket.researchBuyCount++;
    }
    prevAction = action;
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
    const endEggsDelivered = actions[actions.length - 1].endState.eggsDelivered[currentEgg.value] || 0;

    groups.push({
      key: run[0].date.toDateString(),
      label,
      actions,
      summaryHeaderAction: run[0].summaryHeaderAction,
      totalCost: run.reduce((sum, bucket) => sum + bucket.totalCost, 0),
      eggsDelivered: Math.max(0, endEggsDelivered - run[0].startEggsDelivered),
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
// state inside each DayGroup — so a curiosity summary link click (see handleScrollToAction) can
// force open whichever day contains its target action.
const expandedDayKeys = ref(new Set<string>());

function setDayExpanded(key: string, value: boolean) {
  if (value) {
    expandedDayKeys.value.add(key);
  } else {
    expandedDayKeys.value.delete(key);
  }
}

/**
 * Handles a curiosity summary link click whose target action wasn't found in the DOM — meaning
 * it's inside a collapsed day (compact view). Expand that day, wait for it to render, then scroll.
 */
async function handleScrollToAction(actionId: string) {
  const day = dayGroups.value.find(d => d.actions.some(a => a.id === actionId));
  if (day) {
    expandedDayKeys.value.add(day.key);
    await nextTick();
  }
  scrollToAndHighlight(actionId);
}
</script>
