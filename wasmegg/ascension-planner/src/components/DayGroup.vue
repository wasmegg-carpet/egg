<template>
  <div class="border-t border-slate-100 first:border-t-0">
    <!-- Day header: always-visible compact summary, click to expand/collapse details -->
    <button
      class="w-full px-3 py-1.5 flex items-center justify-between gap-2 bg-slate-100/80 hover:bg-slate-100 transition-colors text-left"
      @click="emit('update:expanded', !props.expanded)"
    >
      <div class="flex items-center gap-2 min-w-0">
        <svg
          class="w-3 h-3 text-slate-400 transition-transform duration-200 flex-shrink-0"
          :class="{ 'rotate-90': props.expanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
        <span class="text-[10px] font-black text-slate-500 uppercase tracking-widest truncate">{{ label }}</span>
        <span class="text-[9px] font-bold text-slate-500 shrink-0">
          <template v-if="researchBuyCount > 0"
            >{{ researchBuyCount }} research buy{{ researchBuyCount === 1 ? '' : 's' }}</template
          >
          <template v-else>{{ actions.length }} action{{ actions.length === 1 ? '' : 's' }}</template>
        </span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span v-if="eggsDelivered > 0" class="text-[9px] font-black text-slate-400 tracking-tight">
          {{ formatNumber(eggsDelivered, 2) }} Eggs
        </span>
        <div v-if="totalCost > 0" class="flex items-center gap-1">
          <span class="text-[9px] font-black text-amber-600 tracking-tight">{{ formatGemPrice(totalCost) }}</span>
          <img :src="iconURL('egginc/icon_virtue_gem.png', 32)" class="w-2.5 h-2.5" alt="Gems" />
        </div>
      </div>
    </button>

    <!-- Details: full egg summary + raw action rows, only when expanded -->
    <template v-if="props.expanded">
      <component
        :is="summaryComponent"
        v-if="summaryComponent"
        :header-action="summaryHeaderAction"
        :actions="actions"
        compact
        hide-header
      />
      <ActionHistoryItem
        v-for="action in actions"
        :key="action.id"
        :action="action"
        compact
        @undo="handleItemUndo(action, $event)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { iconURL } from 'lib';
import type { Action } from '@/types';
import { formatNumber, formatGemPrice } from '@/lib/format';
import ActionHistoryItem from './ActionHistoryItem.vue';

const props = defineProps<{
  label: string;
  actions: Action[];
  summaryHeaderAction: Action;
  summaryComponent?: unknown;
  totalCost: number;
  eggsDelivered: number;
  // Collapsed by default — the header row above is the "daily summary" this consolidates down to.
  // Owned by the parent ActionGroup so it can force a specific day open (e.g. when a curiosity
  // summary link is clicked for an action that lives inside this day).
  expanded: boolean;
}>();

const emit = defineEmits<{
  undo: [action: Action, options: { skipConfirmation: boolean }];
  'update:expanded': [value: boolean];
}>();

// Only research purchases count here — other action types (waits, events, etc.) are noise for
// the collapsed header's badge. Falls back to a plain action count for research-free groups
// (e.g. a merged multi-day "waiting" block — see ActionGroup's dayGroups).
const researchBuyCount = computed(() => props.actions.filter(a => a.type === 'buy_research').length);

function handleItemUndo(action: Action, options: { skipConfirmation: boolean }) {
  emit('undo', action, options);
}
</script>
