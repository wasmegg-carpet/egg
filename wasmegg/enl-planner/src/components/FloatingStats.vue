<template>
  <div
    v-if="actionsStore.hasStartAction"
    class="fixed right-4 top-20 z-50 flex flex-col items-center card-glass p-1.5 shadow-2xl transition-all duration-300"
    :class="[isCollapsed ? 'w-12' : 'p-4 min-w-[140px]']"
  >
    <!-- Toggle Handler -->
    <button
      v-tippy="isCollapsed ? 'Expand Stats' : 'Collapse Stats'"
      class="w-full flex flex-col items-center group/toggle transition-colors"
      @click="isCollapsed = !isCollapsed"
    >
      <!-- Chevron Indicator -->
      <div class="text-slate-300 group-hover/toggle:text-slate-500 transition-colors mb-1">
        <svg
          class="w-4 h-4 transition-transform duration-300"
          :class="{ 'rotate-180': isCollapsed }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      <!-- Egg Icon -->
      <div
        class="bg-white/50 rounded-xl border border-slate-200/50 shadow-inner overflow-hidden transition-all duration-300"
        :class="[isCollapsed ? 'w-9 h-9 p-1' : 'w-12 h-12 p-1.5 mb-2 group-hover/toggle:scale-105']"
      >
        <img
          :src="iconURL(`egginc/egg_${currentEgg}.png`, 64)"
          class="w-full h-full object-contain"
          :alt="currentEgg"
        />
      </div>

      <!-- Shift Name -->
      <div v-if="!isCollapsed" class="text-lg font-bold text-slate-800 tracking-tight leading-none mb-1 shadow-sm">
        {{ shiftName }}
      </div>
    </button>

    <!-- Collapsible Content -->
    <div v-if="!isCollapsed" class="flex flex-col items-center w-full transition-all">
      <!-- Active Set Badge -->
      <div v-if="activeSet" class="badge-premium badge-brand py-0.5 mb-3 scale-90">
        {{ activeSet === 'earnings' ? 'Earnings' : 'Delivery Rate' }} Set
      </div>
      <div v-else class="badge-premium py-0.5 mb-3 scale-90 bg-slate-100 text-slate-500">No Active Set</div>

      <!-- Shift Timing & Duration -->
      <div
        v-if="dates"
        class="w-full bg-white/30 rounded-xl border border-white/40 p-2.5 mb-3 flex flex-col items-center shadow-inner"
      >
        <div class="text-[9px] font-black text-slate-900 uppercase tracking-widest text-center">
          {{ formatDateTime(dates.start) }}
        </div>
        <div class="text-xs font-mono-premium font-bold text-slate-900 my-1 tracking-tight">
          {{ formatShiftDuration(dates.duration) }}
        </div>
        <div class="text-[9px] font-black text-slate-900 uppercase tracking-widest text-center">
          {{ formatDateTime(dates.end) }}
        </div>
      </div>

      <!-- Stats Stack -->
      <div class="flex flex-col gap-2.5 w-full">
        <!-- Habs -->
        <div class="flex flex-col items-center">
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Habs</span>
          <span class="font-mono-premium text-[11px] font-bold text-slate-700">
            {{ habsDisplay }}
          </span>
        </div>

        <div class="w-full border-t border-slate-200/40"></div>

        <!-- IHR -->
        <div class="flex flex-col items-center">
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">IHR</span>
          <span class="font-mono-premium text-[11px] font-bold text-slate-700">
            {{ formatRate(offlineIhrHr) }}
          </span>
        </div>

        <div class="w-full border-t border-slate-200/40"></div>

        <!-- Lay Rate -->
        <div class="flex flex-col items-center">
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Lay Rate</span>
          <span class="font-mono-premium text-[11px] font-bold text-slate-700">
            {{ formatRate(layRateHr) }}
          </span>
        </div>

        <div class="w-full border-t border-slate-200/40"></div>

        <!-- Shipping -->
        <div class="flex flex-col items-center">
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Shipping</span>
          <span class="font-mono-premium text-[11px] font-bold text-slate-700">
            {{ formatRate(shippingHr) }}
          </span>
        </div>

        <div class="w-full border-t border-slate-200/40"></div>

        <!-- ELR -->
        <div class="flex flex-col items-center">
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Delivery</span>
          <span class="font-mono-premium text-[11px] font-bold text-slate-700">
            {{ formatRate(elrHr) }}
          </span>
        </div>

        <div class="w-full border-t border-slate-200/40"></div>

        <!-- Offline Earnings -->
        <div class="flex flex-col items-center">
          <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center leading-none mb-0.5"
            >Offline Earnings</span
          >
          <span class="font-mono-premium text-[11px] font-bold text-slate-700">
            {{ formatMoney(offlineEarningsHr) }}
          </span>
        </div>

        <div class="w-full border-t border-slate-200/40"></div>

        <!-- Bank -->
        <div class="flex flex-col items-center">
          <span
            class="flex items-center gap-1 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center leading-none mb-0.5"
          >
            Bank
            <button
              v-tippy="'Modify Bank Value'"
              class="text-slate-500 hover:text-slate-800 transition-colors"
              @click="showModifyBankModal = true"
            >
              <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </button>
          </span>
          <div class="flex items-center gap-1">
            <span class="font-mono-premium text-[11px] font-bold text-slate-700">
              {{ formatNumber(Math.max(0, snapshot.bankValue), 3) }}
            </span>
            <img :src="iconURL('egginc/icon_virtue_gem.png', 32)" class="w-3 h-3" alt="Gems" />
          </div>
        </div>
      </div>

    </div>
  </div>

  <ModifyBankModal :show="showModifyBankModal" @close="showModifyBankModal = false" />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useActionsStore } from '@/stores/actions';
