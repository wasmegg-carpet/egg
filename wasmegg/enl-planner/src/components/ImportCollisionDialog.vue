<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" @click="$emit('cancel')" />

      <!-- Dialog -->
      <div
        class="card-glass relative w-full max-w-lg overflow-hidden shadow-2xl border border-white/50 bg-white/95 animate-in fade-in zoom-in-95"
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
          <h3 class="text-xs font-black text-slate-800 uppercase tracking-widest">Name Collision</h3>
        </div>

        <div class="p-6">
          <p class="text-sm font-medium text-slate-600 leading-relaxed">
            A plan named <strong class="text-slate-900">"{{ planName }}"</strong> already exists in your library. How
            would you like to proceed?
          </p>

          <div class="mt-6 space-y-2">
            <button
              class="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all group text-left"
              @click="$emit('resolve', 'overwrite')"
            >
              <div class="p-1.5 bg-red-50 rounded-lg text-red-500 group-hover:bg-red-100 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
              <div>
                <div class="text-sm font-bold text-slate-800">Overwrite</div>
                <div class="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                  Replace the existing plan with the imported one
                </div>
              </div>
            </button>

            <button
              class="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all group text-left"
              @click="$emit('resolve', 'keep-both')"
            >
              <div class="p-1.5 bg-indigo-50 rounded-lg text-indigo-500 group-hover:bg-indigo-100 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
                  />
                </svg>
              </div>
              <div>
                <div class="text-sm font-bold text-slate-800">Keep Both (Rename)</div>
                <div class="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                  Save as "{{ renamedName }}"
                </div>
              </div>
            </button>

            <button
              class="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all group text-left"
              @click="$emit('resolve', 'skip')"
            >
              <div class="p-1.5 bg-slate-100 rounded-lg text-slate-400 group-hover:bg-slate-200 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </div>
              <div>
                <div class="text-sm font-bold text-slate-800">Skip</div>
                <div class="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                  Don't import this plan
                </div>
              </div>
            </button>
          </div>

          <div v-if="remainingCount > 0" class="mt-4 flex items-center gap-2">
            <input
              id="apply-to-all"
              v-model="applyToAll"
              type="checkbox"
              class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label for="apply-to-all" class="text-xs font-medium text-slate-500 cursor-pointer select-none">
              Apply to all remaining collisions ({{ remainingCount }})
            </label>
          </div>

          <div class="mt-6 flex justify-end">
            <button
              class="btn-premium btn-ghost px-6 py-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
              @click="$emit('cancel')"
            >
              Cancel Import
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  planName: string;
  renamedName: string;
  remainingCount: number;
}>();

defineEmits<{
  resolve: [resolution: 'overwrite' | 'keep-both' | 'skip'];
  cancel: [];
}>();

const applyToAll = ref(false);

defineExpose({ applyToAll });
</script>

<style scoped>
.animate-in {
  animation-duration: 200ms;
}
</style>
