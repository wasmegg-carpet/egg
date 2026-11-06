<template>
  <div
    class="bg-gradient-to-r from-sky-50/80 via-white to-blue-50/80 rounded-2xl p-4 border border-sky-100/50 shadow-sm relative transition-all duration-300"
  >
    <div class="flex items-center justify-between gap-3">
      <button class="flex items-center gap-2 text-left min-w-0" @click="expanded = !expanded">
        <img :src="iconUrl(cube?.iconPath)" class="w-7 h-7 shrink-0" alt="" />
        <div class="flex flex-col gap-0.5 min-w-0">
          <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">
            Assume cube used for research purchases
          </span>
          <span class="text-[11px] font-black uppercase tracking-tighter" :class="setting.enabled ? 'text-sky-700' : 'text-slate-400'">
            {{ summary }}
          </span>
        </div>
        <svg
          class="w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform"
          :class="expanded ? 'rotate-180' : ''"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <button
        v-tippy="'Price research as if you swap this puzzle cube in right before each purchase, then go back to your saved set'"
        role="switch"
        aria-label="Assume cube used for research purchases"
        :aria-checked="setting.enabled"
        class="relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner"
        :class="setting.enabled ? 'bg-sky-500' : 'bg-slate-200'"
        @click="update({ enabled: !setting.enabled })"
      >
        <span
          class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-all duration-300 shadow-sm"
          :class="setting.enabled ? 'translate-x-[22px]' : 'translate-x-1'"
        />
      </button>
    </div>

    <div v-if="expanded" class="mt-3 pt-3 border-t border-sky-100 space-y-2">
      <ArtifactSelector
        :model-value="[{ artifactId: setting.artifactId, stones: slotStones }]"
        :families="['puzzle-cube']"
        :stone-families="['clarity-stone']"
        :slot-count="1"
        :show-slot-numbers="false"
        @update:model-value="change($event[0])"
      />
      <p class="text-[10px] text-slate-500 leading-tight">
        A puzzle cube needs clarity stones to work here. Past 100% clarity it divides the price by the clarity
        instead, the same as Artifact Sandbox.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { iconURL } from 'lib';
import { useInitialStateStore } from '@/stores/initialState';
import { useActionsStore } from '@/stores/actions';
import { getArtifact } from '@/lib/artifacts/data';
import type { EquippedArtifact } from '@/lib/artifacts/types';
import ArtifactSelector from '@/components/ArtifactSelector.vue';
import {
  researchCubeClarity,
  researchCubeMultiplier,
  type ResearchCubeSetting,
} from '@/lib/artifacts/researchCube';

const initialStateStore = useInitialStateStore();
const actionsStore = useActionsStore();

const expanded = ref(false);
const setting = computed(() => initialStateStore.researchCube);
const cube = computed(() => getArtifact(setting.value.artifactId));

const slotStones = computed(() =>
  Array.from({ length: cube.value?.slots ?? 0 }, (_, i) => setting.value.stones[i] ?? null)
);

const summary = computed(() => {
  if (!setting.value.enabled) return 'Off: priced with your equipped set';
  if (!cube.value) return 'No puzzle cube: full price';
  const discount = 1 - researchCubeMultiplier(setting.value);
  const clarity = researchCubeClarity(setting.value);
  if (clarity === 0) return `${cube.value?.label}: no clarity, no discount`;
  return `${cube.value?.label}, ${Math.round(clarity * 100)}% clarity: −${(discount * 100).toFixed(1)}% research cost`;
});

function iconUrl(path?: string) {
  return path ? iconURL(path, 64) : '';
}

function update(change: Partial<ResearchCubeSetting>) {
  initialStateStore.setResearchCube(change);
  void actionsStore.recalculateAll();
}

function change(slot: EquippedArtifact) {
  update({ artifactId: slot.artifactId, stones: [...slot.stones] });
}
</script>
