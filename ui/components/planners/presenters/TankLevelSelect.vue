<template>
  <div class="flex items-center justify-between">
    <div>
      <div class="text-sm font-bold text-slate-700">Tank Level</div>
      <div class="text-[10px] uppercase font-black text-slate-400 tracking-wider">Storage capacity tier</div>
    </div>
    <select
      :value="tankLevel"
      class="input-premium w-auto text-sm font-bold text-slate-900 py-2.5 pl-4 pr-12"
      @change="$emit('set-tank-level', parseInt(($event.target as HTMLSelectElement).value))"
    >
      <option v-for="opt in tankLevelOptions" :key="opt.level" :value="opt.level">
        {{ opt.label }} ({{ opt.capacity }})
      </option>
    </select>
  </div>
</template>

<script setup lang="ts">
import { TANK_CAPACITIES } from '@planner/stores/fuelTank';
import { formatNumber } from '@planner/lib/format';

defineProps<{
  tankLevel: number;
}>();

defineEmits<{
  'set-tank-level': [level: number];
}>();

const tankLevelOptions = TANK_CAPACITIES.map((capacity, index) => ({
  level: index,
  label: `Level ${index}`,
  capacity: formatNumber(capacity, 1),
}));
</script>
