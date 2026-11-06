<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-all" @click="$emit('cancel')" />

      <!-- Dialog -->
      <div
        class="card-glass relative w-full max-w-md overflow-hidden shadow-2xl border border-white/50 bg-white/95 transition-all duration-300 animate-in fade-in zoom-in-95"
      >
        <div
          class="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-100 flex items-center gap-3"
        >
          <div class="p-1.5 bg-slate-100 rounded-lg text-slate-600">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h3 class="text-xs font-black text-slate-800 uppercase tracking-widest">{{ title }}</h3>
        </div>

        <div class="p-6">
          <p v-if="message" class="text-sm font-medium text-slate-600 leading-relaxed">
            {{ message }}
          </p>
          
          <slot />

          <div class="mt-8 flex justify-end gap-3">
            <button
              class="btn-premium btn-ghost px-6 py-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
              @click="$emit('cancel')"
            >
              {{ cancelLabel }}
            </button>
            <button
               class="btn-premium px-8 py-2 text-xs font-black uppercase tracking-widest shadow-lg"
               :class="variant === 'danger' ? 'bg-red-600 border-red-500 text-white hover:bg-red-700 shadow-red-500/20' : 'btn-primary shadow-blue-500/20'"
               @click="$emit('confirm')"
             >
               {{ confirmLabel }}
             </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
interface Props {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
}

withDefaults(defineProps<Props>(), {
  title: 'Confirm Action',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  variant: 'primary',
});

defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<style scoped>
.animate-in {
  animation-duration: 200ms;
}
</style>
