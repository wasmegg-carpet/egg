/**
 * Wait for Bocks Action Executor
 *
 * Account for time spent waiting to reach a target bock count.
 * Cost is 0 bocks.
 */

import type { ActionExecutor, ExecutorContext } from '../executor';
import type { WaitForCashPayload } from '@/types';
import { formatDuration, formatNumber } from '@/lib/format';

export const waitForCashExecutor: ActionExecutor<'wait_for_cash'> = {
    execute(_payload: WaitForCashPayload, _context: ExecutorContext): number {
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
