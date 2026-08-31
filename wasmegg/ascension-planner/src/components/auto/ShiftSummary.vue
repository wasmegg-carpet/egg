<template>
  <div class="bg-white rounded-xl border border-slate-100 p-2.5 sm:p-3 shadow-sm">
    <div class="grid grid-cols-2 items-center gap-y-0.5 sm:flex sm:items-center sm:justify-between mb-1.5">
      <!-- Col 1 Row 1 / Desktop left: icon + shift name -->
      <div class="flex items-center gap-2">
        <div class="w-5 h-5 rounded-md flex items-center justify-center" :class="eggTheme.bg">
          <svg class="w-3.5 h-3.5" :class="eggTheme.text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.675.337a4 4 0 01-2.574.338L6.5 15.1l-1.5-1.5 1.5-1.5 2.414.483a2 2 0 001.287-.169l.675-.337a8 8 0 015.147-.69l2.387.477a2 2 0 001.022.547l1.718.344a2 2 0 011.414 1.414l.344 1.718a2 2 0 01-.547 1.022l-1.5 1.5-1.5-1.5.483-2.414a2 2 0 00-.169-1.287l-.337-.675a8 8 0 00-.69-5.147l.477-2.387a2 2 0 00-.547-1.022l-1.718-.344a2 2 0 00-1.414-1.414l-1.718-.344a2 2 0 00-1.022.547l-1.5 1.5 1.5 1.5.483-2.414a2 2 0 011.287-.169l.675.337a8 8 0 01.69 5.147l-.477 2.387a2 2 0 01.547 1.022l1.718.344a2 2 0 011.414 1.414l.344 1.718a2 2 0 01-.547 1.022l-1.5 1.5z"
            />
          </svg>
        </div>
        <span class="text-[9px] font-black text-slate-400 uppercase tracking-[0.1em]">{{ title }}</span>
      </div>

      <!-- Col 2 Row 1 (mobile only): Duration, right-aligned -->
      <div class="flex justify-end items-center text-[9px] font-black text-slate-400 sm:hidden">
        <span
          v-tippy="{ content: timeTooltipContent, allowHTML: true }"
          class="cursor-help border-b border-dashed border-slate-300/50 transition-colors"
        >
          {{ formatDuration(duration) }}
        </span>
      </div>

      <!-- Col 1 Row 2 (mobile only): SE cost, left-aligned -->
      <div class="flex items-center gap-1 text-[9px] font-black text-slate-400 sm:hidden">
        <span>{{ formatNumber(cost, 3) }}</span>
        <img v-if="costType === 'SE'" :src="iconURL('egginc/egg_soul.png', 32)" class="w-3 h-3 opacity-40" alt="SE" />
      </div>

      <!-- Col 2 Row 2 (mobile only): Eggs delivered, right-aligned -->
      <div class="flex justify-end items-center gap-1 text-[9px] font-black text-slate-500 sm:hidden">
        <template v-if="totalEggsLaid > 0">
          <span>{{ formatNumber(totalEggsLaid, 3) }}</span>
          <span class="text-[7.5px] opacity-60">EGGS</span>
        </template>
      </div>

      <!-- Desktop only: full right-side row with dot separators (unchanged) -->
      <div class="hidden sm:flex items-center gap-2 text-[9px] font-black text-slate-400">
        <span
          v-tippy="{ content: timeTooltipContent, allowHTML: true }"
          class="cursor-help border-b border-dashed border-slate-300/50 hover:text-slate-500 hover:border-slate-400 transition-colors"
        >
          {{ formatDuration(duration) }}
        </span>
        <span class="w-1 h-1 bg-slate-200 rounded-full"></span>
        <div class="flex items-center gap-1">
          <span>{{ formatNumber(cost, 3) }}</span>
          <img v-if="costType === 'SE'" :src="iconURL('egginc/egg_soul.png', 32)" class="w-3 h-3 opacity-40" alt="SE" />
        </div>
        <template v-if="totalEggsLaid > 0">
          <span class="w-1 h-1 bg-slate-200 rounded-full"></span>
          <div class="flex items-center gap-1 text-slate-500">
            <span>{{ formatNumber(totalEggsLaid, 3) }}</span>
            <span class="text-[7.5px] opacity-60">EGGS</span>
          </div>
        </template>
      </div>
    </div>

    <div v-if="summaryItems.length > 0" class="flex flex-wrap gap-1">
      <div v-for="(item, index) in summaryItems" :key="index" class="flex items-center">
        <template v-if="item.isPremium">
          <span
            class="badge-premium px-1.5 py-0.5 text-[8.5px] font-black tracking-tight"
            :class="eggTheme.badge"
          >
            {{ item.text }}
          </span>
        </template>
        <template v-else-if="item.isPeakELR">
          <div
            class="flex items-center gap-1 px-1.5 py-0.5 rounded border transition-all duration-500"
            :class="item.isOvertake ? 'bg-amber-50 border-amber-100' : 'bg-indigo-50 border-indigo-100'"
          >
            <div
              class="w-1.5 h-1.5 rounded-full animate-pulse"
              :class="item.isOvertake ? 'bg-amber-500' : 'bg-indigo-500'"
            ></div>
            <span
              class="text-[8.5px] font-black tracking-tighter"
              :class="item.isOvertake ? 'text-amber-700' : 'text-indigo-700'"
            >
              {{ item.text }}
            </span>
          </div>
        </template>
        <template v-else>
          <div class="flex items-center gap-1 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded">
            <span class="text-[8.5px] font-bold text-slate-600">{{ item.name }}</span>
            <span class="text-[8.5px] font-black text-indigo-500 tracking-tighter">{{ item.delta }}</span>
          </div>
        </template>
      </div>
    </div>
    <div v-else class="text-center py-1">
      <p class="text-[8.5px] font-black text-slate-300 uppercase tracking-widest">No purchases during this shift</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatNumber, formatDuration } from '@/lib/format';
