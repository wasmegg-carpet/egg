<template>
  <!-- Virtue Progress (collapsible) -->
  <div class="section-premium overflow-hidden">
    <button
      class="w-full px-5 py-3 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center hover:bg-slate-100 transition-colors group"
      @click="truthEggsExpanded = !truthEggsExpanded"
    >
      <div class="flex items-center gap-3">
        <div class="p-1.5 bg-white rounded-lg shadow-sm group-hover:scale-110 transition-transform">
          <img :src="iconURL('egginc/egg_truth.png', 64)" class="w-5 h-5 object-contain" alt="Truth Egg" />
        </div>
        <h3 class="style-guide-label mb-0">Virtue Progress</h3>
      </div>
      <div class="flex items-center gap-4">
        <div class="px-2 py-0.5 bg-brand-primary/10 rounded-full">
          <span class="text-[10px] font-black text-slate-900 uppercase tracking-widest leading-none">
            {{ totalTe }} <span class="opacity-50">/ 490</span> TE
          </span>
        </div>
        <svg
          class="w-4 h-4 text-slate-400 transition-transform duration-300"
          :class="{ 'rotate-180': truthEggsExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </button>
    <div v-if="truthEggsExpanded" class="p-5 space-y-6">
      <!-- Eggs of Truth (Total display) -->
      <div class="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 flex items-center justify-between">
        <div>
          <div class="text-sm font-bold text-slate-700">Total Eggs of Truth</div>
          <div class="text-[10px] uppercase font-black text-slate-400 tracking-wider">
            Multiplies IHR & Earnings by 1.1^TE
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="relative">
            <div class="text-lg font-mono-premium font-bold text-slate-900 px-3">{{ totalTe }}</div>
          </div>
          <span class="text-[10px] font-black text-slate-300 uppercase tracking-widest mt-1">Max: 490</span>
        </div>
      </div>

      <!-- Per-Egg TE Progress -->
      <div class="grid grid-cols-1 gap-3">
        <div
          v-for="egg in FUEL_ORDER"
          :key="egg"
          class="flex flex-col gap-3 p-3 bg-white hover:bg-slate-50 border border-slate-100 rounded-2xl transition-all group"
        >
          <div class="flex items-center gap-3">
            <div
              class="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center p-1.5 group-hover:bg-white group-hover:shadow-inner transition-all"
            >
              <img
                :src="iconURL(`egginc/egg_${egg}.png`, 64)"
                class="w-full h-full object-contain drop-shadow-sm"
                :alt="egg"
              />
            </div>
            <div class="text-xs font-bold text-slate-800 uppercase tracking-tight">
              {{ VIRTUE_EGG_NAMES[egg] }}
            </div>
          </div>
          <div class="flex-1 w-full">
            <div class="grid grid-cols-2 gap-3 w-full">
              <!-- Delivered -->
              <div class="flex flex-col gap-1">
                <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Delivered</span>
                <input
                  type="text"
                  :value="formatNumber(eggsDelivered[egg], 3)"
                  class="input-premium w-full text-right text-sm font-mono-premium font-bold text-slate-900"
                  placeholder="0"
                  @change="handleEggsDeliveredChange(egg, ($event.target as HTMLInputElement).value)"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                />
              </div>
              <!-- TE -->
              <div class="flex flex-col gap-1">
                <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest truncate">TE <span class="text-slate-300 font-bold ml-0.5">/ 98</span></span>
                <input
                  type="number"
                  :value="teEarned[egg]"
                  :min="0"
                  :max="98"
                  class="input-premium w-full text-right text-sm font-mono-premium font-bold text-slate-900"
                  @change="handleTEEarnedChange(egg, ($event.target as HTMLInputElement).value)"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Include Pending TE Button -->
      <div class="mt-4 flex justify-end">
        <button
          class="btn-premium btn-primary px-4 py-2 flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!hasData || totalPendingTe === 0"
          @click="$emit('include-pending-te')"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          <span
            >Include Pending TE <span v-if="totalPendingTe > 0">({{ totalPendingTe }})</span></span
          >
        </button>
      </div>
    </div>
  </div>

  <!-- Artifact Loadout -->
  <div class="section-premium overflow-visible">
    <div class="px-5 py-3 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center">
      <h3 class="style-guide-label mb-0">Artifact Sets</h3>
      <div v-if="hasArtifactSets" class="flex gap-1 bg-slate-200/50 p-1 rounded-xl">
        <button
          v-for="setName in ['earnings', 'elr'] as const"
          :key="setName"
          class="px-4 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all"
          :class="[
            activeSetTab === setName
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700 hover:bg-white/50',
          ]"
          @click="activeSetTab = setName"
        >
          {{ setName }}
        </button>
      </div>
    </div>
    <div class="p-4">
      <div v-if="activeSetTab === 'earnings' && clothedTe !== null" class="mt-4 flex justify-between items-center px-1">
        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Clothed TE</span>
        <span class="text-sm font-mono-premium font-bold text-slate-900">{{ Math.round(clothedTe) }}</span>
      </div>
      <template v-if="!hasArtifactSets">
        <div class="mb-4">
          <ArtifactSelector
            :model-value="artifactLoadout"
            :slot-count="artifactSlotCount(proPermit)"
            @update:model-value="$emit('update:artifact-loadout', $event)"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <button
            class="btn-premium btn-primary py-2 text-[10px] font-black uppercase tracking-widest"
            @click="$emit('save-current-to-set', 'earnings')"
          >
            Save as Earnings
          </button>
          <button
            class="btn-premium btn-primary py-2 text-[10px] font-black uppercase tracking-widest"
            @click="$emit('save-current-to-set', 'elr')"
          >
            Save as Delivery
          </button>
        </div>
      </template>
      <template v-else>
        <div v-if="activeSetTab === 'earnings'">
          <ArtifactSelector
            :model-value="artifactSets.earnings || createEmptyLoadout()"
            :slot-count="artifactSlotCount(proPermit)"
            @update:model-value="$emit('update-artifact-set', 'earnings', $event)"
          />
        </div>
        <div v-if="activeSetTab === 'elr'">
          <ArtifactSelector
            :model-value="artifactSets.elr || createEmptyLoadout()"
            :slot-count="artifactSlotCount(proPermit)"
            @update:model-value="$emit('update-artifact-set', 'elr', $event)"
          />
        </div>
        <div v-if="activeArtifactSet !== activeSetTab" class="mt-4 flex justify-end">
          <button
            class="btn-premium btn-secondary py-1.5 px-4 text-[10px] font-black uppercase tracking-widest"
            @click="$emit('set-active-artifact-set', activeSetTab)"
          >
            Equip as Active
          </button>
        </div>
        <div
          v-else
          class="mt-4 flex justify-end items-center gap-3 bg-brand-primary/5 p-2 rounded-xl border border-brand-primary/10"
        >
          <div class="w-2 h-2 rounded-full bg-brand-primary animate-pulse"></div>
          <span class="text-[10px] font-black text-slate-900 uppercase tracking-widest"
            >Currently Active Loadout</span
          >
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { iconURL } from 'lib';
import type { ArtifactSetName, VirtueEgg } from '@/types';
import { VIRTUE_EGG_NAMES } from '@/types';
import type { EquippedArtifact } from '@/lib/artifacts';
import { createEmptyLoadout, artifactSlotCount } from '@/lib/artifacts';
import { FUEL_ORDER } from '@/stores/fuelTank';
import { formatNumber, parseNumber } from '@/lib/format';
import ArtifactSelector from 'ui/components/planners/ArtifactSelector.vue';

