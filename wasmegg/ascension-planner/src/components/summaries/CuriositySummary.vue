<template>
  <div
    class="border-t border-slate-100/50"
    :class="[compact ? 'px-3 py-2' : 'px-5 py-4', hideHeader ? 'bg-amber-50/40' : 'bg-slate-50/30']"
  >
    <div v-if="!hideHeader" class="flex items-center justify-between" :class="compact ? 'mb-2' : 'mb-4'">
      <div class="flex items-center gap-2">
        <div
          class="w-5 h-5 rounded-lg bg-amber-50 border border-amber-100 shadow-sm flex items-center justify-center p-1"
        >
          <svg class="w-full h-full text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.675.337a4 4 0 01-2.574.338L6.5 15.1l-1.5-1.5 1.5-1.5 2.414.483a2 2 0 001.287-.169l.675-.337a8 8 0 015.147-.69l2.387.477a2 2 0 001.022.547l1.718.344a2 2 0 011.414 1.414l.344 1.718a2 2 0 01-.547 1.022l-1.5 1.5-1.5-1.5.483-2.414a2 2 0 00-.169-1.287l-.337-.675a8 8 0 00-.69-5.147l.477-2.387a2 2 0 00-.547-1.022l-1.718-.344a2 2 0 00-1.414-1.414l-1.718-.344a2 2 0 00-1.022.547l-1.5 1.5 1.5 1.5.483-2.414a2 2 0 011.287-.169l.675.337a8 8 0 01.69 5.147l-.477 2.387a2 2 0 01.547 1.022l1.718.344a2 2 0 011.414 1.414l.344 1.718a2 2 0 01-.547 1.022l-1.5 1.5z"
            />
          </svg>
        </div>
        <span class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Curiosity Summary</span>
        <div
          v-if="activeArtifactSet === 'earnings'"
          class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200/50"
        >
          <span class="text-[9px] font-black font-mono-premium text-slate-700">{{
            formatNumber(hourlyOfflineEarnings, 3)
          }}</span>
          <span class="text-[8px] font-black uppercase tracking-widest text-slate-400">/hr</span>
        </div>
        <div
          v-else-if="activeArtifactSet === 'elr'"
          class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200/50"
        >
          <span class="text-[9px] font-black font-mono-premium text-slate-700">{{ formatNumber(hourlyELR, 3) }}</span>
          <span class="text-[8px] font-black uppercase tracking-widest text-slate-400">/hr</span>
        </div>
      </div>

      <div
        v-if="totalResearchCost > 0"
        class="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50/50 border border-amber-100/50"
      >
        <img :src="iconURL('egginc/icon_virtue_gem.png', 32)" class="w-3 h-3" alt="Gems" />
        <span class="text-[10px] font-black text-amber-600 tracking-tight">{{
          formatGemPrice(totalResearchCost)
        }}</span>
      </div>
    </div>

    <div v-if="summaryItems.length > 0" class="grid grid-cols-1 sm:grid-cols-2" :class="compact ? 'gap-1.5' : 'gap-3'">
      <div v-for="(item, index) in summaryItems" :key="index" class="flex items-center gap-2.5">
        <template v-if="item.isPremium">
          <span
            class="badge-premium bg-amber-50 text-amber-700 border-amber-100 flex-shrink-0 text-[10px] py-0.5 font-black uppercase tracking-tight"
          >
            <span
              v-for="(part, pIdx) in item.parts"
              :key="pIdx"
              :class="{ 'cursor-pointer hover:text-amber-900 transition-colors': !!part.actionId }"
              @click="scrollToAction(part.actionId)"
            >
              {{ part.text }}
            </span>
          </span>
        </template>
        <template v-else>
          <div class="w-1 h-1 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.4)]"></div>
          <span class="text-[11px] font-bold text-slate-700 tracking-tight leading-tight">
            <span
              v-for="(part, pIdx) in item.parts"
              :key="pIdx"
              :class="{
                'cursor-pointer hover:text-amber-600 transition-colors underline decoration-amber-400/30 underline-offset-2':
                  !!part.actionId,
              }"
              @click="scrollToAction(part.actionId)"
            >
              {{ part.text }}
            </span>
          </span>
        </template>
      </div>
    </div>
    <div
      v-else
      class="flex flex-col items-center bg-slate-50/50 rounded-xl border border-dashed border-slate-100"
      :class="compact ? 'py-2' : 'py-4'"
    >
      <span class="text-[11px] text-slate-400 italic font-medium"
        >No research purchased in this {{ hideHeader ? 'date range' : 'shift' }}</span
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Action, BuyResearchPayload } from '@/types';
import { getResearchById, getResearchByTier } from '@/calculations/commonResearch';
import { formatGemPrice, formatNumber } from '@/lib/format';
import { scrollToAndHighlight } from '@/lib/scrollToAndHighlight';
import { iconURL } from 'lib';

