<template>
  <div class="space-y-2">
    <div
      v-if="hasIgnoredArtifacts"
      class="px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-[11px] font-bold text-amber-800"
    >
      Standard permit: only {{ slotCount }} artifacts can be active. Slots {{ slotCount + 1 }}–{{ modelValue.length }}
      are kept but not counted.
    </div>
    <template v-for="(slot, slotIndex) in modelValue" :key="slotIndex">
      <!-- Past what the permit allows: shown, but read-only and not counted -->
      <div
        v-if="slotIndex >= slotCount"
        class="section-premium p-3 mb-2 flex items-center gap-2 bg-slate-50 border-dashed opacity-70"
        :aria-disabled="true"
      >
        <span
          class="text-[10px] font-black text-slate-400 w-5 h-5 flex items-center justify-center bg-white/50 rounded-full shadow-inner flex-shrink-0"
          >{{ slotIndex + 1 }}</span
        >
        <span v-if="slot.artifactId" class="text-[11px] font-bold text-slate-500 line-through truncate">
          {{ getArtifact(slot.artifactId)?.label }}
        </span>
        <span v-else class="text-[10px] text-gray-400 italic">Empty slot</span>
        <span
          class="ml-auto flex-shrink-0 whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-700"
        >
          Pro Permit only — ignored
        </span>
      </div>
      <div v-else class="section-premium p-3 mb-2 group-artifact" :style="getSlotBackgroundStyle(slot.artifactId)">
        <div class="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
          <div class="flex items-center gap-2">
            <span
              class="text-[10px] font-black text-slate-400 w-5 h-5 flex items-center justify-center bg-white/50 rounded-full shadow-inner"
              >{{ slotIndex + 1 }}</span
            >
          </div>

          <!-- Artifact Filterable Select -->
          <ArtifactSelect
            :model-value="slot.artifactId"
            placeholder="Select artifact..."
            :items="slotOptions(slotIndex)"
            :get-item-id="item => item.id"
            :get-item-display="item => item.label"
            :get-item-icon-path="item => item.iconPath"
            :item-from-id="id => getArtifact(id)!"
            :search-items="query => searchArtifacts(query, slotIndex)"
            :item-color-class="getArtifactColorClass"
            allow-clearing
            @update:model-value="onArtifactChange(slotIndex, $event || '')"
            class="flex-1"
          />
        </div>

        <!-- Artifact Effect Display & Stone Slots (stone slots only when stones are edited here) -->
        <div v-if="slot.artifactId" class="ml-8 space-y-3">
          <div
            class="badge-premium badge-brand bg-white/60 backdrop-blur-sm border border-brand-primary/10 text-[10px] py-1 px-3 flex items-center gap-2 max-w-fit"
          >
            <div class="w-1.5 h-1.5 rounded-full bg-brand-primary animate-pulse"></div>
            {{ getArtifact(slot.artifactId)?.effect }}
          </div>

          <!-- Stone Slots -->
          <div
            v-if="stones === 'edit' && getArtifact(slot.artifactId)?.slots"
            class="flex flex-wrap gap-6 p-2 bg-white/30 rounded-xl border border-white/40 shadow-inner"
          >
            <div v-for="stoneIndex in getArtifact(slot.artifactId)!.slots" :key="stoneIndex" class="group relative">
              <!-- Stone Filterable Select -->
              <StoneSelect
                :model-value="slot.stones[stoneIndex - 1]"
                placeholder=""
                :items="stoneOptions"
                :get-item-id="item => item.id"
                :get-item-display="item => item.label"
                :get-item-icon-path="item => item.iconPath"
                :item-from-id="id => getStone(id)!"
                :search-items="searchStones"
                :show-input-text="false"
                :show-placeholder-icon="false"
                :show-selector-icon="false"
                icon-container-class="absolute inset-y-0 w-full flex justify-center"
                input-padding-class="p-0"
                icon-class="h-7 w-7"
                container-class="w-8"
                dropdown-width-class="w-64 -left-28"
                allow-clearing
                @update:model-value="onStoneChange(slotIndex, stoneIndex - 1, $event || '')"
                :class="['stone-select-compact', { 'is-empty': !slot.stones[stoneIndex - 1] }]"
              />
              <!-- Slot name/tier tooltip on hover -->
              <div
                class="absolute -top-2 -right-2 bg-gray-800 text-white text-[8px] font-bold px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap"
              >
                {{ getStone(slot.stones[stoneIndex - 1])?.label || stoneIndex }}
              </div>
            </div>
          </div>
        </div>
        <div v-else class="ml-5 text-[10px] text-gray-400 italic">
          {{ stones === 'hidden' ? 'Empty slot' : 'Select an artifact to configure stones' }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { GenericBaseSelectFilterable } from 'ui/components/BaseSelectFilterable.vue';
import { rarityTint } from 'lib/planners/artifacts/display';
import {
  type EquippedArtifact,
  type ArtifactOption,
  type StoneOption,
  getArtifact,
  artifactOptions,
  stoneOptions,
  getStone,
} from '@/lib/artifacts';

const props = withDefaults(
  defineProps<{
    modelValue: EquippedArtifact[];
    /**
     * `edit` (default): a stone picker per socket. `hidden`: artifacts only — for callers whose
     * stones are handled elsewhere (the auto planner places them from its own stone pool).
     */
    stones?: 'edit' | 'hidden';
    /** The artifact family each slot may hold, by slot; a slot with none (or no list) takes any. */
    families?: (string | null)[];
    /** How many slots count: 4 with Pro permit, 2 with Standard. Later slots show as ignored. */
    slotCount?: number;
  }>(),
  { stones: 'edit', families: () => [], slotCount: 4 }
);

const hasIgnoredArtifacts = computed(() => props.modelValue.slice(props.slotCount).some(slot => slot.artifactId));

const emit = defineEmits<{
  'update:modelValue': [value: EquippedArtifact[]];
}>();

// Define components with generic types
const ArtifactSelect = GenericBaseSelectFilterable<ArtifactOption>();
const StoneSelect = GenericBaseSelectFilterable<StoneOption>();

const slotOptions = (slotIndex: number) => {
  const family = props.families[slotIndex];
  return family ? artifactOptions.filter(a => a.familyId === family) : artifactOptions;
};

const searchArtifacts = (query: string, slotIndex: number) => {
  const q = query.toLowerCase();
  return slotOptions(slotIndex).filter(
    a => a.label.toLowerCase().includes(q) || a.familyName.toLowerCase().includes(q)
  );
};

const searchStones = (query: string) => {
  const q = query.toLowerCase();
  return stoneOptions.filter(s => s.label.toLowerCase().includes(q) || s.familyName.toLowerCase().includes(q));
};

function onArtifactChange(slotIndex: number, artifactId: string) {
  const newValue = [...props.modelValue];
  const oldSlot = props.modelValue[slotIndex];
  const artifact = getArtifact(artifactId || null);
  const newSlotCount = artifact?.slots || 0;

  // Preserve as many stones as possible from the current slot
  let newStones = [...oldSlot.stones];

  if (newStones.length > newSlotCount) {
    // Keep stones from left to right, truncating from the right
    newStones = newStones.slice(0, newSlotCount);
  } else if (newStones.length < newSlotCount) {
    // Add empty slots if needed
    while (newStones.length < newSlotCount) {
      newStones.push(null);
    }
  }

  newValue[slotIndex] = {
    artifactId: artifactId || null,
    stones: newStones,
  };

  emit('update:modelValue', newValue);
}

function onStoneChange(slotIndex: number, stoneSlotIndex: number, stoneId: string) {
  const newValue = [...props.modelValue];
  const stones = [...newValue[slotIndex].stones];
  stones[stoneSlotIndex] = stoneId || null;

  newValue[slotIndex] = {
    ...newValue[slotIndex],
    stones,
  };

  emit('update:modelValue', newValue);
}

/**
 * Dropdown item tint by rarity (commons unchanged), matching `rarityTint`. Literal class names on
 * purpose: Tailwind only generates arbitrary-value classes it can find verbatim in source.
 */
function getArtifactColorClass(artifact: ArtifactOption): string {
  switch (artifact.rarity) {
    case 1:
      return 'bg-[#0D6DFD30]';
    case 2:
      return 'bg-[#FF00FF30]';
    case 3:
      return 'bg-[#FECD1B40]';
    default:
      return '';
  }
}

/** Slot background tint by rarity (commons white). */
function getSlotBackgroundStyle(artifactId: string | null): Record<string, string> {
  const artifact = getArtifact(artifactId);
  return { backgroundColor: artifact ? rarityTint(artifact.rarity) : 'white' };
}
</script>

<style scoped>
:deep(.stone-select-compact .Select__input) {
  height: 2rem !important;
  min-height: 2rem !important;
  padding: 0 !important;
  border-style: solid;
  transition: all 0.2s;
}

:deep(.stone-select-compact:not(.is-empty) .Select__input) {
  background-color: rgba(255, 255, 255, 0.5);
}

:deep(.stone-select-compact.is-empty .Select__input) {
  background-color: transparent;
  border-style: dashed;
  border-color: #cbd5e1; /* gray-300 */
}

:deep(.stone-select-compact .Select__input:hover) {
  border-color: #94a3b8; /* gray-400 */
  background-color: rgba(255, 255, 255, 0.8);
}

/* Move clear (X) icon to the right */
:deep(.stone-select-compact div.cursor-pointer) {
  right: -15px !important;
}
</style>
