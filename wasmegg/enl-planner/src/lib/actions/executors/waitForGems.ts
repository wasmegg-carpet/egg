/**
 * Wait for Gems Action Executor
 *
 * Account for time spent waiting to reach a target gem count.
 * Cost is 0 gems.
 */

import type { ActionExecutor, ExecutorContext } from '../executor';
import type { WaitForGemsPayload } from '@/types';
import { formatDuration, formatNumber } from '@/lib/format';

export const waitForGemsExecutor: ActionExecutor<'wait_for_gems'> = {
    execute(_payload: WaitForGemsPayload, _context: ExecutorContext): number {
        // Waiting for gems is free
        return 0;
    },

    getDisplayName(_payload: WaitForGemsPayload): string {
        return 'Wait for Gems';
    },

    getEffectDescription(payload: WaitForGemsPayload): string {
        return `Wait period — ${formatDuration(payload.timeSeconds)} to reach ${formatNumber(payload.targetGems)} gems`;
    },
};
