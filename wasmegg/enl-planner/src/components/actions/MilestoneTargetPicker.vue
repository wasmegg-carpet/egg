<template>
  <div class="flex flex-col gap-2 mb-3" ref="containerRef">
    <div class="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Milestone Target</div>
    <div class="relative">
      <button
        @click="open = !open"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg shadow-inner hover:bg-gray-200 transition-colors"
      >
        <template v-if="kind === 'tier' && nextLockedTier != null">
          <div class="w-7 h-7 flex items-center justify-center shrink-0 rounded bg-blue-100 text-blue-600">
            <LockOpenIcon class="w-4 h-4" />
          </div>
          <span class="flex-1 text-left truncate">Unlock Tier {{ nextLockedTier }}</span>
        </template>
        <template v-else-if="selectedResearch">
          <img
            :src="iconURL(getResearchIconPath(selectedResearch.research.id), 64)"
            class="w-7 h-7 object-contain shrink-0"
            :alt="selectedResearch.research.name"
          />
          <span class="flex-1 text-left truncate"
            >{{ selectedResearch.research.name }} (Lv {{ selectedResearch.currentLevel + 1 }}/{{
              selectedResearch.research.levels
            }})</span
          >
        </template>
        <span v-else class="flex-1 text-left text-gray-400">Select a milestone</span>
        <ChevronDownIcon class="w-4 h-4 text-gray-400 shrink-0 transition-transform" :class="{ 'rotate-180': open }" />
      </button>

      <div
        v-if="open"
        class="absolute z-10 mt-1 w-full max-h-80 overflow-y-auto py-1 bg-white rounded-lg shadow-lg border border-gray-100"
      >
        <button
          v-if="nextLockedTier != null"
          @click="selectTier"
          class="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
          :class="kind === 'tier' ? 'bg-blue-50' : 'hover:bg-gray-50'"
        >
          <div class="w-7 h-7 flex items-center justify-center shrink-0 rounded bg-blue-100 text-blue-600">
            <LockOpenIcon class="w-4 h-4" />
          </div>
          <div class="min-w-0">
            <div class="text-[13px] font-bold" :class="kind === 'tier' ? 'text-blue-600' : 'text-gray-900'">
              Unlock Tier {{ nextLockedTier }}
            </div>
            <div class="text-[10px] text-gray-400">Fastest ROI-optimal path to unlock the next tier.</div>
          </div>
        </button>

        <button
          v-for="option in researchOptions"
          :key="option.research.id"
          @click="selectResearch(option.research.id)"
          class="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
          :class="kind === 'research' && researchSelection === option.research.id ? 'bg-blue-50' : 'hover:bg-gray-50'"
        >
          <img
            :src="iconURL(getResearchIconPath(option.research.id), 64)"
            class="w-7 h-7 object-contain shrink-0"
            :alt="option.research.name"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <span
                class="text-[13px] font-bold truncate"
                :class="kind === 'research' && researchSelection === option.research.id ? 'text-blue-600' : 'text-gray-900'"
              >
                {{ option.research.name }}
              </span>
              <span class="text-[10px] font-medium text-gray-400 whitespace-nowrap shrink-0">
                Lv {{ option.currentLevel + 1 }}/{{ option.research.levels }}
              </span>
            </div>
            <div class="text-[10px] text-gray-400 leading-snug">{{ option.research.description }}</div>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { ChevronDownIcon, LockOpenIcon } from '@heroicons/vue/solid';
import { type CommonResearch } from '@/calculations/commonResearch';
import { type MilestoneTarget } from '@/composables/useResearchViews';
import { getResearchIconPath } from '@/lib/assets';
import { iconURL } from 'lib';

interface ResearchOption {
  research: CommonResearch;
  currentLevel: number;
}

const props = defineProps<{
  modelValue: MilestoneTarget | null;
  nextLockedTier: number | null;
  researchOptions: ResearchOption[];
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: MilestoneTarget | null): void;
}>();

const open = ref(false);
const containerRef = ref<HTMLElement | null>(null);

const kind = ref<'tier' | 'research'>(props.modelValue?.kind ?? (props.nextLockedTier != null ? 'tier' : 'research'));
const researchSelection = ref<string | null>(props.modelValue?.kind === 'research' ? props.modelValue.researchId : null);

const selectedResearch = computed(() => props.researchOptions.find(option => option.research.id === researchSelection.value));

function selectTier() {
  kind.value = 'tier';
  open.value = false;
}

function selectResearch(id: string) {
  kind.value = 'research';
  researchSelection.value = id;
  open.value = false;
}

const derivedTarget = computed<MilestoneTarget | null>(() => {
  if (kind.value === 'tier') {
    return props.nextLockedTier != null ? { kind: 'tier', tier: props.nextLockedTier } : null;
  }
  const research = selectedResearch.value;
  return research ? { kind: 'research', researchId: research.research.id, targetLevel: research.currentLevel + 1 } : null;
});

watch(derivedTarget, value => emit('update:modelValue', value), { immediate: true });

function handleClickOutside(event: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
    open.value = false;
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    open.value = false;
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside);
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside);
  document.removeEventListener('keydown', handleKeydown);
});
</script>
