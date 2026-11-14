<template>
  <!-- Soul Eggs -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-0">
    <div>
      <div class="flex items-center gap-1.5">
        <div class="text-sm font-bold text-slate-700">Soul Eggs (SE)</div>
        <img :src="iconURL('egginc/egg_soul.png', 32)" class="w-4 h-4 mb-0.5" alt="SE" />
      </div>
      <div class="hidden sm:block text-[10px] uppercase font-black text-slate-400 tracking-wider">
        Earning bonus on this farm
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

  <!-- Eggs of Prophecy -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-0">
    <div>
      <div class="flex items-center gap-1.5">
        <div class="text-sm font-bold text-slate-700">Eggs of Prophecy (PE)</div>
        <img :src="iconURL('egginc/egg_of_prophecy.png', 32)" class="w-4 h-4 mb-0.5" alt="PE" />
      </div>
      <div class="hidden sm:block text-[10px] uppercase font-black text-slate-400 tracking-wider">
        Compound the Soul Egg bonus
      </div>
    </div>
    <div class="flex items-center gap-2 w-full sm:w-auto mt-1 sm:mt-0">
      <input
        type="number"
        :value="prophecyEggs"
        :min="0"
        class="input-premium w-full sm:w-40 text-right text-sm font-mono-premium font-bold text-slate-900"
        @change="$emit('set-prophecy-eggs', parseInt(($event.target as HTMLInputElement).value) || 0)"
      />
    </div>
  </div>

  <!-- Truth Eggs -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-0">
    <div>
      <div class="flex items-center gap-1.5">
        <div class="text-sm font-bold text-slate-700">Eggs of Truth (TE)</div>
        <img :src="iconURL('egginc/egg_truth.png', 32)" class="w-4 h-4 mb-0.5" alt="TE" />
      </div>
      <div class="hidden sm:block text-[10px] uppercase font-black text-slate-400 tracking-wider">
        Multiply IHR &amp; Earnings by 1.01^TE
      </div>
    </div>
    <div class="flex items-center gap-2 w-full sm:w-auto mt-1 sm:mt-0">
      <input
        type="number"
        :value="te"
        :min="0"
        class="input-premium w-full sm:w-40 text-right text-sm font-mono-premium font-bold text-slate-900"
        @change="$emit('set-te', parseInt(($event.target as HTMLInputElement).value) || 0)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { iconURL } from 'lib';
import { formatNumber, parseNumber } from '@/lib/format';

defineProps<{
  soulEggs: number;
  prophecyEggs: number;
  te: number;
}>();

const emit = defineEmits<{
  'set-soul-eggs': [value: number];
  'set-prophecy-eggs': [value: number];
  'set-te': [value: number];
}>();

function handleSoulEggsChange(inputValue: string) {
  const parsed = parseNumber(inputValue);
  if (parsed !== null && !isNaN(parsed)) {
    emit('set-soul-eggs', parsed);
  }
}
</script>
