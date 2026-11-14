<template>
  <template v-for="row in rows" :key="row.kind === 'smart_buy' ? row.group.note.id : row.action.id">
    <SmartBuyGroupRow v-if="row.kind === 'smart_buy'" :group="row.group" @undo="forwardUndo" />
    <ActionHistoryItem v-else :action="row.action" compact @undo="forwardUndo(row.action, $event)" />
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Action } from '@planner/types';
import { groupSmartBuys } from 'lib/planners/actions/smartBuyGroups';
import ActionHistoryItem from 'ui/components/planners/ActionHistoryItem.vue';
import SmartBuyGroupRow from 'ui/components/planners/SmartBuyGroupRow.vue';

const props = defineProps<{
  actions: Action[];
}>();

const emit = defineEmits<{
  undo: [action: Action, options: { skipConfirmation: boolean }];
}>();

const rows = computed(() => groupSmartBuys(props.actions));

function forwardUndo(action: Action, options: { skipConfirmation: boolean }) {
  emit('undo', action, options);
}
</script>
