<template>
  <!-- Starting Egg -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0">
    <div>
      <div class="text-sm font-bold text-slate-700">Starting Egg</div>
      <div class="hidden sm:block text-[10px] uppercase font-black text-slate-400 tracking-wider">Initial Egg</div>
    </div>
    <div class="flex gap-2 justify-between w-full sm:w-auto mt-1 sm:mt-0">
      <button
        v-for="egg in VIRTUE_EGGS"
        :key="egg"
        class="group relative w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 shadow-sm border-2 overflow-visible"
        :class="[
          initialEgg === egg
            ? 'border-brand-primary scale-110 shadow-lg shadow-brand-primary/20 bg-white'
            : 'border-slate-100 bg-slate-50 opacity-60 hover:opacity-100 hover:border-slate-200',
        ]"
        v-tippy="VIRTUE_EGG_NAMES[egg]"
        @click="handleInitialEggClick(egg)"
      >
        <img
          :src="iconURL(`egginc/egg_${egg}.png`, 64)"
          class="w-8 h-8 object-contain transition-transform"
          :class="{ 'scale-110 drop-shadow-sm': initialEgg === egg }"
          :alt="egg"
        />

        <!-- Active indicator dot -->
        <div
          v-if="initialEgg === egg"
          class="absolute -top-1 -right-1 w-3 h-3 bg-slate-900 rounded-full border-2 border-white shadow-sm pointer-events-none"
        ></div>
      </button>
    </div>
  </div>

  <!-- Previous Shifts (editable) -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-0">
    <div>
      <div class="text-sm font-bold text-slate-700">Previous Shifts</div>
      <div class="hidden sm:block text-[10px] uppercase font-black text-slate-400 tracking-wider">Experience baseline</div>
    </div>
    <div class="flex items-center gap-2 w-full sm:w-auto mt-1 sm:mt-0">
      <input
        type="number"
        :value="initialShiftCount"
        :min="0"
        class="input-premium w-full sm:w-40 text-right text-sm font-mono-premium font-bold text-slate-900"
        @change="$emit('set-initial-shift-count', parseInt(($event.target as HTMLInputElement).value) || 0)"
      />
    </div>
  </div>

  <!-- Soul Eggs -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-0">
    <div>
      <div class="flex items-center gap-1.5">
        <div class="text-sm font-bold text-slate-700">Soul Eggs (SE)</div>
        <img :src="iconURL('egginc/egg_soul.png', 32)" class="w-4 h-4 mb-0.5" alt="SE" />
      </div>
      <div class="hidden sm:block text-[10px] uppercase font-black text-slate-400 tracking-wider">
        Earnings potential multiplier
      </div>
    </div>
    <div class="flex items-center gap-2 w-full sm:w-auto mt-1 sm:mt-0">
      <input
        type="text"
        :value="formatNumber(soulEggs, 3)"
        class="input-premium w-full sm:w-40 text-right text-sm font-mono-premium font-bold text-slate-900"
        @blur="handleSoulEggsChange(($event.target as HTMLInputElement).value)"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { iconURL } from 'lib';
import type { VirtueEgg } from '@/types';
import { VIRTUE_EGGS, VIRTUE_EGG_NAMES } from '@/types';
import { formatNumber, parseNumber } from '@/lib/format';

const props = defineProps<{
  initialEgg: VirtueEgg;
  initialShiftCount: number;
  soulEggs: number;
}>();

const emit = defineEmits<{
  'set-initial-egg': [egg: VirtueEgg];
  'set-initial-shift-count': [value: number];
  'set-soul-eggs': [value: number];
}>();

function handleInitialEggClick(egg: VirtueEgg) {
  if (props.initialEgg === egg) return;
  if (confirm('Changing the initial egg will reset your entire plan. Are you sure you want to continue?')) {
    emit('set-initial-egg', egg);
  }
}

function handleSoulEggsChange(inputValue: string) {
  const parsed = parseNumber(inputValue);
  if (parsed !== null && !isNaN(parsed)) {
    emit('set-soul-eggs', parsed);
  }
}
</script>
