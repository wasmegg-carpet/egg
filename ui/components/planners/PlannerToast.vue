<template>
  <div
    role="status"
    aria-live="polite"
    class="fixed top-4 inset-x-0 z-[100] flex justify-center px-4 pointer-events-none"
  >
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div
        v-if="toastStore.message"
        class="rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white shadow-lg"
      >
        {{ toastStore.message }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { useToastStore } from 'lib/planners/stores/toast';

const toastStore = useToastStore();
</script>