import { iconURL } from 'lib';
import { getResearchById, getResearchByTier } from '@/calculations/commonResearch';
import { getVehicleType } from '@/lib/vehicles';
import { getHabById, type HabId } from '../../lib/habs';
import { getArtifact, getStone } from '@/lib/artifacts/data';
import type { VirtueEgg } from '@/types';

const props = defineProps<{
  title: string;
  egg: VirtueEgg;
  actions: any[];
  duration: number;
  cost: number;
  costType: 'SE' | 'Virtue';
  startTime: number;
  endTime: number;
}>();

const formatTime = (ts: number) => {
  // `Math.round`, not a bare `new Date(...)` — see `secondsToDate`'s doc comment (lib/format.ts):
  // `ts` routinely lands a sub-microsecond residue short of a whole second.
  return new Date(Math.round(ts * 1000)).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const timeTooltipContent = computed(() => {
  return `
    <div class="text-left font-sans">
      <div class="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-1 border-b border-slate-600/50 pb-1">Shift Schedule</div>
      <div class="text-xs mb-0.5"><span class="text-slate-400 mr-2">Start:</span><span class="text-white">${formatTime(props.startTime)}</span></div>
      <div class="text-xs"><span class="text-slate-400 mr-2">End:</span><span class="text-white">${formatTime(props.endTime)}</span></div>
    </div>
  `;
});

const eggThemes: Record<VirtueEgg, { bg: string; text: string; badge: string }> = {
  curiosity: { bg: 'bg-amber-50', text: 'text-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-100' },
  integrity: { bg: 'bg-blue-50', text: 'text-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-100' },
  humility: { bg: 'bg-purple-50', text: 'text-purple-500', badge: 'bg-purple-50 text-purple-700 border-purple-100' },
  resilience: { bg: 'bg-rose-50', text: 'text-rose-500', badge: 'bg-rose-50 text-rose-700 border-rose-100' },
  kindness: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  },
};

const eggTheme = computed(() => eggThemes[props.egg] || eggThemes.curiosity);

const totalEggsLaid = computed(() => {
  const eggAction = props.actions.find(a => a.payload?.eggsLaid !== undefined);
  return eggAction ? eggAction.payload.eggsLaid : 0;
});

