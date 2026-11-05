<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-all" @click="handleClose" />

      <!-- Dialog -->
      <div
        class="card-glass relative w-full max-w-sm overflow-hidden shadow-2xl rounded-2xl border border-white/50 bg-white/95 transition-all duration-300 animate-in fade-in zoom-in-95"
      >
        <div
          class="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-100 flex items-center gap-3"
        >
          <div class="p-1.5 bg-slate-100 rounded-lg text-slate-600">
            <img
              :src="iconURL('egginc/icon_virtue_gem.png', 64)"
              class="w-5 h-5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]"
              alt="Gems"
            />
          </div>
          <h3 class="text-xs font-black text-slate-800 uppercase tracking-widest">Modify Bank Value</h3>
        </div>

        <div class="p-5 flex flex-col gap-4">
          <!-- Current Value -->
          <div class="flex items-center justify-between bg-slate-50/50 rounded-xl p-3 border border-slate-100">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Current Bank</span>
            <span class="font-mono-premium text-sm font-bold text-slate-800">{{ formatNumber(currentValue, 3) }}</span>
          </div>

          <!-- Mode Toggle -->
          <div class="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            <button
              class="flex-1 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-all"
              :class="mode === 'set' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
              @click="mode = 'set'"
            >
              Set Value
            </button>
            <button
              class="flex-1 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-all"
              :class="mode === 'delta' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
              @click="mode = 'delta'"
            >
              Add / Subtract
            </button>
            <button
              class="flex-1 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-all"
              :class="mode === 'time' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
              @click="mode = 'time'"
            >
              By Time
            </button>
          </div>

          <!-- Set Value Mode -->
          <div v-if="mode === 'set'" class="flex flex-col gap-2">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">New Bank Value</span>
            <input
              ref="inputEl"
              v-model="setInput"
              type="text"
              placeholder="e.g. 1.5T"
              class="input-premium font-mono-premium font-bold py-2.5"
              @keyup.enter="handleConfirm"
            />
          </div>

          <!-- Delta Mode -->
          <div v-else-if="mode === 'delta'" class="flex flex-col gap-2">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</span>
            <input
              ref="inputEl"
              v-model="deltaInput"
              type="text"
              placeholder="e.g. 50B to add, -50B to subtract"
              class="input-premium font-mono-premium font-bold py-2.5"
              @keyup.enter="handleConfirm"
            />
          </div>

          <!-- By Time Mode -->
          <div v-else class="flex flex-col gap-2">
            <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Duration</span>
            <input
              ref="inputEl"
              v-model="timeInput"
              type="text"
              placeholder="e.g. 2d4h to add, -2d4h to subtract"
              class="input-premium font-mono-premium font-bold py-2.5"
              @keyup.enter="handleConfirm"
            />
          </div>

          <!-- Precision warning: amount is too small to move the needle at this bank value -->
          <div
            v-if="hasRawInput && isPrecisionLimited"
            class="p-3 bg-amber-50 border border-amber-100 rounded-xl text-amber-700 text-[10px] font-bold uppercase tracking-tight"
          >
            Too small to register — this amount rounds away to nothing against your current bank value
          </div>

          <!-- Footer: same summary for every mode -->
          <div class="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
            <div class="flex justify-between items-center text-[10px]">
              <span class="font-black text-slate-400 uppercase tracking-widest">Current Offline Rate</span>
              <span class="font-mono-premium font-bold text-slate-600"
                >{{ formatNumber(offlineEarningsRate * 3600, 3) }}/hr</span
              >
            </div>
            <div class="flex justify-between items-center text-[10px]">
              <span class="font-black text-slate-400 uppercase tracking-widest">New Bank Value</span>
              <span class="font-mono-premium font-bold text-slate-800">{{
                formatNumber(hasRawInput ? newValue : currentValue, 3)
              }}</span>
            </div>
            <div class="flex justify-between items-center text-[10px]">
              <span class="font-black text-slate-400 uppercase tracking-widest">Change</span>
              <span
                class="font-mono-premium font-black"
                :class="
                  hasRawInput && delta < 0 ? 'text-rose-500' : hasRawInput ? 'text-emerald-600' : 'text-slate-300'
                "
              >
                {{ hasRawInput && delta >= 0 ? '+' : '' }}{{ formatNumber(hasRawInput ? delta : 0, 3) }}
              </span>
            </div>
            <div class="flex justify-between items-center text-[10px]">
              <span class="font-black text-slate-400 uppercase tracking-widest">Change (Time)</span>
              <span
                class="font-mono-premium font-bold"
                :class="hasRawInput && changeTimeSeconds !== null ? 'text-slate-600' : 'text-slate-300'"
              >
                <template v-if="hasRawInput && changeTimeSeconds !== null">
                  {{ delta >= 0 ? '+' : '-' }}{{ formatDuration(changeTimeSeconds) }}
                </template>
                <template v-else>—</template>
              </span>
            </div>
            <div
              v-if="hasRawInput && newValue < 0"
              class="text-[9px] text-amber-600 font-bold uppercase tracking-widest pt-1"
            >
              Bank will show as 0 until earnings catch up
            </div>
          </div>
        </div>

        <div class="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
          <button
            class="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all rounded-xl hover:shadow-sm"
            @click="handleClose"
          >
            Cancel
          </button>
          <button
            class="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white hover:bg-slate-700 transition-all rounded-xl shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="!isValid"
            @click="handleConfirm"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { iconURL } from 'lib';
