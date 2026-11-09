<template>
  <div class="space-y-4">
    <div v-for="family in CHAIN_FINDER_DELIVERY_FAMILIES" :key="family">
      <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
        {{ familyLabel(family) }}
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <button
          v-for="option in deliveryOptions(family)"
          :key="option.id"
          type="button"
          class="flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-colors"
          :class="
            modelValue[family] === option.id
              ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
              : 'border-slate-200 bg-white hover:bg-slate-50'
          "
          :aria-pressed="modelValue[family] === option.id"
          @click="select(family, option.id)"
        >
          <img :src="iconURL(option.iconPath, 64)" class="w-8 h-8 shrink-0" />
          <div class="min-w-0">
            <div class="text-xs font-bold text-slate-800">T{{ option.tier }}{{ option.rarityCode }}</div>
            <div class="text-[10px] text-slate-500 truncate">{{ option.effect }}</div>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { iconURL } from 'lib';
import {
  CHAIN_FINDER_DELIVERY_FAMILIES,
  deliveryOptions,
  type ChainFinderDeliveryFamily,
  type ChainFinderDeliverySelection,
} from '@/lib/chainFinder/deliveryArtifacts';

const props = defineProps<{ modelValue: ChainFinderDeliverySelection }>();
const emit = defineEmits<{ 'update:modelValue': [value: ChainFinderDeliverySelection] }>();

function familyLabel(family: ChainFinderDeliveryFamily): string {
  // Best option's label minus the "T4X " prefix, e.g. "Quantum metronome".
  return deliveryOptions(family)[0]?.label.replace(/^T\d\w\s+/, '') ?? family;
}

function select(family: ChainFinderDeliveryFamily, artifactId: string) {
  emit('update:modelValue', { ...props.modelValue, [family]: artifactId });
}
</script>
