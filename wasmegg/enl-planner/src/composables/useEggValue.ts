/**
 * Composable for egg value calculations.
 * Wraps the pure calculation functions with Vue reactivity.
 * Reads research levels from the common research store.
 */

import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';
import { useEggValueStore } from '@/stores/eggValue';
import { useInitialStateStore } from '@/stores/initialState';
import { useCommonResearchStore } from '@/stores/commonResearch';
import { calculateEggValue } from '@/calculations/eggValue';
import type { EggValueInput, EggValueOutput } from '@/types';

/**
 * Composable that provides reactive egg value calculations.
 * Automatically recomputes when any dependency changes.
 */
export function useEggValue(): {
  input: ComputedRef<EggValueInput>;
  output: ComputedRef<EggValueOutput>;
} {
  const store = useEggValueStore();
  const initialStateStore = useInitialStateStore();
  const commonResearchStore = useCommonResearchStore();

  const { baseValue } = storeToRefs(store);
  const { researchLevels } = storeToRefs(commonResearchStore);

  // Build the calculation input reactively
  const input = computed<EggValueInput>(() => {
    const artifactMod = initialStateStore.artifactModifiers.eggValue;
    return {
      baseValue: baseValue.value,
      researchLevels: researchLevels.value,
      artifactMultiplier: artifactMod.totalMultiplier,
      artifactEffects: artifactMod.effects,
    };
  });

  // Calculate output reactively
  const output = computed<EggValueOutput>(() => calculateEggValue(input.value));

  return {
    input,
    output,
  };
}
