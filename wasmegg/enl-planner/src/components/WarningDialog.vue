<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-all" @click="close" />

      <!-- Dialog -->
      <div
        class="card-glass relative w-full max-w-md overflow-hidden shadow-2xl border border-white/50 bg-white/95 transition-all duration-300 animate-in fade-in zoom-in-95"
      >
        <div
          class="bg-gradient-to-r from-amber-50 to-white px-6 py-4 border-b border-amber-100 flex items-center gap-3"
        >
          <div class="p-1.5 bg-amber-100 rounded-lg text-amber-600">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h3 class="text-xs font-black text-slate-800 uppercase tracking-widest">{{ title || 'Warning' }}</h3>
        </div>

        <div class="p-6">
          <p class="text-sm font-medium text-slate-600 leading-relaxed">
            {{ message }}
          </p>

          <div class="mt-8 flex justify-end gap-3">
            <template v-if="title === 'New Version Available'">
              <button
                class="btn-premium btn-primary px-8 py-2 text-xs font-black uppercase tracking-widest shadow-lg shadow-blue-500/20"
                @click="reload"
              >
                Refresh Page
              </button>
            </template>
            <template v-else>
              <button
                class="btn-premium btn-primary px-8 py-2 text-xs font-black uppercase tracking-widest shadow-lg shadow-blue-500/20"
                @click="close"
              >
                Understood
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useWarningStore } from '@/stores/warning';

const warningStore = useWarningStore();
const { isOpen, title, message } = storeToRefs(warningStore);
const { close } = warningStore;

function reload() {
  window.location.reload();
}
</script>

<style scoped>
.animate-in {
  animation-duration: 200ms;
}
</style>
