<template>
  <div class="space-y-4">
    <!-- Wait for TE Section -->
    <div
      class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md"
    >
      <button
        class="w-full px-5 py-4 bg-slate-50/50 flex justify-between items-center hover:bg-white transition-colors group"
        @click="teExpanded = !teExpanded"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-1.5 group-hover:scale-110 transition-transform"
          >
            <img
              :src="iconURL(`egginc/egg_${actionsStore.effectiveSnapshot.currentEgg}.png`, 64)"
              class="w-full h-full object-contain"
            />
          </div>
          <h3 class="font-black text-[10px] uppercase tracking-[0.2em] text-slate-500">Wait for TE</h3>
        </div>
        <svg
          class="w-5 h-5 text-slate-300 transition-transform duration-300"
          :class="{ 'rotate-180 text-slate-900': teExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-show="teExpanded" class="p-6 border-t border-slate-50">
        <WaitForTEActions ref="teActionsRef" />
      </div>
    </div>

    <!-- Bulk Wait for TE Section -->
    <div
      class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md"
    >
      <button
        class="w-full px-5 py-4 bg-slate-50/50 flex justify-between items-center hover:bg-white transition-colors group"
        @click="bulkTEExpanded = !bulkTEExpanded"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-1.5 group-hover:scale-110 transition-transform"
          >
            <img :src="iconURL('egginc/egg_truth.png', 64)" class="w-full h-full object-contain" />
          </div>
          <h3 class="font-black text-[10px] uppercase tracking-[0.2em] text-slate-500">Bulk Wait for TE</h3>
        </div>
        <svg
          class="w-5 h-5 text-slate-300 transition-transform duration-300"
          :class="{ 'rotate-180 text-slate-900': bulkTEExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-show="bulkTEExpanded" class="p-6 border-t border-slate-50">
        <BulkWaitForTEActions ref="bulkTEActionsRef" />
      </div>
    </div>


    <!-- Wait for Full Habs Section -->
    <div
      class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md"
    >
      <button
        class="w-full px-5 py-4 bg-slate-50/50 flex justify-between items-center hover:bg-white transition-colors group"
        @click="habsExpanded = !habsExpanded"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-1.5 group-hover:scale-110 transition-transform"
          >
            <img :src="iconURL('egginc/ei_hab_icon_chicken_universe.png', 64)" class="w-full h-full object-contain" />
          </div>
          <h3 class="font-black text-[10px] uppercase tracking-[0.2em] text-slate-500">Wait for Full Habs</h3>
        </div>
        <svg
          class="w-5 h-5 text-slate-300 transition-transform duration-300"
          :class="{ 'rotate-180 text-slate-900': habsExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-show="habsExpanded" class="p-6 border-t border-slate-50">
        <WaitForFullHabsActions />
      </div>
    </div>

    <!-- Wait for Missions Section -->
    <div
      v-if="isHumility"
      class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md"
    >
      <button
        class="w-full px-5 py-4 bg-slate-50/50 flex justify-between items-center hover:bg-white transition-colors group"
        @click="missionsExpanded = !missionsExpanded"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 bg-slate-900 rounded-xl flex items-center justify-center p-1.5 overflow-hidden shadow-lg group-hover:scale-110 transition-transform border border-slate-800"
          >
            <img :src="iconURL('egginc/icon_afx_mission.png', 64)" class="w-full h-full object-contain" />
          </div>
          <h3 class="font-black text-[10px] uppercase tracking-[0.2em] text-slate-500">Wait for Missions</h3>
        </div>
        <svg
          class="w-5 h-5 text-slate-300 transition-transform duration-300"
          :class="{ 'rotate-180 text-slate-900': missionsExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-show="missionsExpanded" class="p-6 border-t border-slate-50">
        <WaitForMissionsActions />
      </div>
    </div>

    <!-- Wait for Gems Section -->
    <div
      class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md"
    >
      <button
        class="w-full px-5 py-4 bg-slate-50/50 flex justify-between items-center hover:bg-white transition-colors group"
        @click="gemsExpanded = !gemsExpanded"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-1.5 group-hover:scale-110 transition-transform"
          >
            <img :src="iconURL('egginc/icon_virtue_gem.png', 64)" class="w-full h-full object-contain" />
          </div>
          <h3 class="font-black text-[10px] uppercase tracking-[0.2em] text-slate-500">Wait for Gems</h3>
        </div>
        <svg
          class="w-5 h-5 text-slate-300 transition-transform duration-300"
          :class="{ 'rotate-180 text-slate-900': gemsExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-show="gemsExpanded" class="p-6 border-t border-slate-50">
        <WaitForGemsActions ref="gemsActionsRef" />
      </div>
    </div>

    <!-- Wait for Time Section -->
    <div
      class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md"
    >
      <button
        class="w-full px-5 py-4 bg-slate-50/50 flex justify-between items-center hover:bg-white transition-colors group"
        @click="timeExpanded = !timeExpanded"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-1.5 group-hover:scale-110 transition-transform"
          >
            <img :src="iconURL('egginc/tiny_indicator_waiting.png', 64)" class="w-full h-full object-contain" />
          </div>
          <h3 class="font-black text-[10px] uppercase tracking-[0.2em] text-slate-500">Wait for Time</h3>
        </div>
        <svg
          class="w-5 h-5 text-slate-300 transition-transform duration-300"
          :class="{ 'rotate-180 text-slate-900': timeExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-show="timeExpanded" class="p-6 border-t border-slate-50">
        <WaitForTimeActions ref="timeActionsRef" />
      </div>
    </div>

    <!-- Wait WITHOUT Earnings Section -->
    <div
      class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md"
    >
      <button
        class="w-full px-5 py-4 bg-slate-50/50 flex justify-between items-center hover:bg-white transition-colors group"
        @click="noEarningsExpanded = !noEarningsExpanded"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-1.5 group-hover:scale-110 transition-transform"
          >
            <img :src="iconURL('egginc-extras/silo.png', 64)" class="w-full h-full object-contain" />
          </div>
          <h3 class="font-black text-[10px] uppercase tracking-[0.2em] text-slate-500">Wait with Empty Silos</h3>
        </div>
        <svg
          class="w-5 h-5 text-slate-300 transition-transform duration-300"
          :class="{ 'rotate-180 text-slate-900': noEarningsExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-show="noEarningsExpanded" class="p-6 border-t border-slate-50">
        <WaitWithoutEarningsActions ref="noEarningsActionsRef" />
      </div>
    </div>

    <!-- Wait for Events Section (Social/Fixed) -->
    <div
      class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md"
    >
      <button
        class="w-full px-5 py-4 bg-slate-50/50 flex justify-between items-center hover:bg-white transition-colors group"
        @click="eventsExpanded = !eventsExpanded"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-1.5 group-hover:scale-110 transition-transform"
          >
            <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h3 class="font-black text-[10px] uppercase tracking-[0.2em] text-slate-500">Wait for Events</h3>
        </div>
        <svg
          class="w-5 h-5 text-slate-300 transition-transform duration-300"
          :class="{ 'rotate-180 text-slate-900': eventsExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-show="eventsExpanded" class="p-6 border-t border-slate-50">
        <WaitForEventActions />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { iconURL } from 'lib';
