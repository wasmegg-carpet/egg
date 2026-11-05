/**
 * Remove Fuel Action Executor
 *
 * Removes eggs from the fuel tank.
 * Cost is 0 gems and 0 seconds.
 */

import type { ActionExecutor, ExecutorContext } from '../executor';
import type { RemoveFuelPayload } from '@/types';
import { VIRTUE_EGG_NAMES } from '@/types';
import { formatNumber } from '@/lib/format';

export const removeFuelExecutor: ActionExecutor<'remove_fuel'> = {
  execute(payload: RemoveFuelPayload, context: ExecutorContext): number {
    const { egg, amount } = payload;

    // Remove fuel from tank
    context.removeFuel(egg, amount);

    // Removing fuel is free
    return 0;
  },

  getDisplayName(payload: RemoveFuelPayload): string {
    return `Remove ${formatNumber(payload.amount, 1)} ${VIRTUE_EGG_NAMES[payload.egg]}`;
  },

  getEffectDescription(payload: RemoveFuelPayload): string {
    return `-${formatNumber(payload.amount, 1)} eggs`;
  },
};
