<template>
  <div class="inline-flex rounded-xl bg-slate-100 p-1">
    <button
      v-for="o in options"
      :key="o.id"
      type="button"
      class="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
      :class="model === o.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'"
      :disabled="o.disabled"
      @click="model = o.id"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
/** One of a few options as a row of buttons (Chain Finder's Target and Start). */
const model = defineModel<T>({ required: true });
defineProps<{ options: { id: T; label: string; disabled?: boolean }[] }>();
</script>
