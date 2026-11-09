<template>
  <div class="flex gap-1 bg-slate-100 p-1 rounded-xl mb-4" role="tablist">
    <button
      v-for="section in sections"
      :key="section.id"
      role="tab"
      :aria-selected="modelValue === section.id"
      class="flex-1 py-1.5 text-xs font-bold rounded-lg transition-all"
      :class="
        modelValue === section.id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      "
      @click="$emit('update:modelValue', section.id)"
    >
      {{ section.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
/** Picks a section within a tab (e.g. Habs / Vehicles / Silos on Farm). */
defineProps<{ modelValue: string; sections: { id: string; label: string }[] }>();
defineEmits<{ 'update:modelValue': [id: string] }>();
</script>
