<template>
  <div class="space-y-4">
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
      <ArtifactActions v-if="activeTab === 'artifacts'" />
      <SiloActions v-if="activeTab === 'silos'" />
      <FuelTankActions v-if="activeTab === 'fuel'" />
      <WaitActions v-if="activeTab === 'wait'" />
      <RocketActions v-if="activeTab === 'rockets'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import VehicleActions from './actions/VehicleActions.vue';
import HabActions from './actions/HabActions.vue';
import ResearchActions from './actions/ResearchActions.vue';
import ArtifactActions from './actions/ArtifactActions.vue';
import SiloActions from './actions/SiloActions.vue';
import FuelTankActions from './actions/FuelTankActions.vue';
import WaitActions from './actions/WaitActions.vue';
import RocketActions from './actions/RocketActions.vue';
import InitialStateContainer from './containers/InitialStateContainer.vue';

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
  nextTick(checkScroll);
});

onUnmounted(() => {
  window.removeEventListener('resize', checkScroll);
});

defineEmits<{
  'refresh-backup': [];
}>();

// An enlightenment farm has no shifts: every action is available at any time.
const availableTabs = [
  { id: 'initial', label: 'Initial State' },
  { id: 'research', label: 'Research' },
  { id: 'habs', label: 'Habs' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'silos', label: 'Silos' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'fuel', label: 'Tank' },
  { id: 'rockets', label: 'Rockets' },
  { id: 'wait', label: 'Wait' },
] as const;

type TabId = (typeof availableTabs)[number]['id'];

const activeTab = ref<TabId>('initial');

// Auto-apply any staged start time changes before navigating away from the Initial State tab
watch(activeTab, (newTab, oldTab) => {
  if (oldTab === 'initial' && newTab !== oldTab) {
    initialStateContainerRef.value?.applyPendingAscensionChanges();
  }
});
</script>