import { useActionsStore } from '@/stores/actions';
import WaitForTEActions from './WaitForTEActions.vue';
import BulkWaitForTEActions from './BulkWaitForTEActions.vue';
import WaitForMissionsActions from './WaitForMissionsActions.vue';
import WaitForTimeActions from './WaitForTimeActions.vue';
import WaitForFullHabsActions from './WaitForFullHabsActions.vue';
import WaitForGemsActions from './WaitForGemsActions.vue';
import WaitWithoutEarningsActions from './WaitWithoutEarningsActions.vue';
import WaitForEventActions from './WaitForEventActions.vue';

const actionsStore = useActionsStore();

const isHumility = computed(() => actionsStore.effectiveSnapshot.currentEgg === 'humility');
const isCuriosity = computed(() => actionsStore.effectiveSnapshot.currentEgg === 'curiosity');

const teExpanded = ref(false);
const bulkTEExpanded = ref(false);
const habsExpanded = ref(false);
const missionsExpanded = ref(false);
const gemsExpanded = ref(false);
const timeExpanded = ref(false);
const noEarningsExpanded = ref(false);
const eventsExpanded = ref(false);

const teActionsRef = ref<InstanceType<typeof WaitForTEActions> | null>(null);
const bulkTEActionsRef = ref<InstanceType<typeof BulkWaitForTEActions> | null>(null);
const gemsActionsRef = ref<InstanceType<typeof WaitForGemsActions> | null>(null);
const timeActionsRef = ref<InstanceType<typeof WaitForTimeActions> | null>(null);
const noEarningsActionsRef = ref<InstanceType<typeof WaitWithoutEarningsActions> | null>(null);

watch(teExpanded, val => { if (val) nextTick(() => teActionsRef.value?.focus()); });
watch(bulkTEExpanded, val => { if (val) nextTick(() => bulkTEActionsRef.value?.focus()); });
watch(gemsExpanded, val => { if (val) nextTick(() => gemsActionsRef.value?.focus()); });
watch(timeExpanded, val => { if (val) nextTick(() => timeActionsRef.value?.focus()); });
watch(noEarningsExpanded, val => { if (val) nextTick(() => noEarningsActionsRef.value?.focus()); });
</script>
