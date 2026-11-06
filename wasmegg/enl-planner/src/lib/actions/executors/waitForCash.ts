/**
 * Wait for Bocks Action Executor
 *
 * Account for time spent waiting to reach a target bock count.
 * Cost is 0 bocks.
 */

import type { PayloadExecutor, BaseExecutorContext } from 'lib/planners/actions/executorTypes';
import type { WaitForCashPayload } from '@/types';
import { formatDuration, formatNumber } from '@/lib/format';

export const waitForCashExecutor: PayloadExecutor<WaitForCashPayload> = {
    execute(_payload: WaitForCashPayload, _context: BaseExecutorContext): number {
        // Waiting for bocks is free
        return 0;
    },

    getDisplayName(_payload: WaitForCashPayload): string {
        return 'Wait for Bocks';
    },

    getEffectDescription(payload: WaitForCashPayload): string {
        return `Wait period — ${formatDuration(payload.timeSeconds)} to reach ${formatNumber(payload.targetCash)} bocks`;
    },
};
