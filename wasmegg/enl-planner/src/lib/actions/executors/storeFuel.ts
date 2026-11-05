/**
 * Store Fuel Action Executor
 *
 * Stores eggs in the fuel tank. Takes time based on lay rate at max habs.
 * Cost is 0 (free action, just time-based).
 */

import type { ActionExecutor, ExecutorContext } from '../executor';
import type { StoreFuelPayload } from '@/types';
import { VIRTUE_EGG_NAMES } from '@/types';
import { formatNumber, formatDuration } from '@/lib/format';

export const storeFuelExecutor: ActionExecutor<'store_fuel'> = {
  execute(payload: StoreFuelPayload, context: ExecutorContext): number {
    const { egg, amount } = payload;

    // Add fuel to tank
    context.addFuel(egg, amount);

    // Storing fuel is free (time-based, not cost-based)
    return 0;
  },

  getDisplayName(payload: StoreFuelPayload): string {
    const speed = payload.fuelSpeed ?? 1.0;
    const speedLabel = speed < 1.0 ? ` @ ${Math.round(speed * 100)}%` : '';
    return `Store ${formatNumber(payload.amount, 1)} ${VIRTUE_EGG_NAMES[payload.egg]}${speedLabel}`;
  },

  getEffectDescription(payload: StoreFuelPayload): string {
    const speed = payload.fuelSpeed ?? 1.0;
    let desc = `+${formatNumber(payload.amount, 1)} eggs (${formatDuration(payload.timeSeconds)})`;
    if (speed < 1.0 && (payload.eggsShippedDuringFuel ?? 0) > 0) {
      desc += ` · Ship ${formatNumber(payload.eggsShippedDuringFuel!, 1)}`;
      if ((payload.gemsEarnedDuringFuel ?? 0) > 0) {
        desc += ` · +${formatNumber(payload.gemsEarnedDuringFuel!, 1)} gems`;
      }
    }
    return desc;
  },
};
