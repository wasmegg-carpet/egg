import type { ActionExecutor, ExecutorContext } from '../executor';
import type { ToggleEarningsBoostPayload } from '@/types';
import { useSalesStore } from '@/stores/sales';

/**
 * Executor for toggling earnings boost.
 */
export const toggleEarningsBoostExecutor: ActionExecutor<'toggle_earnings_boost'> = {
  execute(payload: ToggleEarningsBoostPayload, context: ExecutorContext): number {
    const salesStore = useSalesStore();
    salesStore.setEarningsBoost(payload.active, payload.multiplier);
    return 0;
  },

  getDisplayName(payload: ToggleEarningsBoostPayload): string {
    if (!payload.active) return 'Earnings Boost Ended';
    return `${payload.multiplier}x Earnings Boost`;
  },

  getEffectDescription(payload: ToggleEarningsBoostPayload): string {
    if (!payload.active) return 'The global earnings boost has expired';
    return `Global earnings are multiplied by ${payload.multiplier}`;
  },
};
