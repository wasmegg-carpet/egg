<template>
  <div class="space-y-4">
    <p class="text-xs font-medium text-slate-500 mb-4 px-1 italic">
      How much of each egg is in your tank when the plan starts. Changing these doesn't add actions; missions draw from
      them.
    </p>

    <div class="section-premium p-5">
      <FuelTankBreakdown
        :eggs="FUEL_ORDER"
        :fuel-amounts="initialStateStore.initialFuelAmounts"
        :capacity="fuelTankStore.tankCapacity"
        editable
        @set-fuel-amount="handleSetFuelAmount"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useFuelTankStore, FUEL_ORDER } from '@/stores/fuelTank';
import { useInitialStateStore } from '@/stores/initialState';
import { updateInitialSnapshotAndRecalculate } from '@/lib/actions/updateInitialSnapshot';
import FuelTankBreakdown from 'ui/components/planners/presenters/FuelTankBreakdown.vue';
import type { FuelEgg } from '@/types';

const initialStateStore = useInitialStateStore();
const fuelTankStore = useFuelTankStore();

function handleSetFuelAmount(egg: FuelEgg, amount: number) {
  initialStateStore.setInitialFuelAmount(egg, amount);
  updateInitialSnapshotAndRecalculate();
}
</script>
