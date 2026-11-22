<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" @click="!busy && $emit('cancel')" />
      <div class="relative w-full max-w-md overflow-hidden rounded-lg shadow-2xl border border-white/50 bg-white">
        <div class="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div class="p-1.5 bg-indigo-50 rounded-lg text-indigo-500">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
          </div>
          <h3 class="text-xs font-black text-slate-800 uppercase tracking-widest">{{ title }}</h3>
        </div>
        <div class="p-6">
          <slot />
          <p v-if="error" class="mt-4 text-xs font-medium text-red-600" role="alert">{{ error }}</p>
          <div class="mt-6 flex justify-end gap-3">
            <button
              class="px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 disabled:opacity-40"
              :disabled="busy"
              @click="$emit('cancel')"
            >
              {{ cancelLabel }}
            </button>
            <button
              v-if="confirmLabel"
              class="px-6 py-2 text-xs font-black uppercase tracking-widest rounded text-white shadow disabled:opacity-40 disabled:cursor-not-allowed"
              :class="variant === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'"
              :disabled="disabled || busy"
              @click="$emit('confirm')"
            >
              {{ busy ? 'Working…' : confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'primary' | 'danger';
    disabled?: boolean;
    busy?: boolean;
    error?: string;
  }>(),
  { confirmLabel: '', cancelLabel: 'Cancel', variant: 'primary', disabled: false, busy: false, error: '' }
);

defineEmits<{ confirm: []; cancel: [] }>();
</script>
