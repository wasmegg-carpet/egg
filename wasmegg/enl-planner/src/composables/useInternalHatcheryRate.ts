/**
 * Composable for Internal Hatchery Rate (IHR) calculations.
 * Wraps the pure calculation functions with Vue reactivity.
 * Reads research levels from the common research store.
 */

import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';
import { useInitialStateStore } from '@/stores/initialState';
import { useCommonResearchStore } from '@/stores/commonResearch';
import { useVirtueStore } from '@/stores/virtue';
import { calculateIHR } from '@/calculations/internalHatcheryRate';
import type { IHRInput, IHROutput } from '@/types';

/**
 * Composable that provides reactive IHR calculations.
 * Automatically recomputes when any dependency changes.
 */
export function useInternalHatcheryRate(): {
  input: ComputedRef<IHRInput>;
  output: ComputedRef<IHROutput>;
} {
  const initialStateStore = useInitialStateStore();
  const commonResearchStore = useCommonResearchStore();
  const virtueStore = useVirtueStore();

  const { te } = storeToRefs(virtueStore);
  const { researchLevels } = storeToRefs(commonResearchStore);
  const { epicResearchLevels } = storeToRefs(initialStateStore);

  // Build the calculation input reactively
  const input = computed<IHRInput>(() => {
    const artifactMod = initialStateStore.artifactModifiers.internalHatcheryRate;
    return {
      te: te.value,
      researchLevels: researchLevels.value,
      epicResearchLevels: {
        epicInternalIncubators: epicResearchLevels.value['epic_internal_incubators'] || 0,
        internalHatcheryCalm: epicResearchLevels.value['int_hatch_calm'] || 0,
      },
      ihrMultiplier: initialStateStore.colleggtibleModifiers.ihr,
      artifactMultiplier: artifactMod.totalMultiplier,
      artifactEffects: artifactMod.effects,
    };
  });

  // Calculate output reactively
  const output = computed<IHROutput>(() => calculateIHR(input.value));

  return {
    input,
    output,
  };
}
