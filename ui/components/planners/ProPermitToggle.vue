<template>
  <div
    class="flex items-center justify-between p-3 bg-slate-50/50 rounded-xl border border-slate-100 group hover:bg-slate-50 transition-colors"
  >
    <div>
      <div class="text-sm font-bold text-slate-700">Pro Permit</div>
      <div
        class="hidden sm:block text-[10px] uppercase font-black text-slate-400 tracking-wider group-hover:text-slate-500 transition-colors"
      >
        {{ modelValue ? '4 artifacts · 10 silos' : 'Standard: half offline earnings · 2 artifacts · 2 silos' }}
      </div>
    </div>
    <div class="flex items-center">
      <button
        class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
        :class="[modelValue ? 'bg-brand-primary' : 'bg-slate-300']"
        role="switch"
        :aria-checked="modelValue"
        @click="$emit('update:modelValue', !modelValue)"
      >
        <span class="sr-only">Pro Permit</span>
        <span
          aria-hidden="true"
          class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
          :class="[modelValue ? 'translate-x-5' : 'translate-x-0']"
        />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Pro vs. Standard permit switch, shared by the manual planner's Initial State and the auto planner.
 * Standard halves offline earnings and caps silos and active artifacts at 2.
 */
defineProps<{ modelValue: boolean }>();

defineEmits<{
  'update:modelValue': [value: boolean];
}>();
</script>
