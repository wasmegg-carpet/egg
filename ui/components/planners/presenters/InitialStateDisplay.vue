<template>
  <div class="space-y-4">
    <!-- Plan Settings -->
    <div class="section-premium p-5 overflow-hidden">
      <h3 class="style-guide-label mb-6">{{ PROFILE.planLabel }} Settings</h3>

      <div class="space-y-6">
        <!-- Start Time -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 md:flex-wrap">
          <div>
            <div class="text-sm font-bold text-slate-700">{{ PROFILE.planLabel }} Start</div>
            <div class="hidden md:block text-[10px] uppercase font-black text-slate-400 tracking-wider">When this journey begins</div>
          </div>
          <div class="flex flex-col md:flex-row md:items-center md:flex-wrap md:justify-end gap-2 w-full md:w-auto mt-1 md:mt-0">
            <DateTimeZonePicker
              v-model:date="localAscensionDate"
              v-model:time="localAscensionTime"
              v-model:timezone="localAscensionTimezone"
            />
            <button
              class="btn-premium btn-primary w-full md:w-auto px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-all disabled:opacity-30"
              :disabled="!hasAscensionChanges"
              @click="applyAscensionChanges"
            >
              Apply
            </button>
          </div>
        </div>

        <slot name="settings-rows" />

        <!-- Assume Double Earnings -->
        <div
          class="flex items-center justify-between p-3 bg-slate-50/50 rounded-xl border border-slate-100 group hover:bg-slate-50 transition-colors"
        >
          <div>
            <div class="text-sm font-bold text-slate-700">Assume Double Earnings</div>
            <div
              class="hidden sm:block text-[10px] uppercase font-black text-slate-400 tracking-wider group-hover:text-slate-500 transition-colors"
            >
              Active Video Doubler or Ultra
            </div>
          </div>
          <div class="flex items-center">
            <button
              class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
              :class="[assumeDoubleEarnings ? 'bg-brand-primary' : 'bg-slate-300']"
              role="switch"
              :aria-checked="assumeDoubleEarnings"
              @click="$emit('set-assume-double-earnings', !assumeDoubleEarnings)"
            >
              <span class="sr-only">Use video doubler</span>
              <span
                aria-hidden="true"
                class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                :class="[assumeDoubleEarnings ? 'translate-x-5' : 'translate-x-0']"
              />
            </button>
          </div>
        </div>

        <ProPermitToggle :model-value="proPermit" @update:model-value="$emit('set-pro-permit', $event)" />
      </div>
    </div>

    <slot name="sections" />

    <!-- Fuel Tank (collapsible) -->
    <div v-if="PROFILE.setupShowsFuelTank" class="section-premium overflow-hidden">
      <button
        class="w-full px-5 py-3 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center hover:bg-slate-100 transition-colors group"
        @click="fuelTankExpanded = !fuelTankExpanded"
      >
        <div class="flex items-center gap-3">
          <div class="p-1.5 bg-white rounded-lg shadow-sm group-hover:scale-110 transition-transform">
            <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
              />
            </svg>
          </div>
          <h3 class="style-guide-label mb-0">Fuel Tank</h3>
        </div>
        <div class="flex items-center gap-4">
          <div class="px-2 py-0.5 bg-slate-200/50 rounded-full">
            <span
              class="text-[10px] font-black text-slate-600 uppercase tracking-widest leading-none font-mono-premium"
            >
              {{ formatNumber(totalFuel, 1) }} <span class="opacity-40">/</span> {{ formatNumber(tankCapacity, 1) }}
            </span>
          </div>
          <svg
            class="w-4 h-4 text-slate-400 transition-transform duration-300"
            :class="{ 'rotate-180': fuelTankExpanded }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      <div v-if="fuelTankExpanded" class="p-5 space-y-6">
        <TankLevelSelect :tank-level="tankLevel" @set-tank-level="$emit('set-tank-level', $event)" />

        <FuelTankBreakdown
          :eggs="FUEL_ORDER"
          :fuel-amounts="fuelAmounts"
          :capacity="tankCapacity"
          editable
          @set-fuel-amount="(egg, amount) => $emit('set-fuel-amount', egg, amount)"
        />
      </div>
    </div>

    <!-- Epic Research (collapsible) -->
    <div class="section-premium overflow-hidden">
      <button
        class="w-full px-5 py-3 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center hover:bg-slate-100 transition-colors group"
        @click="epicResearchExpanded = !epicResearchExpanded"
      >
        <div class="flex items-center gap-3">
          <div class="p-1.5 bg-white rounded-lg shadow-sm group-hover:scale-110 transition-transform">
            <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
              />
            </svg>
          </div>
          <h3 class="style-guide-label mb-0">Epic Research</h3>
        </div>
        <svg
          class="w-4 h-4 text-slate-400 transition-transform duration-300"
          :class="{ 'rotate-180': epicResearchExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-if="epicResearchExpanded" class="divide-y divide-slate-50 max-h-80 overflow-y-auto custom-scrollbar">
        <div
          v-for="research in epicResearchList"
          :key="research.id"
          class="px-5 py-3 hover:bg-slate-50/50 transition-colors group flex flex-col gap-1.5"
        >
          <div class="flex justify-between items-center gap-4">
            <div class="flex items-center gap-4 flex-1 min-w-0">
              <div
                class="w-10 h-10 bg-slate-50 rounded-lg flex-shrink-0 flex items-center justify-center p-2 group-hover:bg-white group-hover:shadow-sm transition-all"
              >
                <img
                  :src="iconURL(getResearchIconPath(research.id), 64)"
                  class="w-full h-full object-contain opacity-80"
                  :alt="research.name"
                />
              </div>
              <div class="min-w-0">
                <div class="text-xs font-bold text-slate-800 uppercase tracking-tight">{{ research.name }}</div>
              </div>
            </div>
            <div class="flex flex-shrink-0 items-center gap-2">
              <div class="flex items-center gap-1.5">
                <input
                  type="number"
                  :value="research.level"
                  :min="0"
                  :max="research.maxLevel"
                  class="input-premium w-16 text-center text-xs font-mono-premium py-1 font-bold"
                  @change="
                    $emit(
                      'set-epic-research-level',
                      research.id,
                      parseInt(($event.target as HTMLInputElement).value) || 0
                    )
                  "
                />
                <span class="text-[9px] font-black text-slate-300 uppercase tracking-widest w-10"
                  >/ {{ research.maxLevel }}</span
                >
              </div>
            </div>
          </div>
          <div class="text-[10px] text-slate-500 font-medium italic leading-relaxed pl-14 pr-2 pb-1">
            {{ research.effect }}
          </div>
        </div>
      </div>
    </div>

    <!-- Colleggtibles (collapsible) -->
    <div class="section-premium overflow-hidden">
      <button
        class="w-full px-5 py-3 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center hover:bg-slate-100 transition-colors group"
        @click="colleggtiblesExpanded = !colleggtiblesExpanded"
      >
        <div class="flex items-center gap-3">
          <div class="p-1.5 bg-white rounded-lg shadow-sm group-hover:scale-110 transition-transform">
            <img :src="iconURL('egginc/egg_unknown.png', 32)" class="w-5 h-5 opacity-60" alt="" />
          </div>
          <h3 class="style-guide-label mb-0">Colleggtibles</h3>
        </div>
        <svg
          class="w-4 h-4 text-slate-400 transition-transform duration-300"
          :class="{ 'rotate-180': colleggtiblesExpanded }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-if="colleggtiblesExpanded" class="divide-y divide-slate-50 max-h-80 overflow-y-auto custom-scrollbar">
        <div
          v-for="egg in colleggtiblesList"
          :key="egg.id"
          class="px-5 py-4 hover:bg-slate-50/50 transition-colors group"
        >
          <div class="flex justify-between items-center gap-4">
            <div class="flex items-center gap-4 flex-1 min-w-0">
              <div
                class="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center p-1.5 group-hover:bg-white group-hover:shadow-sm transition-all"
              >
                <img
                  :src="iconURL(getColleggtibleIconPath(egg.id), 64)"
                  class="w-full h-full object-contain"
                  :alt="egg.name"
                />
              </div>
              <div class="min-w-0">
                <div class="text-xs font-bold text-slate-800 uppercase tracking-tight">{{ egg.name }}</div>
                <div class="text-[10px] text-slate-400 font-medium truncate italic leading-relaxed">
                  {{ egg.bonusText }} {{ egg.effect.toLowerCase() }}
                </div>
              </div>
            </div>

            <div class="flex items-center gap-4">
              <select
                :value="egg.tierIndex"
                class="input-premium py-1 pl-3 pr-10 text-xs font-bold text-slate-900 border-none bg-slate-100 hover:bg-slate-200 transition-colors w-auto"
                @change="$emit('set-colleggtible-tier', egg.id, parseInt(($event.target as HTMLSelectElement).value))"
              >
                <option v-for="opt in TIER_OPTIONS" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PROFILE } from '@planner/lib/profile';
