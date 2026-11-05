<template>
  <ConfirmationDialog
    v-if="store.isOpen"
    :title="store.title"
    :message="store.message"
    confirm-label="Remove Later Purchase"
    cancel-label="Cancel Purchase"
    @confirm="store.confirm()"
    @cancel="store.cancel()"
  />
</template>

<script setup lang="ts">
import { useContinuityStore } from '@/stores/continuity';
import ConfirmationDialog from '@/components/ConfirmationDialog.vue';

const store = useContinuityStore();
</script>
