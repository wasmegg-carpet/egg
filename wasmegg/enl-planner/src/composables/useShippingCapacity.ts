/**
 * Composable for Shipping Capacity calculations.
 * Wraps the pure calculation functions with Vue reactivity.
 * Reads research levels from the common research store.
 */

import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';
import { useShippingCapacityStore } from '@/stores/shippingCapacity';
import { useInitialStateStore } from '@/stores/initialState';
import { useCommonResearchStore } from '@/stores/commonResearch';
import { calculateShippingCapacity } from '@/calculations/shippingCapacity';
import type { ShippingCapacityInput, ShippingCapacityOutput } from '@/types';

/**
 * Composable that provides reactive shipping capacity calculations.
 * Automatically recomputes when any dependency changes.
 */
export function useShippingCapacity(): {
  input: ComputedRef<ShippingCapacityInput>;
  output: ComputedRef<ShippingCapacityOutput>;
} {
  const store = useShippingCapacityStore();
  const initialStateStore = useInitialStateStore();
  const commonResearchStore = useCommonResearchStore();

  const { vehicles } = storeToRefs(store);
  const { researchLevels } = storeToRefs(commonResearchStore);
  const { epicResearchLevels } = storeToRefs(initialStateStore);

  // Build the calculation input reactively
  const input = computed<ShippingCapacityInput>(() => {
    const artifactMod = initialStateStore.artifactModifiers.shippingRate;
    return {
      vehicles: vehicles.value,
      researchLevels: researchLevels.value,
      transportationLobbyistLevel: epicResearchLevels.value['transportation_lobbyist'] || 0,
      shippingCapMultiplier: initialStateStore.colleggtibleModifiers.shippingCap,
      artifactMultiplier: artifactMod.totalMultiplier,
      artifactEffects: artifactMod.effects,
    };
  });

  // Calculate output reactively
  const output = computed<ShippingCapacityOutput>(() => calculateShippingCapacity(input.value));

  return {
    input,
    output,
  };
}
