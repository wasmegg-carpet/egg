/**
 * Wait for Gems Action Executor
 *
 * Account for time spent waiting to reach a target gem count.
 * Cost is 0 gems.
 */

import type { PayloadExecutor, BaseExecutorContext } from 'lib/planners/actions/executorTypes';
import type { WaitForGemsPayload } from '@/types';
import { formatDuration, formatNumber } from '@/lib/format';

export const waitForGemsExecutor: PayloadExecutor<WaitForGemsPayload> = {
    execute(_payload: WaitForGemsPayload, _context: BaseExecutorContext): number {
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
