/**
 * Wait for No Earnings Action Executor
 *
 * Account for a fixed amount of time spent waiting without any growth.
 * Cost is 0 gems.
 */

import type { ActionExecutor, ExecutorContext } from '../executor';
import type { WaitWithoutEarningsPayload } from '@/types';
import { formatDuration } from '@/lib/format';

export const waitForNoEarningsExecutor: ActionExecutor<'wait_for_no_earnings'> = {
    execute(_payload: WaitWithoutEarningsPayload, _context: ExecutorContext): number {
        // Waiting is free
        return 0;
    },

    getDisplayName(_payload: WaitWithoutEarningsPayload): string {
        return 'Wait with Empty Silos';
    },

    getEffectDescription(payload: WaitWithoutEarningsPayload): string {
        return `Wait period WITHOUT growth, gems, or eggs — ${formatDuration(payload.totalTimeSeconds)}`;
    },
};
