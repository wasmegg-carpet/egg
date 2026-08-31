<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-all" @click="$emit('cancel')" />

      <!-- Dialog -->
      <div
        class="card-glass relative w-full max-w-lg overflow-hidden shadow-2xl border border-rose-200/50 bg-white/95 transition-all duration-300 animate-in fade-in zoom-in-95"
      >
        <div
          class="bg-gradient-to-r from-rose-50 to-white px-6 py-4 border-b border-rose-100 flex items-center gap-3"
        >
          <div class="p-1.5 bg-rose-100 rounded-lg text-rose-600">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h3 class="text-xs font-black text-rose-800 uppercase tracking-widest">Event Expiry Warning</h3>
        </div>

        <div class="p-6">
          <div class="space-y-4">
            <p class="text-sm font-medium text-slate-700 leading-relaxed">
              The active <span class="text-rose-600 font-bold">{{ eventName }}</span> is scheduled to end at
              <span class="text-slate-900 font-bold">{{ formatTime(endTime) }}</span>.
            </p>
            <p class="text-sm font-medium text-slate-600 leading-relaxed">
              This action (or sequence of actions) is estimated to complete at 
              <span class="text-slate-900 font-bold">{{ formatTime(completionTime) }}</span>, 
              which is <span class="text-rose-600 font-bold">{{ formatDuration(completionTime - endTime) }}</span> after the event expiry.
            </p>
            <p class="text-xs text-slate-500 italic">
              Continuing will add the action(s) using the current event rates, even though the simulation time will pass the expiry threshold.
            </p>
          </div>

          <div class="mt-8 flex flex-col sm:flex-row justify-end gap-3">
            <div class="flex flex-1 gap-2">
              <button
                class="flex-1 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50 transition-colors"
                @click="$emit('deactivateAndCancel')"
              >
                Deactivate & Cancel
              </button>
            </div>
            <div class="flex gap-2">
              <button
                class="px-6 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-600 transition-colors"
                @click="$emit('cancel')"
              >
                Cancel
              </button>
              <button
                class="btn-premium bg-rose-600 text-white px-8 py-2 text-[10px] font-black uppercase tracking-wider shadow-lg"
                @click="$emit('deactivateAndContinue')"
              >
                Deactivate and Continue
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useVirtueStore } from '@/stores/virtue';

interface Props {
  eventName: string;
  endTime: number; // Unix timestamp
  completionTime: number; // Unix timestamp
}

defineProps<Props>();

defineEmits<{
  cancel: [];
  deactivateAndCancel: [];
  deactivateAndContinue: [];
}>();

const virtueStore = useVirtueStore();

function formatTime(timestamp: number): string {
  // `Math.round`, not a bare `new Date(...)` — see `secondsToDate`'s doc comment (lib/format.ts):
  // `timestamp` routinely lands a sub-microsecond residue short of a whole second.
  return new Date(Math.round(timestamp * 1000)).toLocaleString(undefined, {
    timeZone: virtueStore.ascensionTimezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
</script>

<style scoped>
.animate-in {
  animation-duration: 200ms;
}

.btn-premium {
  border-radius: 8px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn-premium:hover {
  transform: translateY(-1px);
  filter: brightness(1.1);
}
</style>
