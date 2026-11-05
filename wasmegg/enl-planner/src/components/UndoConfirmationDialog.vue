<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-all" @click="$emit('cancel')" />

      <!-- Dialog -->
      <div class="card-glass relative w-full max-w-lg overflow-hidden shadow-2xl border border-white/50 bg-white/95">
        <div class="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-100">
          <h3 class="text-sm font-black text-slate-800 uppercase tracking-widest">Undo Action</h3>
        </div>

        <div class="p-6">
          <p class="text-sm font-medium text-slate-600 mb-6">How would you like to undo "{{ actionName }}"?</p>

          <div class="space-y-4">
            <!-- Option A: Direct Dependents -->
            <button
              class="group relative w-full text-left p-4 rounded-xl border border-slate-200 bg-white transition-all hover:border-blue-400 hover:shadow-md hover:ring-1 hover:ring-blue-100 active:scale-[0.99]"
              @click="$emit('confirm', 'dependents')"
            >
              <div class="flex justify-between items-start mb-2">
                <span class="text-xs font-black text-slate-700 group-hover:text-blue-600 uppercase tracking-wide">
                  {{
                    areOptionsIdentical
                      ? dependentsA.length > 0
                        ? 'Undo Action & Dependents'
                        : 'Undo Action'
                      : dependentsA.length > 0
                        ? 'Option A: Smart Undo'
                        : 'Option A: Undo Action'
                  }}
                </span>
                <span class="badge-premium bg-amber-50 text-amber-700 border border-amber-100 font-mono-premium"
                  >Refund: {{ formatNumber(refundA, 3) }}</span
                >
              </div>
              <p class="text-xs text-slate-500 mb-3 leading-relaxed">
                {{
                  dependentsA.length > 0
                    ? 'Undoes this action and any other actions that directly depend on its effects.'
                    : 'Removes only this action from your history.'
                }}
              </p>
              <div
                v-if="dependentsA.length > 0"
                class="mt-3 bg-slate-50 rounded-lg p-3 text-xs text-slate-500 border border-slate-100"
              >
                <p class="font-bold text-amber-600 mb-1 uppercase tracking-tight text-[10px]">
                  Also undoes {{ dependentsA.length }} dependent{{ dependentsA.length > 1 ? 's' : '' }}:
                </p>
                <ul class="list-disc list-inside space-y-0.5">
                  <li v-for="dep in dependentsA.slice(0, 3)" :key="dep.id" class="truncate opacity-80">
                    {{ getActionName(dep) }}
                  </li>
                  <li v-if="dependentsA.length > 3" class="italic opacity-60">
                    + {{ dependentsA.length - 3 }} more...
                  </li>
                </ul>
              </div>
              <p v-else class="text-[10px] italic text-slate-400 font-medium">No other actions affected.</p>
            </button>

            <!-- Option B: Until Shift -->
            <button
              v-if="!areOptionsIdentical"
              class="group relative w-full text-left p-4 rounded-xl border border-slate-200 bg-white transition-all hover:border-purple-400 hover:shadow-md hover:ring-1 hover:ring-purple-100 active:scale-[0.99]"
              @click="$emit('confirm', 'truncate')"
            >
              <div class="flex justify-between items-start mb-2">
                <span class="text-xs font-black text-slate-700 group-hover:text-purple-600 uppercase tracking-wide"
                  >Option B: Undo Until Shift</span
                >
                <span class="badge-premium bg-amber-50 text-amber-700 border border-amber-100 font-mono-premium"
                  >Refund: {{ formatNumber(refundB, 3) }}</span
                >
              </div>
              <p class="text-xs text-slate-500 mb-3 leading-relaxed">
                Undoes this action and EVERY action that follows it within the current egg period.
              </p>
              <div
                v-if="dependentsB.length > 0"
                class="mt-3 bg-slate-50 rounded-lg p-3 text-xs text-slate-500 border border-slate-100"
              >
                <p class="font-bold text-purple-600 mb-1 uppercase tracking-tight text-[10px]">
                  Also undoes {{ dependentsB.length }} following action{{ dependentsB.length > 1 ? 's' : '' }}:
                </p>
                <ul class="list-disc list-inside space-y-0.5">
                  <li v-for="dep in dependentsB.slice(0, 3)" :key="dep.id" class="truncate opacity-80">
                    {{ getActionName(dep) }}
                  </li>
                  <li v-if="dependentsB.length > 3" class="italic opacity-60">
                    + {{ dependentsB.length - 3 }} more...
                  </li>
                </ul>
              </div>
              <p v-else class="text-[10px] italic text-slate-400 font-medium">
                This is the last action in this period.
              </p>
            </button>
          </div>

          <!-- Cancel Button -->
          <div class="mt-6 flex justify-end">
            <button class="btn-premium btn-ghost text-xs text-slate-500 hover:text-slate-800" @click="$emit('cancel')">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Action } from '@/types';
import { getExecutor } from '@/lib/actions';
import { formatNumber } from '@/lib/format';

const props = defineProps<{
  action: Action;
  dependentsA: Action[];
  dependentsB: Action[];
}>();

defineEmits<{
  confirm: [mode: 'dependents' | 'truncate'];
  cancel: [];
}>();

const actionName = computed(() => {
  const executor = getExecutor(props.action.type);
  return executor.getDisplayName(props.action.payload);
});

const refundA = computed(() => {
  let total = props.action.cost;
  for (const dep of props.dependentsA) {
    total += dep.cost;
  }
  return total;
});

const refundB = computed(() => {
  let total = props.action.cost;
  for (const dep of props.dependentsB) {
    total += dep.cost;
  }
  return total;
});

function getActionName(action: Action): string {
  const executor = getExecutor(action.type);
  return executor.getDisplayName(action.payload);
}

const areOptionsIdentical = computed(() => {
  return props.dependentsA.length === props.dependentsB.length;
});
</script>
