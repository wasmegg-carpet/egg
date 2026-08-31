<template>
  <div class="px-1 mb-2 space-y-2">
    <div class="flex items-center justify-between">
      <span class="text-xs text-gray-500">Delivery Impact Only</span>
      <button
        class="relative inline-flex h-5 w-10 items-center rounded-full transition-all duration-300 focus:outline-none shadow-inner"
        :class="deliveryImpactOnly ? 'bg-indigo-500' : 'bg-slate-200'"
        @click="$emit('update:deliveryImpactOnly', !deliveryImpactOnly)"
      >
        <span
          class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-all duration-300 shadow-sm"
          :class="deliveryImpactOnly ? 'translate-x-[22px]' : 'translate-x-1'"
        />
      </button>
    </div>
    <div class="flex items-center justify-between">
      <span class="text-xs text-gray-500">Achieve ROI</span>
      <div class="flex items-center gap-1.5">
        <div class="flex gap-0.5 p-0.5 bg-gray-100 rounded-md shadow-inner">
          <button
            class="px-2 py-0.5 text-[10px] font-medium rounded transition-all whitespace-nowrap"
            :class="
              roiMode === 'immediate'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
            "
            @click="$emit('update:roiMode', 'immediate')"
          >
            Immediate Impact
          </button>
          <button
            class="px-2 py-0.5 text-[10px] font-medium rounded transition-all whitespace-nowrap"
            :class="
              roiMode === 'maxed_vehicles'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
            "
            @click="$emit('update:roiMode', 'maxed_vehicles')"
          >
            Max Vehicles
          </button>
        </div>
        <span
          v-tippy="
            'Max Vehicles mode calculates Achieve ROI as if you had gone to Kindness and bought all available vehicles and hyperloop cars — after buying the research in question.'
          "
          class="w-4 h-4 inline-flex items-center justify-center rounded-full bg-gray-100 text-gray-400 text-[9px] cursor-help hover:bg-gray-200 transition-colors leading-none shrink-0"
          >?</span
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { type RoiMode } from '@/composables/useResearchViews';

defineProps<{
  deliveryImpactOnly: boolean;
  roiMode: RoiMode;
}>();

defineEmits(['update:deliveryImpactOnly', 'update:roiMode']);
</script>
