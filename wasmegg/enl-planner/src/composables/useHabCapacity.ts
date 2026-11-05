/**
 * Composable for hab capacity calculations.
 * Wraps the pure calculation functions with Vue reactivity.
 * Reads research levels from the common research store.
 */

import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';
import { useHabCapacityStore } from '@/stores/habCapacity';
import { useInitialStateStore } from '@/stores/initialState';
import { useCommonResearchStore } from '@/stores/commonResearch';
import { calculateHabCapacity_Full } from '@/calculations/habCapacity';
import type { HabCapacityInput, HabCapacityOutput } from '@/types';

/**
 * Composable that provides reactive hab capacity calculations.
 * Automatically recomputes when any dependency changes.
 */
export function useHabCapacity(): {
  input: ComputedRef<HabCapacityInput>;
  output: ComputedRef<HabCapacityOutput>;
} {
  const store = useHabCapacityStore();
  const initialStateStore = useInitialStateStore();
  const commonResearchStore = useCommonResearchStore();

  const { habIds } = storeToRefs(store);
  const { researchLevels } = storeToRefs(commonResearchStore);

  // Build the calculation input reactively
  const input = computed<HabCapacityInput>(() => {
    const artifactMod = initialStateStore.artifactModifiers.habCapacity;
    return {
      habIds: habIds.value,
      researchLevels: researchLevels.value,
      habCapMultiplier: initialStateStore.colleggtibleModifiers.habCap,
      artifactMultiplier: artifactMod.totalMultiplier,
      artifactEffects: artifactMod.effects,
    };
  });

  // Calculate output reactively
  const output = computed<HabCapacityOutput>(() => calculateHabCapacity_Full(input.value));

  return {
    input,
    output,
  };
}
