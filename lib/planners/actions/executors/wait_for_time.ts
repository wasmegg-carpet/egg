/**
 * Wait for Time Action Executor
 *
 * Account for a fixed amount of time spent waiting.
 * Cost is 0.
 */

import type { PayloadExecutor, BaseExecutorContext } from '../executorTypes';
import type { WaitForTimePayload } from '../../types/actions/wait';
import { formatDuration } from '../../format';

export const waitForTimeExecutor: PayloadExecutor<WaitForTimePayload> = {
  execute(_payload: WaitForTimePayload, _context: BaseExecutorContext): number {
    // Waiting for time is free
    return 0;
  },

  getDisplayName(_payload: WaitForTimePayload): string {
    return 'Wait for Time';
  },

  getEffectDescription(payload: WaitForTimePayload): string {
    return `Wait period — ${formatDuration(payload.totalTimeSeconds)}`;
  },
};