import { computed, ref, watch } from 'vue';
import { iconURL } from 'lib';
import { getResearchIconPath, getColleggtibleIconPath } from 'lib/planners/assets';
import type { ResearchLevels, FuelEgg } from '@planner/types';
import { epicResearchDefs } from 'lib/planners/epicResearch';
import { FUEL_ORDER } from '@planner/stores/fuelTank';
import { formatNumber } from '@planner/lib/format';
import ProPermitToggle from 'ui/components/planners/ProPermitToggle.vue';
import DateTimeZonePicker from 'ui/components/planners/DateTimeZonePicker.vue';
import FuelTankBreakdown from 'ui/components/planners/presenters/FuelTankBreakdown.vue';
import TankLevelSelect from 'ui/components/planners/presenters/TankLevelSelect.vue';
import {
  colleggtibleDefs,
  formatColleggtibleBonus,
  getColleggtibleMultiplier,
  FARM_SIZE_TIERS,
} from 'lib/collegtibles';

const props = defineProps<{
  hasData: boolean;
  epicResearchLevels: ResearchLevels;
  ascensionDate: string;
  ascensionTime: string;
  ascensionTimezone: string;
  tankLevel: number;
  fuelAmounts: Record<FuelEgg, number>;
  tankCapacity: number;

  assumeDoubleEarnings: boolean;
  proPermit: boolean;
  colleggtibleTiers: import('lib/collegtibles').ColleggtibleTiers;
}>();

