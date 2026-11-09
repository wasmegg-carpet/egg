<template>
  <div class="space-y-6">
    <div class="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
      <div>
        <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3"> Duration </label>
        <div class="flex flex-col sm:flex-row gap-2">
          <input
            ref="inputEl"
            v-model="inputDuration"
            type="text"
            placeholder="e.g. 8h30m, 12:30pm, or +0"
            class="w-full sm:flex-1 px-4 py-2.5 text-sm font-mono-premium font-bold bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300 outline-none transition-all placeholder:text-slate-300"
            @keyup.enter="handleWaitTime"
          />
          <button
            class="btn-premium btn-primary w-full sm:w-auto px-6 py-2.5 text-xs flex-shrink-0"
            :disabled="!isValid"
            @click="handleWaitTime"
          >
            Add Wait
          </button>
        </div>
        <p class="mt-3 text-[10px] text-slate-400 font-medium leading-relaxed">
          Enter duration (e.g.
          <span class="font-mono-premium text-slate-600 bg-slate-100 px-1 py-0.5 rounded">8h</span> or
          <span class="font-mono-premium text-slate-600 bg-slate-100 px-1 py-0.5 rounded">1d12h</span>), clock time
          (e.g.
          <span class="font-mono-premium text-slate-600 bg-slate-100 px-1 py-0.5 rounded">12:30pm</span> or
          <span class="font-mono-premium text-slate-600 bg-slate-100 px-1 py-0.5 rounded">14:30</span>), or Egg Relative
          Time (e.g. 
          <span class="font-mono-premium text-slate-600 bg-slate-100 px-1 py-0.5 rounded">+0</span>,
          <span class="font-mono-premium text-slate-600 bg-slate-100 px-1 py-0.5 rounded">+2</span>, or
          <span class="font-mono-premium text-slate-600 bg-slate-100 px-1 py-0.5 rounded">-2</span>
          ).
        </p>
      </div>

      <div
        v-if="parsedSeconds > 0"
        class="mt-2 space-y-2 animate-in fade-in slide-in-from-top-2"
      >
        <!-- Duration Display -->
        <div class="p-4 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center transition-all">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Wait Duration:</span>
          <span class="text-sm font-mono-premium font-black text-slate-900">
            {{ formatDuration(parsedSeconds) }}
          </span>
        </div>

        <!-- End Date/Time Display -->
        <div class="p-4 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center transition-all">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Estimated End:</span>
          <div class="text-right">
            <div class="text-sm font-mono-premium font-black text-slate-900">
              {{ formatAbsoluteTime(parsedSeconds, baseTimestamp, virtueStore.ascensionTimezone) }}
            </div>
          </div>
        </div>

        <!-- Expected Gems Display -->
        <div class="p-4 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center transition-all">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Expected Gems:</span>
          <div class="flex items-center gap-2">
            <span class="text-sm font-mono-premium font-black text-slate-900">
              +{{ formatNumber(expectedGemsEarned, 3) }}
            </span>
            <img :src="iconURL('egginc/icon_virtue_gem.png', 64)" class="w-4 h-4 object-contain" alt="Gems" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { iconURL } from 'lib';
const inputEl = ref<HTMLInputElement | null>(null);
defineExpose({ focus: () => inputEl.value?.focus() });
import { useActionsStore } from '@/stores/actions';
import { useVirtueStore } from '@/stores/virtue';
import { formatDuration, parseDuration, formatAbsoluteTime, formatNumber } from '@/lib/format';
import { boostTransitionsFrom, calculateEarningsForTime } from 'lib/planners/engine/apply/math';
import { absoluteSimTimeFor } from '@/engine/apply';
import { getSimulationContext } from '@/engine/adapter';
import { getNextTimeInTimezone, PACIFIC_TIMEZONE } from 'lib/planners/events';
import { useEventCrossingWaits } from '@/composables/useEventCrossingWaits';

const actionsStore = useActionsStore();
const virtueStore = useVirtueStore();
const { batch, insertWaitAcrossBoost } = useEventCrossingWaits();

const inputDuration = ref('');

const parsedSeconds = computed(() => {
  const str = inputDuration.value.trim();
  if (!str) return 0;

  const currentSimTime = Math.floor(baseTimestamp.value / 1000);

  // 1. Egg Relative Time (+n, -n)
  const relativeMatch = str.match(/^([+-])(\d{1,2})$/);
  if (relativeMatch) {
    const sign = relativeMatch[1];
    const n = parseInt(relativeMatch[2]);
    if (n >= 0 && n <= 23) {
      // Base is 9 AM Pacific. +0 = 9 AM, +1 = 10 AM, -5 = 4 AM.
      const offset = sign === '+' ? n : -n;
      const targetHour = (9 + offset + 24) % 24;
      const targetTS = getNextTimeInTimezone(targetHour, 0, currentSimTime, PACIFIC_TIMEZONE);
      return Math.max(0, targetTS - currentSimTime);
    }
  }

  // 2. Clock Time (12:30pm, 14:30, 5pm, etc.)
  // Matches 12:30, 12:30pm, 5pm, etc.
  // We distinguish from duration by checking for colon or am/pm suffix.
  if (str.includes(':') || /am$|pm$/i.test(str)) {
    const clockMatch = str.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i);
    if (clockMatch) {
      let hour = parseInt(clockMatch[1]);
      const minute = clockMatch[2] ? parseInt(clockMatch[2]) : 0;
      const ampm = clockMatch[3]?.toLowerCase();

      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;

      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        const targetTS = getNextTimeInTimezone(
          hour,
          minute,
          currentSimTime,
          virtueStore.ascensionTimezone
        );
        return Math.max(0, targetTS - currentSimTime);
      }
    }
  }

  // 3. Standard Duration
  const seconds = parseDuration(str);
  return isNaN(seconds) ? 0 : seconds;
});

const expectedGemsEarned = computed(() => {
  if (parsedSeconds.value <= 0) return 0;
  const snapshot = actionsStore.effectiveSnapshot;
  return calculateEarningsForTime(
    parsedSeconds.value,
    snapshot,
    boostTransitionsFrom(snapshot, absoluteSimTimeFor(snapshot, getSimulationContext()))
  );
});

const isValid = computed(() => parsedSeconds.value > 0);

const baseTimestamp = computed(() => {
  const startTime = virtueStore.planStartTime.getTime();
  const offset = actionsStore.planStartOffset;
  // Wall clock time = (Plan Start) + (Current Sim Time - Initial Sim Time)
  return startTime + (actionsStore.effectiveSnapshot.lastStepTime - offset) * 1000;
});

function handleWaitTime() {
  if (!isValid.value) return;

  const duration = parsedSeconds.value;

  batch(() => insertWaitAcrossBoost(duration, 'wait_for_time'));
  inputDuration.value = '';
}
</script>
