<template>
  <div class="overflow-x-auto">
    <table class="w-full text-xs border-collapse">
      <thead>
        <tr class="border-b border-gray-300">
          <th class="text-left p-2 w-28">Ship</th>
          <th class="text-center p-2" v-for="dur in ALL_DURATIONS" :key="dur">
            {{ DURATION_NAMES[dur] }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="ship in ALL_SHIPS"
          :key="ship"
          class="border-b border-gray-100"
          :class="{ 'opacity-40': !canAfford(ship) }"
        >
          <!-- Ship column -->
          <td class="p-3 align-top">
            <div class="flex flex-col gap-1.5 mb-1.5">
              <img
                :src="iconURL(SHIP_INFO[ship].iconPath, 64)"
                class="w-7 h-7 object-contain flex-shrink-0"
                :alt="SHIP_INFO[ship].displayName"
              />
              <span class="font-bold text-gray-800 leading-tight">
                {{ SHIP_INFO[ship].displayName }}
              </span>
            </div>
            <div class="text-gray-500 text-[11px] font-medium">
              {{ formatNumber(SHIP_INFO[ship].price, 0) }}
            </div>
            <div class="text-gray-400 text-[10px]">Save: {{ formatDuration(saveTime(ship)) }}</div>
          </td>

          <!-- Duration cells -->
          <td v-for="dur in ALL_DURATIONS" :key="dur" class="p-2 align-top text-center">
            <!-- Line 1: Duration -->
            <div class="font-mono text-gray-700 mb-1 leading-tight">
              {{ formatDuration(getEffectiveDuration(ship, dur, ftlLevel)).replace(/\s/g, '') }}
            </div>

            <!-- Line 2: Fuel requirements -->
            <div class="flex justify-center mb-1.5 h-4">
              <div
                v-if="VIRTUE_FUEL_REQUIREMENTS[ship][dur] && VIRTUE_FUEL_REQUIREMENTS[ship][dur].length > 0"
                class="w-[18px] h-[18px] flex items-center justify-center cursor-help group transition-all"
                v-tippy="{ content: getFuelTooltip(ship, dur), allowHTML: true }"
              >
                <img
                  :src="iconURL('egginc/egg_unknown.png', 32)"
                  class="w-full h-full object-contain opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all drop-shadow-sm"
                  alt="Fuel Requirements"
                />
              </div>
            </div>

            <!-- Line 3: Max missions -->
            <div class="text-[10px] text-gray-400 font-bold uppercase tracking-tight mb-1">
              max: {{ maxCount(ship, dur) > 99 ? '>99' : maxCount(ship, dur) }}
            </div>

            <!-- Line 4: Input -->
            <div class="flex justify-center">
              <input
                type="number"
                min="0"
                :max="maxCount(ship, dur)"
                :value="rocketsStore.getCount(ship, dur)"
                :disabled="maxCount(ship, dur) === 0 && rocketsStore.getCount(ship, dur) === 0"
                class="w-12 px-1 py-0.5 border border-gray-300 rounded text-center text-xs font-bold focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                :class="{ 'border-red-400 bg-red-50 text-red-700': isOverMax(ship, dur) }"
                @input="handleInput(ship, dur, $event)"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { iconURL } from 'lib';
import { useRocketsStore } from '@/stores/rockets';
import { useActionsStore } from '@/stores/actions';
import {
  ALL_SHIPS,
  ALL_DURATIONS,
  DURATION_NAMES,
  SHIP_INFO,
  VIRTUE_FUEL_REQUIREMENTS,
  getEffectiveDuration,
  type Spaceship,
  type DurationType,
} from '@/lib/missions';
import { formatNumber, formatGemPrice, formatDuration } from '@/lib/format';
import { getBoostAwareTimeToSave } from '@/engine/apply';
import { getSimulationContext } from '@/engine/adapter';

const props = defineProps<{
  ftlLevel: number;
  earningsPerSecond: number;
}>();

const rocketsStore = useRocketsStore();
const actionsStore = useActionsStore();

function canAfford(ship: Spaceship): boolean {
  return props.earningsPerSecond > 0;
}

function saveTime(ship: Spaceship): number {
  const price = SHIP_INFO[ship].price;
  const snapshot = actionsStore.effectiveSnapshot;
  return getBoostAwareTimeToSave(price, snapshot, getSimulationContext());
}

function maxCount(ship: Spaceship, dur: DurationType): number {
  return rocketsStore.maxForMission(ship, dur);
}

function getFuelTooltip(ship: Spaceship, dur: DurationType): string {
  const reqs = VIRTUE_FUEL_REQUIREMENTS[ship][dur];
  if (!reqs || reqs.length === 0) return 'No fuel required';
  
  const lines = reqs.map(r => {
    const name = r.egg.charAt(0).toUpperCase() + r.egg.slice(1);
    return `${name}: <b>${formatNumber(r.amount, 1)}</b>`;
  });
  return lines.join('<br/>');
}

function isOverMax(ship: Spaceship, dur: DurationType): boolean {
  return rocketsStore.getCount(ship, dur) > maxCount(ship, dur);
}

function handleInput(ship: Spaceship, dur: DurationType, event: Event) {
  const target = event.target as HTMLInputElement;
  let value = parseInt(target.value, 10);
  if (isNaN(value) || value < 0) value = 0;

  const max = maxCount(ship, dur);
  if (value > max) value = max;

  rocketsStore.setCount(ship, dur, value);
  target.value = String(value);
}
</script>
