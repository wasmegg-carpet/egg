/**
 * Composable for Effective Lay Rate calculations.
 * Combines lay rate and shipping capacity to get the effective rate.
 */

import { computed, type ComputedRef } from 'vue';
import { useLayRate } from './useLayRate';
import { useShippingCapacity } from './useShippingCapacity';
import { calculateEffectiveLayRate } from '@/calculations/effectiveLayRate';
import type { EffectiveLayRateOutput } from '@/types';

/**
 * Composable that provides reactive effective lay rate calculations.
 */
export function useEffectiveLayRate(): {
  output: ComputedRef<EffectiveLayRateOutput>;
} {
  const { output: layRateOutput } = useLayRate();
  const { output: shippingOutput } = useShippingCapacity();

  const output = computed<EffectiveLayRateOutput>(() =>
    calculateEffectiveLayRate(layRateOutput.value.totalRatePerSecond, shippingOutput.value.totalFinalCapacity)
  );

  return {
    output,
  };
}
