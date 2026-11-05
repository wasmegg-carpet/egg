/**
 * Wait for Boks Action Executor
 *
 * Account for time spent waiting to reach a target bok count.
 * Cost is 0 boks.
 */

import type { ActionExecutor, ExecutorContext } from '../executor';
import type { WaitForCashPayload } from '@/types';
import { formatDuration, formatNumber } from '@/lib/format';

export const waitForCashExecutor: ActionExecutor<'wait_for_cash'> = {
    execute(_payload: WaitForCashPayload, _context: ExecutorContext): number {
        // Waiting for boks is free
        return 0;
    },

    getDisplayName(_payload: WaitForCashPayload): string {
        return 'Wait for Boks';
    },

    getEffectDescription(payload: WaitForCashPayload): string {
        return `Wait period — ${formatDuration(payload.timeSeconds)} to reach ${formatNumber(payload.targetCash)} boks`;
    },
};
