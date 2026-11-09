<template>
  <ConfirmationDialog
    :title="mode === 'set' ? 'Apply Artifact Override' : 'Remove Artifact Override'"
    :confirm-label="confirmLabel"
    cancel-label="Cancel"
    @confirm="emit('confirm', [...selected].sort((a, b) => a - b))"
    @cancel="emit('cancel')"
  >
    <p class="text-sm font-medium text-slate-600 leading-relaxed">
      {{ mode === 'set' ? 'Also apply this artifact & stone override to:' : 'Also remove the artifact & stone override from:' }}
    </p>
    <div class="mt-4 flex gap-2">
      <button
        class="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-lg border border-slate-200"
        @click="selectLater"
      >
        All later
      </button>
      <button
        class="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-lg border border-slate-200"
        @click="selectAll"
      >
        All
      </button>
      <button
        class="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-lg border border-slate-200"
        @click="selectOnlyCurrent"
      >
        This one only
      </button>
    </div>
    <div class="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
      <label
        v-for="idx in indices"
        :key="idx"
        class="flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs font-black"
        :class="selected.has(idx) ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-100 text-slate-500'"
      >
        <input
          type="checkbox"
          :checked="selected.has(idx)"
          :disabled="idx === currentIndex"
          @change="toggle(idx)"
        />
        A{{ idx + 1 }}
        <span v-if="mode === 'remove' && !overriddenIndices.includes(idx)" class="text-[8px] font-bold text-slate-400">none</span>
      </label>
    </div>
  </ConfirmationDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import ConfirmationDialog from 'ui/components/planners/ConfirmationDialog.vue';

const props = defineProps<{
  mode: 'set' | 'remove';
  /** The ascension the override was edited on — always included. */
  currentIndex: number;
  /** Number of visible ascensions in the chain. */
  total: number;
  /** Ascensions that currently have an override (shown on removal). */
  overriddenIndices: number[];
}>();

const emit = defineEmits<{
  confirm: [indices: number[]];
  cancel: [];
}>();

const indices = computed(() => Array.from({ length: props.total }, (_, i) => i));
const selected = ref(new Set<number>([props.currentIndex]));

function toggle(idx: number) {
  const next = new Set(selected.value);
  if (next.has(idx)) next.delete(idx);
  else next.add(idx);
  next.add(props.currentIndex);
  selected.value = next;
}

const selectOnlyCurrent = () => (selected.value = new Set([props.currentIndex]));
const selectAll = () => (selected.value = new Set(indices.value));
const selectLater = () => (selected.value = new Set(indices.value.filter(i => i >= props.currentIndex)));

const confirmLabel = computed(() => {
  const verb = props.mode === 'set' ? 'Apply' : 'Remove';
  return selected.value.size === 1 ? `${verb} on A${props.currentIndex + 1} only` : `${verb} on ${selected.value.size} ascensions`;
});
</script>
