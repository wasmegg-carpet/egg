<template>
  <div class="space-y-4">
    <!-- Wait for Population Section -->
    <div
      class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md"
    >
      <button
        class="w-full px-5 py-4 bg-slate-50/50 flex justify-between items-center hover:bg-white transition-colors group"
        @click="populationExpanded = !populationExpanded"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-1.5 group-hover:scale-110 transition-transform"
          >
            <img
              :src="iconURL('egginc/egg_enlightenment.png', 64)"
              class="w-full h-full object-contain"
            />
          </div>
          <h3 class="font-black text-[10px] uppercase tracking-[0.2em] text-slate-500">Wait for Population</h3>
        </div>
        <svg
          class="w-5 h-5 text-slate-300 transition-transform duration-300"
          :class="{ 'rotate-180 text-slate-900': populationExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-show="populationExpanded" class="p-6 border-t border-slate-50">
        <WaitForPopulationActions ref="populationActionsRef" />
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

    <!-- Wait for Bocks Section -->
    <div
      class="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md"
    >
      <button
        class="w-full px-5 py-4 bg-slate-50/50 flex justify-between items-center hover:bg-white transition-colors group"
        @click="bocksExpanded = !bocksExpanded"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-8 h-8 rounded-xl bg-white border border-slate-200/50 shadow-sm flex items-center justify-center p-1.5 group-hover:scale-110 transition-transform"
          >
            <img :src="iconURL('egginc/icon_bock.png', 64)" class="w-full h-full object-contain" />
          </div>
          <h3 class="font-black text-[10px] uppercase tracking-[0.2em] text-slate-500">Wait for Bocks</h3>
        </div>
        <svg
          class="w-5 h-5 text-slate-300 transition-transform duration-300"
          :class="{ 'rotate-180 text-slate-900': bocksExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-show="bocksExpanded" class="p-6 border-t border-slate-50">
        <WaitForCashActions ref="bocksActionsRef" />
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
import { ref, watch, nextTick } from 'vue';
import { iconURL } from 'lib';
import WaitForPopulationActions from './WaitForPopulationActions.vue';
import WaitForMissionsActions from './WaitForMissionsActions.vue';
import WaitForTimeActions from './WaitForTimeActions.vue';
import WaitForFullHabsActions from './WaitForFullHabsActions.vue';
import WaitForCashActions from './WaitForCashActions.vue';
import WaitWithoutEarningsActions from './WaitWithoutEarningsActions.vue';
import WaitForEventActions from './WaitForEventActions.vue';



const populationExpanded = ref(false);
const habsExpanded = ref(false);
const missionsExpanded = ref(false);
const bocksExpanded = ref(false);
const timeExpanded = ref(false);
const noEarningsExpanded = ref(false);
const eventsExpanded = ref(false);

const populationActionsRef = ref<InstanceType<typeof WaitForPopulationActions> | null>(null);
const bocksActionsRef = ref<InstanceType<typeof WaitForCashActions> | null>(null);
const timeActionsRef = ref<InstanceType<typeof WaitForTimeActions> | null>(null);
const noEarningsActionsRef = ref<InstanceType<typeof WaitWithoutEarningsActions> | null>(null);

watch(populationExpanded, val => { if (val) nextTick(() => populationActionsRef.value?.focus()); });
watch(bocksExpanded, val => { if (val) nextTick(() => bocksActionsRef.value?.focus()); });
watch(timeExpanded, val => { if (val) nextTick(() => timeActionsRef.value?.focus()); });
watch(noEarningsExpanded, val => { if (val) nextTick(() => noEarningsActionsRef.value?.focus()); });
</script>
