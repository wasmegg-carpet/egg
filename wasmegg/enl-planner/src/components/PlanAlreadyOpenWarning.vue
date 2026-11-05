<script setup lang="ts">
import ConfirmationDialog from '@/components/ConfirmationDialog.vue';

defineEmits<{ dismiss: [] }>();
</script>

<template>
  <ConfirmationDialog
    title="Plan Already Open"
    message="This plan is already open in another tab. To avoid data conflicts, you cannot open it here. Please close it in the other tab first, or make a copy in your library."
    confirm-label="Got it"
    @confirm="$emit('dismiss')"
    @cancel="$emit('dismiss')"
  />
</template>
