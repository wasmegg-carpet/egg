/**
 * Buy Silo Action Executor
 *
 * Purchases a silo to increase offline/away time.
 * Cost formula: 100M * n^(3*n+15) where n = current silos owned
 */

import type { ActionExecutor, ExecutorContext } from '../executor';
import type { BuySiloPayload } from '@/types';
import { nextSiloCost, formatSiloTime, awayTimePerSilo } from '@/stores/silos';

export const buySiloExecutor: ActionExecutor<'buy_silo'> = {
  execute(payload: BuySiloPayload, context: ExecutorContext): number {
    const { fromCount, toCount } = payload;

    // Calculate cost - cost is based on current count (fromCount)
    const cost = nextSiloCost(fromCount);

    // Apply changes to store
    context.setSiloCount(toCount);

    return cost;
  },

  getDisplayName(payload: BuySiloPayload): string {
    return `Silo #${payload.toCount}`;
  },

  getEffectDescription(_payload: BuySiloPayload): string {
    // Note: Actual time depends on Silo Capacity epic research
    // Show base time here; full calculation available in action details
    const baseMinutes = awayTimePerSilo(0); // Base 60 minutes without research
    return `+${formatSiloTime(baseMinutes)}+ away time`;
  },
};
