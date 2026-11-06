<template>
  <!-- Same spinner glyph LoadingOverlay/RecalculationOverlay use, factored out so localized
       loading states (a busy button, a dimmed card) can reuse it at whatever size/color the
       call site needs via passthrough `class` (e.g. `class="w-4 h-4 text-blue-500"`). -->
  <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle>
    <path
      class="opacity-100"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    ></path>
  </svg>
</template>

<script setup lang="ts"></script>