const summaryItems = computed(() => {
  const finalResearch: Record<string, number> = {};
  const startResearch: Record<string, number> = {};
  const modifiedResearchIds = new Set<string>();
  const modifiedTiers = new Set<number>();

  const finalVehicles: Record<number, { id: number; trainLength?: number }> = {};
  const finalHabs: Record<number, number> = {};
  let finalSiloCount = 0;
  const equippedArtifacts: any[] = [];
  const equippedSets: string[] = [];

  for (const action of props.actions) {
    if (action.type === 'buy_research') {
      const { researchId, fromLevel, toLevel } = action.payload;
if (!(researchId in startResearch)) startResearch[researchId] = fromLevel;
      finalResearch[researchId] = toLevel;
      modifiedResearchIds.add(researchId);
      const research = getResearchById(researchId);
      if (research) modifiedTiers.add(research.tier);
    } else if (action.type === 'buy_vehicle') {
      const { slotIndex, vehicleId, trainLength } = action.payload;
      finalVehicles[slotIndex] = { id: vehicleId, trainLength };
    } else if (action.type === 'buy_train_car') {
      const { slotIndex, toLength } = action.payload;
      if (finalVehicles[slotIndex]) {
        finalVehicles[slotIndex].trainLength = toLength;
      } else {
        finalVehicles[slotIndex] = { id: 11, trainLength: toLength }; // 11 is Hyperloop
      }
    } else if (action.type === 'buy_hab') {
      const { slotIndex, habId } = action.payload;
      finalHabs[slotIndex] = habId;
    } else if (action.type === 'buy_silo') {
      const { toCount } = action.payload;
      finalSiloCount = Math.max(finalSiloCount, toCount);
    } else if (action.type === 'change_artifacts') {
      const { toLoadout } = action.payload;
      // Clear previous if multiple change actions exist in one shift (unlikely but safe)
      equippedArtifacts.length = 0;
      for (const slot of toLoadout) {
        if (slot.artifactId) {
          const artifact = getArtifact(slot.artifactId);
          if (artifact) {
            const stones = (slot.stones || [])
              .map((s: string | null) => (s ? getStone(s) : null))
              .filter((s: any) => s !== null);
            equippedArtifacts.push({
              name: artifact.familyName,
              tier: artifact.tier,
              rarity: artifact.rarityCode,
              stones: stones.map((s: any) => ({ name: s.familyName, tier: s.tier })),
            });
          }
        }
      }
    } else if (action.type === 'update_artifact_set') {
      const { newLoadout } = action.payload;
      equippedArtifacts.length = 0;
      for (const slot of newLoadout) {
        if (slot.artifactId) {
          const artifact = getArtifact(slot.artifactId);
          if (artifact) {
            const stones = (slot.stones || [])
              .map((s: string | null) => (s ? getStone(s) : null))
              .filter((s: any) => s !== null);
            equippedArtifacts.push({
              name: artifact.familyName,
              tier: artifact.tier,
              rarity: artifact.rarityCode,
              stones: stones.map((s: any) => ({ name: s.familyName, tier: s.tier })),
            });
          }
        }
      }
    } else if (action.type === 'equip_artifact_set') {
      const setName = action.payload.setName === 'earnings' ? 'Earnings' : 'Delivery Rate';
      equippedSets.push(setName);
    }
  }

    const items: any[] = [];

    for (const setName of equippedSets) {
      items.push({
        isPremium: true,
        text: `Equipped ${setName} Set`,
      });
    }

    // --- Peak ELR / K3 Wait ---
    const peakELRAction = props.actions.find(a => a.payload?.peakELR !== undefined);
    if (peakELRAction) {
      items.push({
        isPeakELR: true,
        text: `Peak Delivery Rate: ${formatNumber(peakELRAction.payload.peakELR * 3600, 3)}/hr`,
      });
    }
    // --- TE Earned ---
    const teWaitActions = props.actions.filter(a => a.type === 'wait_for_te' || a.payload?.isTEWait);
    if (teWaitActions.length > 0) {
      const totalTE = teWaitActions.reduce((sum, a) => sum + (a.payload.teGained || a.payload.teEarned || 0), 0);
      if (totalTE > 0) {
        items.push({
          isPremium: true,
          text: `+${totalTE} Truth Eggs`,
        });
      }
    }

    // --- Overtake Info ---
    const overtakeAction = props.actions.find(a => a.type === 'virtual_overtake_info');
    if (overtakeAction) {
      items.push({
        isPeakELR: true, // Use same styling but different icon/color if possible
        isOvertake: true,
        text: `Overtakes 1-sale in ${overtakeAction.payload.daysToOvertake.toFixed(1)}d`,
      });
    }

  // --- Artifacts & Stones ---
  const totalStoneCounts: Record<string, number> = {};
  for (const art of equippedArtifacts) {
    items.push({
      isPremium: true,
      text: `T${art.tier}${art.rarity} ${art.name}`,
    });
    for (const s of art.stones) {
      const label = `T${s.tier} ${s.name.split(' ')[0]}`;
      totalStoneCounts[label] = (totalStoneCounts[label] || 0) + 1;
    }
  }

  for (const [label, count] of Object.entries(totalStoneCounts)) {
    items.push({
      isPremium: true,
      text: `${count}x ${label}`,
    });
  }

  // --- Silos ---
  if (finalSiloCount > 0) {
    items.push({ isPremium: true, text: `${finalSiloCount} Silos` });
  }

  // --- Habs ---
  let hasCU = false;
  let highestHabId = -1;
  const habCounts: Record<number, number> = {};

  for (const habId of Object.values(finalHabs)) {
    if (habId === 18) hasCU = true;
    if (habId > highestHabId) highestHabId = habId;
    habCounts[habId] = (habCounts[habId] || 0) + 1;
  }

  if (hasCU) {
    items.push({ isPremium: true, text: `${habCounts[18]}x Chicken Universe` });
  } else if (highestHabId >= 0) {
    const habName = getHabById(highestHabId as HabId)?.name || 'Hab';
    items.push({ isPremium: false, name: `Hab Upgrade`, delta: `to ${habName}` });
  }

  // --- Vehicles ---
  const vehicleCounts: Record<string, number> = {};
  for (const v of Object.values(finalVehicles)) {
    const name = getVehicleType(v.id)?.name || 'Vehicle';
    let label = name;
    if (v.id === 11 && v.trainLength) {
      label = `${name} (${v.trainLength} cars)`;
    }
    vehicleCounts[label] = (vehicleCounts[label] || 0) + 1;
  }

  for (const [label, count] of Object.entries(vehicleCounts)) {
    if (count > 1) {
      items.push({ isPremium: false, name: label, delta: `${count}x` });
    } else {
      items.push({ isPremium: false, name: 'Vehicle', delta: label });
    }
  }

  // --- Research ---
  if (modifiedResearchIds.size > 0) {
    const maxedTiers: number[] = [];
    const handledResearchIds = new Set<string>();
    const researchByTierMap = getResearchByTier();

    const sortedModifiedTiers = Array.from(modifiedTiers).sort((a, b) => a - b);
    for (const tier of sortedModifiedTiers) {
      const tierResearches = researchByTierMap.get(tier) || [];
      const isTierMaxed = tierResearches.every(r => (finalResearch[r.id] || 0) >= r.levels);
      if (isTierMaxed) {
        maxedTiers.push(tier);
        tierResearches.forEach(r => handledResearchIds.add(r.id));
      }
    }

    if (maxedTiers.length > 0) {
      let start = maxedTiers[0];
      let prev = maxedTiers[0];
      for (let i = 1; i <= maxedTiers.length; i++) {
        const curr = maxedTiers[i];
        if (curr === prev + 1) {
          prev = curr;
        } else {
          items.push({
            isPremium: true,
            text: start === prev ? `Max Tier ${start}` : `Max Tiers ${start}-${prev}`,
          });
          start = curr;
          prev = curr;
        }
      }
    }

    const remaining = Array.from(modifiedResearchIds)
      .filter(id => !handledResearchIds.has(id))
      .map(id => getResearchById(id)!)
      .sort((a, b) => a.serial_id - b.serial_id);

    for (const r of remaining) {
      const final = finalResearch[r.id] || 0;
      if (final >= r.levels) {
        items.push({ isPremium: false, name: `Max ${r.name}`, delta: '' });
      } else {
        items.push({ isPremium: false, name: r.name, delta: `${startResearch[r.id] ?? 0} -> ${final}` });
      }
    }
  }

  return items;
});
</script>

<style scoped>
.badge-premium {
  @apply border rounded-lg;
}
</style>
