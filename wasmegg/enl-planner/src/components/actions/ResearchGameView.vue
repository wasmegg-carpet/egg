<template>
  <div class="space-y-4">
    <div
      v-for="tier in tiers"
      :key="tier"
      class="border border-gray-200 rounded-lg overflow-hidden transition-all duration-300"
    >
      <!-- Tier Header -->
      <div class="px-4 py-2 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
        <div class="flex items-center gap-2 flex-1 cursor-pointer" @click="toggleTier(tier)">
          <span class="font-medium text-gray-900">Tier {{ tier }}</span>
          <span
            v-if="!tierSummaries[tier]?.isUnlocked"
            class="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold uppercase tracking-wide shadow-sm"
          >
            Locked ({{ tierSummaries[tier]?.purchasesNeeded ?? '?' }} more)
          </span>
          <span v-else class="text-[10px] text-gray-400 font-medium uppercase">
            {{ tierSummaries[tier]?.purchasedLevels ?? 0 }} / {{ tierSummaries[tier]?.totalLevels ?? 0 }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <!-- Max Tier button -->
          <button
            v-if="tierSummaries[tier]?.isUnlocked && !isTierMaxed(tier)"
            class="btn-premium text-xs py-1 px-2"
            :class="isResearchSaleActive && (baseTimestamp / 1000 + viewTimes.tierSeconds[tier] > researchSaleDeadline) ? 'btn-danger bg-amber-500 hover:bg-amber-600 border-amber-600' : 'btn-secondary'"
            @click.stop="$emit('max-tier', tier)"
            v-tippy="deadlineWarningTooltip(viewTimes.tierSeconds[tier])"
          >
            Max Tier
            <span v-if="viewTimes.tiers[tier]" class="ml-1 text-[9px] opacity-70">({{ viewTimes.tiers[tier] }})</span>
          </button>
          <svg
            class="w-5 h-5 text-gray-400 transition-transform cursor-pointer"
            :class="{ 'rotate-180': expandedTiers.has(tier) }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            @click="toggleTier(tier)"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <!-- Tier Research List -->
      <div v-if="expandedTiers.has(tier)" class="divide-y divide-gray-100 bg-white">
        <ResearchItem
          v-for="research in getResearchesForTier(tier)"
          :key="research.id"
          :research="research"
          :current-level="levels[research.id] || 0"
          :price="getResearchPrice(research)"
          :during-sale="getResearchDuringSale(research)"
          :time-to-buy="getResearchTimeToBuy(research)"
          :time-to-buy-seconds="getResearchTimeToBuySeconds(research)"
          :can-buy="true"
          :is-maxed="(levels[research.id] || 0) >= research.levels"
          :show-deadline-warning="isResearchSaleActive && (baseTimestamp / 1000 + getResearchTimeToBuySeconds(research) > researchSaleDeadline)"
          :show-max="true"
          :max-time="viewTimes.researches[research.id]"
          :max-time-seconds="viewTimes.researchSeconds[research.id]"
          @buy="$emit('buy', research)"
          @max="$emit('max', research)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { type CommonResearch } from '@/calculations/commonResearch';
import ResearchItem from './ResearchItem.vue';
import { formatAbsoluteTime } from '@/lib/format';
import { useActionsStore } from '@/stores/actions';
import { useVirtueStore } from '@/stores/virtue';
import type { TierSummary } from '@/calculations/commonResearch';

const props = defineProps<{
  tiers: number[];
  researchByTier: Map<number, CommonResearch[]>;
  tierSummaries: Record<number, TierSummary>;
  viewTimes: {
    tiers: Record<number, string>;
    researches: Record<string, string>;
    tierSeconds: Record<number, number>;
    researchSeconds: Record<string, number>;
  };
  levels: Record<string, number>;
  getResearchPrice: (r: CommonResearch) => number;
  getResearchDuringSale: (r: CommonResearch) => boolean;
  getResearchTimeToBuy: (r: CommonResearch) => string;
  getResearchTimeToBuySeconds: (r: CommonResearch) => number;
  isResearchSaleActive: boolean;
  researchSaleDeadline: number;
}>();

defineEmits(['buy', 'max', 'max-tier']);

const EXPANDED_TIERS_STORAGE_KEY = 'ascension_research_expanded_tiers';

function loadStoredExpandedTiers(): Set<number> | null {
  const stored = localStorage.getItem(EXPANDED_TIERS_STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((t): t is number => typeof t === 'number'));
    }
  } catch {
    // ignore malformed storage
  }
  return null;
}

const storedExpandedTiers = loadStoredExpandedTiers();
const expandedTiers = ref(new Set<number>(storedExpandedTiers ?? []));
const autoExpanded = new Set<number>();

watch(
  expandedTiers,
  tiersSet => localStorage.setItem(EXPANDED_TIERS_STORAGE_KEY, JSON.stringify(Array.from(tiersSet))),
  { deep: true }
);

const actionsStore = useActionsStore();
const virtueStore = useVirtueStore();

const baseTimestamp = computed(() => {
  const startTime = virtueStore.planStartTime.getTime();
  const offset = actionsStore.planStartOffset;
  // Wall clock time = (Plan Start) + (Current Sim Time - Initial Sim Time)
  return startTime + (actionsStore.effectiveSnapshot.lastStepTime - offset) * 1000;
});

function isTierMaxed(tier: number): boolean {
  const summary = props.tierSummaries[tier];
  if (!summary) return true;
  return summary.purchasedLevels >= summary.totalLevels;
}

// Auto-expand any tier that is unlocked and has research available.
// We track autoExpanded to avoid re-expanding a tier the user manually collapsed.
// If expand/collapse state was restored from storage, tiers already unlocked at mount
// have already had their auto-expand decision made (respect the user's saved choice) —
// only tiers that unlock later this session should be auto-expanded.
watch(
  () => props.tierSummaries,
  summaries => {
    if (!summaries) return;
    for (const tier of props.tiers) {
      if (autoExpanded.has(tier)) continue;
      const summary = summaries[tier];
      if (storedExpandedTiers && summary?.isUnlocked) {
        autoExpanded.add(tier);
        continue;
      }
      if (summary?.isUnlocked && !isTierMaxed(tier)) {
        expandedTiers.value.add(tier);
        autoExpanded.add(tier);
      }
    }
  },
  { immediate: true }
);

function toggleTier(tier: number) {
  if (expandedTiers.value.has(tier)) {
    expandedTiers.value.delete(tier);
  } else {
    expandedTiers.value.add(tier);
    // If the user manually expands it, we should probably mark it as auto-expanded
    // to prevent any weird logic, though it shouldn't matter much.
    autoExpanded.add(tier);
  }
}

function getResearchesForTier(tier: number): CommonResearch[] {
  return props.researchByTier.get(tier) || [];
}

function deadlineWarningTooltip(seconds?: number) {
  if (seconds === undefined) return '';
  const timeStr = formatAbsoluteTime(seconds, baseTimestamp.value, virtueStore.ascensionTimezone);
  if (props.isResearchSaleActive && (baseTimestamp.value / 1000 + seconds > props.researchSaleDeadline)) {
    return `${timeStr} is after this sale ends (Saturday at +0). The price shown is what it will cost by then.`;
  }
  return timeStr;
}
</script>