import { useActionsStore } from '@/stores/actions';

const props = defineProps<{
  headerAction: Action;
  actions: Action[];
  compact?: boolean;
  hideHeader?: boolean;
}>();

const emit = defineEmits<{
  // Fired instead of scrolling directly when the target action isn't in the DOM yet —
  // e.g. it's inside a collapsed day in compact view. The ancestor ActionGroup is
  // responsible for expanding the containing day and retrying the scroll.
  'scroll-to-action': [actionId: string];
}>();

const actionsStore = useActionsStore();

const startState = computed(() => props.headerAction.endState);
const endState = computed(() => {
  if (props.actions.length > 0) {
    return props.actions[props.actions.length - 1].endState;
  }
  return props.headerAction.endState;
});

const activeArtifactSet = computed(() => endState.value.activeArtifactSet);
const hourlyOfflineEarnings = computed(() => endState.value.offlineEarnings * 3600);
const hourlyELR = computed(() => endState.value.elr * 3600);

const totalResearchCost = computed(() => {
  return props.actions.reduce((acc, action) => {
    if (action.type === 'buy_research') {
      return acc + (action.cost || 0);
    }
    return acc;
  }, 0);
});

interface SummaryPart {
  text: string;
  actionId?: string;
}

interface SummaryItem {
  parts: SummaryPart[];
  isPremium?: boolean;
}

const scrollToAction = (actionId?: string) => {
  if (!actionId) return;
  if (document.getElementById(actionId)) {
    scrollToAndHighlight(actionId);
  } else {
    // Not rendered yet — most likely its day is collapsed in compact view. Ask the
    // ancestor ActionGroup to expand it, then retry.
    emit('scroll-to-action', actionId);
  }
};

const getFirstActionIdForResearch = (researchId: string) => {
  return props.actions.find(
    a => a.type === 'buy_research' && (a.payload as BuyResearchPayload).researchId === researchId
  )?.id;
};

const getLastActionIdForResearch = (researchId: string) => {
  const researchActions = props.actions.filter(
    a => a.type === 'buy_research' && (a.payload as BuyResearchPayload).researchId === researchId
  );
  return researchActions[researchActions.length - 1]?.id;
};

const getFirstActionIdForTier = (tier: number) => {
  return props.actions.find(a => {
    if (a.type !== 'buy_research') return false;
    const r = getResearchById((a.payload as BuyResearchPayload).researchId);
    return r?.tier === tier;
  })?.id;
};