import { useVirtueStore } from '@/stores/virtue';
import { iconURL } from 'lib';
import { formatNumber } from '@/lib/format';
import { VIRTUE_EGG_NAMES } from '@/types';
import type { VirtueEgg, Action, StartAscensionPayload, ShiftPayload } from '@/types';
import ModifyBankModal from './ModifyBankModal.vue';

const showModifyBankModal = ref(false);

const actionsStore = useActionsStore();
const virtueStore = useVirtueStore();

const isCollapsed = ref(typeof window !== 'undefined' ? window.innerWidth < 768 : false);

// Get the effective snapshot (state at the end of the edited/current shift)
const snapshot = computed(() => actionsStore.effectiveSnapshot);

// Basic properties from snapshot
const currentEgg = computed(() => snapshot.value.currentEgg);
const activeSet = computed(() => snapshot.value.activeArtifactSet);
const habCapacity = computed(() => snapshot.value.habCapacity);
const population = computed(() => snapshot.value.population);

const habsDisplay = computed(() => {
  const p = formatNumber(population.value, 3);
  const c = formatNumber(habCapacity.value, 3);
  return p === c ? c : `${p} / ${c}`;
});

const offlineIhrHr = computed(() => snapshot.value.offlineIHR * 60);

// Rates (assume per second based on types, converting to per hour)
const layRateHr = computed(() => snapshot.value.layRate * 3600);
const shippingHr = computed(() => snapshot.value.shippingCapacity * 3600);
const elrHr = computed(() => snapshot.value.elr * 3600);
const offlineEarningsHr = computed(() => snapshot.value.offlineEarnings * 3600);

// Logic: Shipping is limiting if Lay Rate > Shipping Capacity
const isShippingLimited = computed(() => snapshot.value.layRate > snapshot.value.shippingCapacity);

/**
 * Format large numbers with units (e.g. 1.23q/hr)
 */
function formatRate(rate: number): string {
  return `${formatNumber(rate)}/hr`;
}

/**
 * Format money (e.g. $1.23q/hr)
 */
function formatMoney(amount: number): string {
  return `${formatNumber(amount)}/hr`;
}

