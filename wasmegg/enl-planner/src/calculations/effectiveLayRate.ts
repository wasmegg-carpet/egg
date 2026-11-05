/**
 * Effective Lay Rate (ELR) calculation.
 * ELR is the minimum of lay rate and shipping capacity.
 */

import type { EffectiveLayRateOutput } from '@/types';

/**
 * Calculate effective lay rate as the minimum of lay rate and shipping capacity.
 */
export function calculateEffectiveLayRate(layRate: number, shippingCapacity: number): EffectiveLayRateOutput {
  const effectiveLayRate = Math.min(layRate, shippingCapacity);

  let limitedBy: 'laying' | 'shipping' | 'equal';
  if (layRate < shippingCapacity) {
    limitedBy = 'laying';
  } else if (shippingCapacity < layRate) {
    limitedBy = 'shipping';
  } else {
    limitedBy = 'equal';
  }

  return {
    layRate,
    shippingCapacity,
    effectiveLayRate,
    limitedBy,
  };
}