const summaryItems = computed<SummaryItem[]>(() => {
  const items: SummaryItem[] = [];

  // 1. Identify modified researches and tiers involved in this block
  const modifiedResearchIds = new Set<string>();
  const modifiedTiers = new Set<number>();

  for (const action of props.actions) {
    if (action.type === 'buy_research') {
      const payload = action.payload as BuyResearchPayload;
      modifiedResearchIds.add(payload.researchId);

      const research = getResearchById(payload.researchId);
      if (research) {
        modifiedTiers.add(research.tier);
      }
    }
  }

  if (modifiedResearchIds.size === 0) return [];

  // 2. Identify fully maxed tiers (all items in tier meet max level in endState)
  // We only check tiers that we actually touched in this block.
  const maxedTiers: number[] = [];
  const handledResearchIds = new Set<string>();

  const sortedModifiedTiers = Array.from(modifiedTiers).sort((a, b) => a - b);
  const researchByTier = getResearchByTier();

  for (const tier of sortedModifiedTiers) {
    const tierResearches = researchByTier.get(tier) || [];
    // Check if EVERY research in this tier is maxed at the end state
    const isTierMaxed = tierResearches.every(r => {
      const level = endState.value.researchLevels[r.id] || 0;
      return level >= r.levels;
    });

    if (isTierMaxed) {
      // If reconciling and show incomplete only, hide tiers already maxed in backup
      const wasAlreadyMaxed =
        actionsStore.isReconciling &&
        actionsStore.showIncompleteOnly &&
        tierResearches.every(r => {
          const backupLevel = actionsStore.reconcileFarmState?.commonResearches[r.id] || 0;
          return backupLevel >= r.levels;
        });

      if (!wasAlreadyMaxed) {
        maxedTiers.push(tier);
      }
      // Mark all researches in this tier as handled so we don't list them individually
      tierResearches.forEach(r => handledResearchIds.add(r.id));
    }
  }

  // 3. Format maxed tiers (grouping contiguous ranges)
  if (maxedTiers.length > 0) {
    let rangeStart = maxedTiers[0];
    let prev = maxedTiers[0];

    // Loop through 1 to length; when i == length, curr is undefined, triggering the strictly "else" logic
    for (let i = 1; i <= maxedTiers.length; i++) {
      const curr = maxedTiers[i];
      if (curr === prev + 1) {
        prev = curr;
      } else {
        // End of range
        if (rangeStart === prev) {
          items.push({
            isPremium: true,
            parts: [
              { text: 'Max Tier ' },
              { text: rangeStart.toString(), actionId: getFirstActionIdForTier(rangeStart) },
            ],
          });
        } else {
          items.push({
            isPremium: true,
            parts: [
              { text: 'Max Tiers ' },
              { text: `${rangeStart}-${prev}`, actionId: getFirstActionIdForTier(rangeStart) },
            ],
          });
        }
        rangeStart = curr;
        prev = curr;
      }
    }
  }

  // 4. Process remaining modified researches (those not in a fully maxed tier)
  const remainingResearches = Array.from(modifiedResearchIds)
    .filter(id => !handledResearchIds.has(id))
    .map(id => getResearchById(id)!)
    .sort((a, b) => a.serial_id - b.serial_id); // Sort by order in game

  for (const r of remainingResearches) {
    let startLevel = startState.value.researchLevels[r.id] || 0;
    const finalLevel = endState.value.researchLevels[r.id] || 0;

    // If reconciling and show incomplete only, use backup level as start
    if (actionsStore.isReconciling && actionsStore.showIncompleteOnly) {
      const backupLevel = actionsStore.reconcileFarmState?.commonResearches[r.id] || 0;
      startLevel = Math.max(startLevel, backupLevel);
    }

    // Skip if already purchased beyond or at parity with plan's end of shift
    if (startLevel >= finalLevel) {
      continue;
    }

    const isMaxed = finalLevel >= r.levels;

    if (isMaxed) {
      items.push({
        parts: [{ text: 'Max ' }, { text: r.name, actionId: getFirstActionIdForResearch(r.id) }],
      });
    } else {
      items.push({
        parts: [
          { text: `${r.name} (` },
          { text: startLevel.toString(), actionId: getFirstActionIdForResearch(r.id) },
          { text: ' -> ' },
          { text: finalLevel.toString(), actionId: getLastActionIdForResearch(r.id) },
          { text: ')' },
        ],
      });
    }
  }

  return items;
});
</script>