/**
 * Calculate the shift name (e.g. C1, H2) for the current state.
 */
const shiftName = computed(() => {
  const egg = currentEgg.value;
  const eggName = VIRTUE_EGG_NAMES[egg];
  const letter = eggName.charAt(0).toUpperCase();

  // Find the 'header' action for the current group
  let headerAction: Action | undefined;

  if (actionsStore.editingGroupId) {
    headerAction = actionsStore.getAction(actionsStore.editingGroupId);
  } else {
    // If not editing, find the last group header in the entire list
    const actions = actionsStore.actions;
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i].type === 'shift' || actions[i].type === 'start_ascension') {
        headerAction = actions[i];
        break;
      }
    }
  }

  if (!headerAction) return `${letter}1`; // Fallback

  // Count how many times we visited this egg up to (and including) this header action
  // We iterate through all actions, counting visits to 'egg'
  // A visit starts at 'start_ascension' (if initialEgg matches) or 'shift' (if toEgg matches)
  let count = 0;
  for (const action of actionsStore.actions) {
    if (action.type === 'start_ascension') {
      const payload = action.payload as StartAscensionPayload;
      if (payload.initialEgg === egg) count++;
    } else if (action.type === 'shift') {
      const payload = action.payload as ShiftPayload;
      if (payload.toEgg === egg) count++;
    }

    // Stop when we reach our target header
    if (action.id === headerAction.id) break;
  }

  return `${letter}${count || 1}`;
});

/**
 * Calculate the timing and duration for the current shift.
 */
const dates = computed(() => {
  const startTime = virtueStore.planStartTime.getTime();
  const offset = actionsStore.planStartOffset;
  const actions = actionsStore.actions;

  // Find the 'header' action for the current group
  let headerIndex = -1;
  if (actionsStore.editingGroupId) {
    headerIndex = actions.findIndex(a => a.id === actionsStore.editingGroupId);
  } else {
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i].type === 'shift' || actions[i].type === 'start_ascension') {
        headerIndex = i;
        break;
      }
    }
  }

  if (headerIndex === -1) return null;

  const headerAction = actions[headerIndex];

  // Find the end of this shift
  const nextShiftIndex = actions.findIndex((a, idx) => idx > headerIndex && a.type === 'shift');
  const endActionIndex = nextShiftIndex === -1 ? actions.length - 1 : nextShiftIndex - 1;

  // Time before shift = header end simulation time - header duration - start offset
  const timeBeforeShift = (headerAction.endState.lastStepTime || 0) - (headerAction.totalTimeSeconds || 0) - offset;

  // Total duration of shift group = end action end simulation time - (header end sim time - header duration)
  const shiftGroupEndSimTime = actions[endActionIndex].endState.lastStepTime || 0;
  const shiftGroupStartSimTime = (headerAction.endState.lastStepTime || 0) - (headerAction.totalTimeSeconds || 0);
  const shiftDuration = shiftGroupEndSimTime - shiftGroupStartSimTime;

  const startMs = startTime + timeBeforeShift * 1000;
  const endMs = startMs + shiftDuration * 1000;

  // `Math.round`, not a bare `new Date(...)` — see `secondsToDate`'s doc comment (lib/format.ts):
  // these routinely land a sub-microsecond residue short of a whole second.
  return {
    start: new Date(Math.round(startMs)),
    end: new Date(Math.round(endMs)),
    duration: shiftDuration,
  };
});

/**
 * Format date/time as: Feb 7, 9:14 PM
 */
function formatDateTime(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  return date.toLocaleString('en-US', options);
}

/**
 * Format duration as: 12d22h or 5h30m
 */
function formatShiftDuration(seconds: number): string {
  if (seconds <= 0) return '0m';

  const totalMinutes = Math.floor(seconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  if (totalDays > 0) {
    return `${totalDays}d${hours}h`;
  }
  if (totalHours > 0) {
    return `${totalHours}h${minutes}m`;
  }
  return `${totalMinutes}m`;
}
</script>