import { formatNumber, formatDuration, parseNumber, parseDuration } from '@/lib/format';
import { generateActionId } from '@/types';
import type { ModifyBankPayload } from '@/types';
import { useVirtueStore } from '@/stores/virtue';
import { useActionsStore } from '@/stores/actions';
import { computeDependencies } from '@/lib/actions/executor';
import { useActionExecutor } from '@/composables/useActionExecutor';
import { calculateEarningsForTime } from '@/engine/apply/math';

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ close: [] }>();

const virtueStore = useVirtueStore();
const actionsStore = useActionsStore();
const { prepareExecution, completeExecution } = useActionExecutor();

const mode = ref<'set' | 'delta' | 'time'>('set');
const setInput = ref('');
const deltaInput = ref('');
const timeInput = ref('');
const inputEl = ref<HTMLInputElement | null>(null);

// Mirrors the value shown in FloatingStats, so the modal always agrees with what's behind it.
const currentValue = computed(() => actionsStore.effectiveSnapshot.bankValue);
const offlineEarningsRate = computed(() => actionsStore.effectiveSnapshot.offlineEarnings);

watch(
  () => props.show,
  show => {
    if (show) {
      mode.value = 'set';
      setInput.value = '';
      deltaInput.value = '';
      timeInput.value = '';
      nextTick(() => inputEl.value?.focus());
    }
  }
);

const parsedSetValue = computed(() => {
  if (!setInput.value.trim()) return null;
  const parsed = parseNumber(setInput.value);
  return isNaN(parsed) ? null : parsed;
});

// Sign comes from the input itself: a leading "-" subtracts, otherwise it adds.
const parsedDeltaAmount = computed(() => {
  if (!deltaInput.value.trim()) return null;
  const parsed = parseNumber(deltaInput.value);
  return isNaN(parsed) || parsed === 0 ? null : parsed;
});

// Same sign convention as delta mode; a leading "-" on the duration subtracts.
const parsedTimeSeconds = computed(() => {
  const raw = timeInput.value.trim();
  if (!raw) return null;
  const unsigned = raw.startsWith('-') ? raw.slice(1).trim() : raw;
  if (!unsigned) return null;
  const seconds = parseDuration(unsigned);
  return isNaN(seconds) || seconds <= 0 ? null : seconds;
});

const parsedTimeAmount = computed(() => {
  if (parsedTimeSeconds.value === null) return null;
  const sign = timeInput.value.trim().startsWith('-') ? -1 : 1;
  const magnitude = calculateEarningsForTime(parsedTimeSeconds.value, actionsStore.effectiveSnapshot);
  return sign * magnitude;
});

// The signed gem amount to add/subtract for 'delta' and 'time' modes.
const effectiveDeltaAmount = computed(() => {
  if (mode.value === 'time') return parsedTimeAmount.value ?? 0;
  return parsedDeltaAmount.value ?? 0;
});

const newValue = computed(() => {
  if (mode.value === 'set') return parsedSetValue.value ?? currentValue.value;
  return currentValue.value + effectiveDeltaAmount.value;
});

const delta = computed(() => newValue.value - currentValue.value);

// Same metric shown in the action history title: how long the change is worth at the current rate.
const changeTimeSeconds = computed(() => {
  if (offlineEarningsRate.value <= 0 || Math.abs(delta.value) < 0.5) return null;
  return Math.abs(delta.value) / offlineEarningsRate.value;
});

// Doubles only carry ~15-17 significant digits. Against a large enough bank value, adding/subtracting
// a much smaller amount can silently round away to nothing (e.g. +1T against a 1e45 bank).
const isPrecisionLimited = computed(() => {
  if (mode.value === 'set') return false;
  return effectiveDeltaAmount.value !== 0 && delta.value === 0;
});

const hasRawInput = computed(() => {
  if (mode.value === 'set') return parsedSetValue.value !== null;
  if (mode.value === 'delta') return parsedDeltaAmount.value !== null;
  return parsedTimeAmount.value !== null;
});

const isValid = computed(() => hasRawInput.value && !isPrecisionLimited.value);

function handleClose() {
  emit('close');
}

async function handleConfirm() {
  if (!isValid.value) return;

  const beforeSnapshot = prepareExecution();
  const previousValue = beforeSnapshot.bankValue;

  const targetValue =
    mode.value === 'set' ? (parsedSetValue.value as number) : previousValue + effectiveDeltaAmount.value;

  // 'time' mode computes a one-off gem amount from the current earnings rate, then
  // behaves exactly like a manually-typed delta from here on.
  const payload: ModifyBankPayload = {
    mode: mode.value === 'set' ? 'set' : 'delta',
    amount: mode.value === 'set' ? targetValue : effectiveDeltaAmount.value,
    previousValue,
    delta: targetValue - previousValue,
  };

  const dependencies = computeDependencies(
    'modify_bank',
    payload,
    actionsStore.actionsBeforeInsertion,
    actionsStore.initialSnapshot.researchLevels
  );

  // Apply to store
  virtueStore.setBankValue(targetValue);

  // Complete execution
  await completeExecution(
    {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'modify_bank',
      payload,
      cost: 0,
      dependsOn: dependencies,
    },
    beforeSnapshot
  );

  emit('close');
}
</script>

<style scoped>
.font-mono-premium {
  font-family: 'JetBrains Mono', 'Roboto Mono', monospace;
}

.animate-in {
  animation-duration: 200ms;
}
</style>
