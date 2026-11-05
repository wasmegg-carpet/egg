<template>
  <div class="space-y-4">
    <!-- Current Egg Indicator -->
    <div
      class="hidden sm:flex items-center gap-2 text-sm p-2 rounded-lg border transition-colors"
      :class="isEditingPastGroup ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100'"
    >
      <span
        class="text-[10px] font-bold uppercase tracking-widest px-1"
        :class="isEditingPastGroup ? 'text-blue-500' : 'text-gray-400'"
      >
        {{ isEditingPastGroup ? 'Editing' : 'Current Egg' }}
      </span>
      <div class="flex items-center gap-2 bg-white px-2 py-1 rounded-full border border-gray-200 shadow-sm">
        <div class="w-5 h-5 flex-shrink-0">
          <img
            :src="iconURL(`egginc/egg_${effectiveEgg}.png`, 64)"
            class="w-full h-full object-contain"
            :alt="effectiveEgg"
          />
        </div>
        <span class="text-xs font-bold" :class="eggTextColorClass">
          {{ currentEggName }}
        </span>
      </div>
      <span class="text-gray-300 mx-1">/</span>
      <span class="text-xs font-semibold text-gray-500 tracking-tight">{{ availableActionLabel }}</span>
    </div>

    <!-- Tab buttons -->
    <div class="relative border-b border-gray-200">
      <div 
        ref="tabsContainer"
        class="flex gap-1 overflow-x-auto flex-nowrap [&::-webkit-scrollbar]:hidden"
        style="scrollbar-width: none;"
        @scroll="checkScroll"
      >
        <button
          v-for="tab in availableTabs"
          :key="tab.id"
          class="px-4 py-2 text-sm font-medium transition-colors relative whitespace-nowrap shrink-0"
          :class="activeTab === tab.id ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
          <span v-if="activeTab === tab.id" class="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
        </button>
      </div>

      <!-- Scroll Overflow Indicators -->
      <div
        v-if="canScrollLeft"
        class="absolute left-0 top-0 bottom-0 w-8 pointer-events-none bg-gradient-to-r from-white to-transparent"
      />
      <div
        v-if="canScrollRight"
        class="absolute right-0 top-0 bottom-0 w-8 pointer-events-none bg-gradient-to-l from-white to-transparent"
      />
    </div>

    <!-- Tab content -->
    <div class="min-h-[200px]">
      <InitialStateContainer v-if="activeTab === 'initial'" ref="initialStateContainerRef" />
      <VehicleActions v-if="activeTab === 'vehicles'" />
      <HabActions v-if="activeTab === 'habs'" />
      <ResearchActions v-if="activeTab === 'research'" @refresh-backup="$emit('refresh-backup')" />
      <ShiftActions v-if="activeTab === 'shift'" />
      <ArtifactActions v-if="activeTab === 'artifacts'" />
      <SiloActions v-if="activeTab === 'silos'" />
      <FuelTankActions v-if="activeTab === 'fuel'" />
      <WaitActions v-if="activeTab === 'wait'" />
      <RocketActions v-if="activeTab === 'rockets'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { iconURL } from 'lib';
import VehicleActions from './actions/VehicleActions.vue';
import HabActions from './actions/HabActions.vue';
import ResearchActions from './actions/ResearchActions.vue';
import ShiftActions from './actions/ShiftActions.vue';
import ArtifactActions from './actions/ArtifactActions.vue';
import SiloActions from './actions/SiloActions.vue';
import FuelTankActions from './actions/FuelTankActions.vue';
import WaitActions from './actions/WaitActions.vue';
import RocketActions from './actions/RocketActions.vue';
import InitialStateContainer from './containers/InitialStateContainer.vue';
import { useActionsStore } from '@/stores/actions';
import { VIRTUE_EGG_NAMES, type VirtueEgg } from '@/types';

const actionsStore = useActionsStore();

const tabsContainer = ref<HTMLElement | null>(null);
const initialStateContainerRef = ref<InstanceType<typeof InitialStateContainer> | null>(null);
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

const checkScroll = () => {
  if (!tabsContainer.value) return;
  const { scrollLeft, scrollWidth, clientWidth } = tabsContainer.value;
  canScrollLeft.value = scrollLeft > 0;
  canScrollRight.value = Math.ceil(scrollLeft + clientWidth) < scrollWidth;
};

onMounted(() => {
  setTimeout(checkScroll, 50);
  window.addEventListener('resize', checkScroll);
});

onUnmounted(() => {
  window.removeEventListener('resize', checkScroll);
});

defineEmits<{
  'refresh-backup': [];
}>();

// Check if any shifts have been made
const hasShifts = computed(() => {
  return actionsStore.actions.some(action => action.type === 'shift');
});

// Check if we're editing a past group
const isEditingPastGroup = computed(() => actionsStore.editingGroupId !== null);

