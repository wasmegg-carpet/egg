/**
 * Wait for Currency Action Executor
 *
 * Accounts for time spent waiting for the bank to reach a target amount. Costs nothing.
 */

import type { PayloadExecutor, BaseExecutorContext } from '../executorTypes';
import type { PlannerProfile } from '../../profile';
import { currencyWaitTarget, type CurrencyWaitPayload } from '../currencyWait';
import { formatDuration, formatNumber } from '../../format';

export function createWaitForCurrencyExecutor(profile: PlannerProfile): PayloadExecutor<CurrencyWaitPayload> {
  return {
    execute(_payload: CurrencyWaitPayload, _context: BaseExecutorContext): number {
      return 0;
    },

    getDisplayName(): string {
      return `Wait for ${profile.currency.title}`;
    },

    getEffectDescription(payload: CurrencyWaitPayload): string {
      return `Wait period — ${formatDuration(payload.timeSeconds)} to reach ${formatNumber(currencyWaitTarget(payload))} ${profile.currency.name}`;
    },
  };
}
