/**
 * Composable for Egg Laying Rate calculations.
 * Wraps the pure calculation functions with Vue reactivity.
 * Reads research levels from the common research store.
 */

import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';
import { useLayRateStore } from '@/stores/layRate';
import { useInitialStateStore } from '@/stores/initialState';
import { useCommonResearchStore } from '@/stores/commonResearch';
import { useVirtueStore } from '@/stores/virtue';
import { useHabCapacity } from '@/composables/useHabCapacity';
import { calculateLayRate, convertRate } from '@/calculations/layRate';
import type { LayRateInput, LayRateOutput, TimeUnit } from '@/types';

/**
 * Extended output with time-converted rates
 */
export interface LayRateDisplayOutput extends LayRateOutput {
  // Rates converted to the selected time unit
  ratePerChicken: number; // eggs/chicken/[timeUnit]
  totalRate: number; // eggs/[timeUnit]
  timeUnit: TimeUnit;
  population: number; // Max hab capacity used for calculation
}

/**
 * Composable that provides reactive lay rate calculations.
 * Automatically recomputes when any dependency changes.
 */
export function useLayRate(): {
  input: ComputedRef<LayRateInput>;
  output: ComputedRef<LayRateDisplayOutput>;
} {
  const virtueStore = useVirtueStore();
  const store = useLayRateStore();
  const initialStateStore = useInitialStateStore();
  const commonResearchStore = useCommonResearchStore();

  const { timeUnit } = storeToRefs(store);
  const { researchLevels } = storeToRefs(commonResearchStore);
  const { epicResearchLevels } = storeToRefs(initialStateStore);
  const { population } = storeToRefs(virtueStore);

  // Get hab capacity for clamping or reference
  const { output: habCapacityOutput } = useHabCapacity();

  // Build the calculation input reactively
  const input = computed<LayRateInput>(() => {
    const artifactMod = initialStateStore.artifactModifiers.eggLayingRate;
    return {
      researchLevels: researchLevels.value,
      epicComfyNestsLevel: epicResearchLevels.value['epic_egg_laying'] || 0,
      elrMultiplier: initialStateStore.colleggtibleModifiers.elr,
      population: population.value,
      artifactMultiplier: artifactMod.totalMultiplier,
      artifactEffects: artifactMod.effects,
    };
  });

  // Calculate output reactively with time conversion
  const output = computed<LayRateDisplayOutput>(() => {
    const baseOutput = calculateLayRate(input.value);
    return {
      ...baseOutput,
      ratePerChicken: convertRate(baseOutput.ratePerChickenPerSecond, timeUnit.value),
      totalRate: convertRate(baseOutput.totalRatePerSecond, timeUnit.value),
      timeUnit: timeUnit.value,
      population: population.value,
    };
  });

  return {
    input,
    output,
  };
}