// Check if we're specifically editing the first group (start_ascension)
const isEditingStartGroup = computed(() => {
  const startAction = actionsStore.getStartAction();
  return actionsStore.editingGroupId !== null && actionsStore.editingGroupId === startAction?.id;
});

// The effective egg to use (from effective snapshot when editing, otherwise current)
const effectiveEgg = computed(() => actionsStore.effectiveSnapshot?.currentEgg ?? 'curiosity');

// All available tabs
const allTabs = [
  { id: 'initial', label: 'Initial State', egg: null, beforeShiftsOnly: true },
  { id: 'research', label: 'Research', egg: 'curiosity' as VirtueEgg, beforeShiftsOnly: false },
  { id: 'habs', label: 'Habs', egg: 'integrity' as VirtueEgg, beforeShiftsOnly: false },
  { id: 'vehicles', label: 'Vehicles', egg: 'kindness' as VirtueEgg, beforeShiftsOnly: false },
  { id: 'artifacts', label: 'Artifacts', egg: 'humility' as VirtueEgg, beforeShiftsOnly: false },
  { id: 'silos', label: 'Silos', egg: 'resilience' as VirtueEgg, beforeShiftsOnly: false },
  { id: 'fuel', label: 'Tank', egg: null, beforeShiftsOnly: false },
  { id: 'wait', label: 'Wait', egg: null, beforeShiftsOnly: false },
  { id: 'rockets', label: 'Rockets', egg: 'humility' as VirtueEgg, beforeShiftsOnly: false },
  { id: 'shift', label: 'Shift', egg: null, beforeShiftsOnly: false },
] as const;

type TabId = (typeof allTabs)[number]['id'];

// Map egg to its action tab
const eggToTab: Record<VirtueEgg, TabId> = {
  curiosity: 'research',
  integrity: 'habs',
  kindness: 'vehicles',
  humility: 'artifacts',
  resilience: 'silos',
};

// Map egg to action label
const eggToActionLabel: Record<VirtueEgg, string> = {
  curiosity: 'Research available',
  integrity: 'Habs available',
  kindness: 'Vehicles available',
  humility: 'Artifacts available',
  resilience: 'Silos available',
};

// Current egg display (uses effective egg when editing past group)
const currentEggName = computed(() => VIRTUE_EGG_NAMES[effectiveEgg.value]);
const availableActionLabel = computed(() => eggToActionLabel[effectiveEgg.value]);

const eggTextColorClass = computed(() => {
  switch (effectiveEgg.value) {
    case 'curiosity':
      return 'text-purple-600';
    case 'integrity':
      return 'text-blue-600';
    case 'kindness':
      return 'text-pink-600';
    case 'resilience':
      return 'text-orange-600';
    case 'humility':
      return 'text-green-600';
  }
});

// Filter tabs based on effective egg and shift state
const availableTabs = computed(() => {
  return allTabs.filter(tab => {
    // Initial state tab is available before the first shift OR when editing the start group
    if (tab.beforeShiftsOnly) return (!hasShifts.value && !isEditingPastGroup.value) || isEditingStartGroup.value;
    // Shift/fuel/te are always available (egg === null)
    if (tab.egg === null) return true;
    // Only show the tab for the effective egg
    return tab.egg === effectiveEgg.value;
  });
});

watch(availableTabs, () => {
  nextTick(checkScroll);
}, { deep: true });

// Active tab - defaults to initial if no shifts or if editing the start group
const activeTab = ref<TabId>(
  hasShifts.value && !isEditingStartGroup.value
    ? effectiveEgg.value === 'humility'
      ? 'wait'
      : eggToTab[effectiveEgg.value]
    : 'initial'
);

// Auto-apply any staged Ascension Start changes before navigating away from the Initial State tab
watch(activeTab, (newTab, oldTab) => {
  if (oldTab === 'initial' && newTab !== oldTab) {
    initialStateContainerRef.value?.applyPendingAscensionChanges();
  }
});

// When effective egg changes (including when editing state changes), switch to that egg's tab
watch(effectiveEgg, newEgg => {
  // If we just switched to editing the start group, default to 'initial'
  // otherwise default to the egg's tab.
  activeTab.value = isEditingStartGroup.value ? 'initial' : eggToTab[newEgg];
});

// Watch isEditingStartGroup specifically to handle switching when eggs are same
watch(isEditingStartGroup, editingStart => {
  if (editingStart) {
    activeTab.value = 'initial';
  } else if (!actionsStore.editingGroupId && hasShifts.value && activeTab.value === 'initial') {
    // Left edit mode and back to head where initial is hidden
    activeTab.value = eggToTab[effectiveEgg.value];
  }
});

// When shifts state changes, switch away from initial tab if needed
watch(hasShifts, hasShiftsNow => {
  if (hasShiftsNow && activeTab.value === 'initial' && !isEditingStartGroup.value) {
    activeTab.value = eggToTab[effectiveEgg.value];
  }
});
</script>
