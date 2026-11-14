<template>
  <div class="border-t border-slate-100 first:border-t-0">
    <!-- Always-visible summary, click to expand/collapse what the smart buy did -->
    <button
      class="w-full px-2 py-1 flex items-center justify-between gap-2 bg-amber-50/40 hover:bg-amber-50 transition-colors text-left"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <div class="flex items-center gap-1.5 min-w-0">
        <svg
          class="w-3 h-3 text-slate-400 transition-transform duration-200 flex-shrink-0"
          :class="{ 'rotate-90': expanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
        <span class="text-[10px] font-bold text-slate-700 truncate">{{ group.note.payload.message }}</span>
        <span class="text-[9px] font-bold text-slate-500 shrink-0">
          {{ group.purchaseCount }} research buy{{ group.purchaseCount === 1 ? '' : 's' }}
        </span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span v-if="group.totalTimeSeconds >= 1" class="text-[8px] font-black text-slate-400 uppercase tracking-widest">
          {{ formatDuration(group.totalTimeSeconds) }}
        </span>
        <div v-if="group.totalCost > 0" class="flex items-center gap-1">
          <span class="text-[9px] font-black text-amber-600 tracking-tight">{{ formatPrice(group.totalCost) }}</span>
          <img :src="iconURL(PROFILE.currency.iconPath, 32)" class="w-2.5 h-2.5" :alt="PROFILE.currency.name" />
        </div>
      </div>
    </button>

    <template v-if="expanded">
      <div class="px-3 pb-1.5 bg-amber-50/40">
        <ResearchPurchasePreview :items="summaryItems" :max-visible="summaryItems.length" />
      </div>
      <div class="ml-2 border-l-2 border-amber-200">
        <ActionHistoryItem
          v-for="action in group.actions"
          :key="action.id"
          :action="action"
          compact
          @undo="emit('undo', action, $event)"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { PROFILE } from '@planner/lib/profile';
import { computed } from 'vue';
import { iconURL } from 'lib';
import type { Action } from '@planner/types';
import { formatDuration, formatPrice } from '@planner/lib/format';
import type { SmartBuyGroup } from 'lib/planners/actions/smartBuyGroups';
import { expandedSmartBuyNoteIds, setSmartBuyExpanded } from 'lib/planners/composables/useSmartBuyExpansion';
import { summarizeResearchLevelChanges } from 'lib/planners/calculations/smartBuyPreview';
import ActionHistoryItem from 'ui/components/planners/ActionHistoryItem.vue';
import ResearchPurchasePreview from 'ui/components/planners/actions/ResearchPurchasePreview.vue';

const props = defineProps<{
  group: SmartBuyGroup;
}>();

const emit = defineEmits<{
  undo: [action: Action, options: { skipConfirmation: boolean }];
}>();

const expanded = computed({
  get: () => expandedSmartBuyNoteIds.value.has(props.group.note.id),
  set: value => setSmartBuyExpanded(props.group.note.id, value),
});

// Whole-farm levels on both sides, so a tier the sweep finishes reads "Max Tier N" even when some
// of that tier was already maxed before it. The same summary the Smart Buy cards show as a preview.
const summaryItems = computed(() =>
  summarizeResearchLevelChanges(
    props.group.note.endState.researchLevels,
    props.group.actions[props.group.actions.length - 1].endState.researchLevels
  )
);
</script>