const props = defineProps<{
  hasData: boolean;
  artifactLoadout: EquippedArtifact[];
  proPermit: boolean;
  eggsDelivered: Record<VirtueEgg, number>;
  teEarned: Record<VirtueEgg, number>;
  tePending: Record<VirtueEgg, number>;
  totalTe: number;
  artifactSets: Record<ArtifactSetName, EquippedArtifact[] | null>;
  activeArtifactSet: ArtifactSetName | null;
  clothedTe: number | null;
}>();

const emit = defineEmits<{
  'update:artifact-loadout': [loadout: EquippedArtifact[]];
  'set-eggs-delivered': [egg: VirtueEgg, amount: number];
  'set-te-earned': [egg: VirtueEgg, count: number];
  'include-pending-te': [];
  'update-artifact-set': [setName: ArtifactSetName, loadout: EquippedArtifact[]];
  'save-current-to-set': [setName: ArtifactSetName];
  'set-active-artifact-set': [setName: ArtifactSetName];
}>();

const truthEggsExpanded = ref(true);
const activeSetTab = ref<ArtifactSetName>(props.activeArtifactSet || 'earnings');

// Keep tab in sync with active set (important for imports)
watch(
  () => props.activeArtifactSet,
  newVal => {
    if (newVal) {
      activeSetTab.value = newVal;
    }
  }
);

const hasArtifactSets = computed(() => props.artifactSets.earnings || props.artifactSets.elr);

// Total pending TE
const totalPendingTe = computed(() => Object.values(props.tePending).reduce((sum, val) => sum + val, 0));

function handleEggsDeliveredChange(egg: VirtueEgg, inputValue: string) {
  const parsed = parseNumber(inputValue);
  if (parsed !== null && !isNaN(parsed)) {
    emit('set-eggs-delivered', egg, parsed);
  }
}

function handleTEEarnedChange(egg: VirtueEgg, inputValue: string) {
  const value = parseInt(inputValue);
  if (!isNaN(value)) {
    emit('set-te-earned', egg, value);
  }
}
</script>