const emit = defineEmits<{
  'set-epic-research-level': [researchId: string, level: number];
  'set-ascension-date': [value: string];
  'set-ascension-time': [value: string];
  'set-ascension-timezone': [value: string];
  'apply-ascension-settings': [date: string, time: string, timezone: string];
  'set-tank-level': [level: number];
  'set-fuel-amount': [egg: FuelEgg, amount: number];

  'set-assume-double-earnings': [enabled: boolean];
  'set-pro-permit': [enabled: boolean];
  'set-colleggtible-tier': [id: string, tierIndex: number];
}>();

// Start time local state for staged updates
const localAscensionDate = ref(props.ascensionDate);
const localAscensionTime = ref(props.ascensionTime);
const localAscensionTimezone = ref(props.ascensionTimezone);

// Sync with props when they change externally
watch(() => props.ascensionDate, val => (localAscensionDate.value = val));
watch(() => props.ascensionTime, val => (localAscensionTime.value = val));
watch(
  () => props.ascensionTimezone,
  val => (localAscensionTimezone.value = val)
);

const hasAscensionChanges = computed(() => {
  return (
    localAscensionDate.value !== props.ascensionDate ||
    localAscensionTime.value !== props.ascensionTime ||
    localAscensionTimezone.value !== props.ascensionTimezone
  );
});

function applyAscensionChanges() {
  emit('apply-ascension-settings', localAscensionDate.value, localAscensionTime.value, localAscensionTimezone.value);
}

defineExpose({ hasAscensionChanges, applyAscensionChanges });

// Collapsible state
const epicResearchExpanded = ref(false);
const colleggtiblesExpanded = ref(false);
const fuelTankExpanded = ref(false);

// Total fuel in tank
const totalFuel = computed(() => Object.values(props.fuelAmounts).reduce((sum, amt) => sum + amt, 0));

const epicResearchList = computed(() =>
  epicResearchDefs.map(def => ({
    id: def.id,
    name: def.name,
    effect: def.effect,
    maxLevel: def.maxLevel,
    level: props.epicResearchLevels[def.id] || 0,
  }))
);

const colleggtiblesList = computed(() =>
  colleggtibleDefs.map(def => {
    const tierIndex = props.colleggtibleTiers[def.id] ?? -1;
    const multiplier = getColleggtibleMultiplier(def.id, tierIndex);
    return {
      id: def.id,
      name: def.name,
      effect: def.effect,
      tierIndex,
      bonusText: formatColleggtibleBonus(multiplier, def.id),
    };
  })
);

const TIER_OPTIONS = [
  { value: -1, label: '<10M' },
  { value: 0, label: '10M' },
  { value: 1, label: '100M' },
  { value: 2, label: '1B' },
  { value: 3, label: '10B' },
];
</script>
