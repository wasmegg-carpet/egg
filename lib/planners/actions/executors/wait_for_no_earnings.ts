/**
 * Wait for No Earnings Action Executor
 *
 * Account for a fixed amount of time spent waiting without any growth.
 * Cost is 0.
 */

import type { PayloadExecutor, BaseExecutorContext } from '../executorTypes';
import type { WaitWithoutEarningsPayload } from '../../types/actions/wait';
import type { PlannerProfile } from '../../profile';
import { formatDuration } from '../../format';

export function createWaitForNoEarningsExecutor(profile: PlannerProfile): PayloadExecutor<WaitWithoutEarningsPayload> {
  return {
    execute(_payload: WaitWithoutEarningsPayload, _context: BaseExecutorContext): number {
      // Waiting is free
      return 0;
    },

    getDisplayName(_payload: WaitWithoutEarningsPayload): string {
      return 'Wait with Empty Silos';
    },

    getEffectDescription(payload: WaitWithoutEarningsPayload): string {
      return `Wait period WITHOUT growth, ${profile.currency.name}, or eggs — ${formatDuration(payload.totalTimeSeconds)}`;
    },
  };
}
