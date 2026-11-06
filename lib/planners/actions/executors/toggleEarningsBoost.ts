import type { PayloadExecutor, BaseExecutorContext } from '../executorTypes';
import type { ToggleEarningsBoostPayload } from '../../types/actions/research';
import { useSalesStore } from '../../stores/sales';

/**
 * Executor for toggling earnings boost.
 */
export const toggleEarningsBoostExecutor: PayloadExecutor<ToggleEarningsBoostPayload> = {
  execute(payload: ToggleEarningsBoostPayload, context: BaseExecutorContext): number {
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
