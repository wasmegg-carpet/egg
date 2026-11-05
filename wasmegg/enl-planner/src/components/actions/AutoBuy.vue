<template>
  <SmartBuyCard
    title="Auto Buy"
    :badge="alwaysOn ? 'Enabled' : 'Disabled'"
    :badge-active="alwaysOn"
    note="Auto Buy will never spend gems from your bank."
  >
    <template #icon>
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
        />
      </svg>
    </template>
    <template #description>
      Automatically buys any research that requires less than
      <span
        class="font-mono font-bold text-brand-primary bg-white px-1.5 py-0.5 rounded border border-slate-200 shadow-sm mx-0.5"
        >{{ displayDuration }}</span
      >
      time to save, as soon as it becomes affordable.
    </template>

    <div class="space-y-2">
      <div class="relative group">
        <input
          v-model="timeValue"
          type="text"
          placeholder="Threshold (e.g. 1h 30m or 100s)"
          class="input-premium pl-3 pr-10"
        />
        <div
          class="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300 group-focus-within:text-brand-primary transition-colors uppercase tracking-widest pointer-events-none"
        >
          Time
        </div>
      </div>

      <button
        :disabled="isInvalid"
        class="btn-premium w-full text-[10px]"
        :class="alwaysOn ? 'btn-primary' : 'btn-secondary'"
        @click="emit('update:alwaysOn', !alwaysOn)"
      >
        {{ alwaysOn ? 'Disable Auto Buy' : 'Enable Auto Buy' }}
      </button>
    </div>
  </SmartBuyCard>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { formatDuration, parseDuration } from '@/lib/format';
import SmartBuyCard from './SmartBuyCard.vue';

const props = defineProps<{
  alwaysOn: boolean;
}>();

const emit = defineEmits<{
  (e: 'update', state: { threshold: number; alwaysOn: boolean }): void;
  (e: 'update:alwaysOn', value: boolean): void;
}>();

const timeValue = ref('1s');

const parsedSeconds = computed(() => {
  const seconds = parseDuration(timeValue.value);
  return isNaN(seconds) ? 0 : seconds;
});

const isInvalid = computed(() => parsedSeconds.value <= 0 && timeValue.value !== '');

const displayDuration = computed(() => {
  if (parsedSeconds.value <= 0) return '0s';
  return formatDuration(parsedSeconds.value);
});

// Emit updates whenever state changes, so the parent can re-run the sweep with the latest threshold.
watch(
  [parsedSeconds, () => props.alwaysOn],
  ([threshold, alwaysOn]) => {
    emit('update', { threshold, alwaysOn });
  },
  { immediate: true }
);

// Disable Auto Buy whenever the user changes the threshold input, so a stale threshold doesn't keep
// sweeping silently after being edited.
watch(timeValue, () => {
  emit('update:alwaysOn', false);
});
</script>
