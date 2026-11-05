import type { ActionExecutor, ExecutorContext } from '../executor';
import type { WaitForEarningsBoostPayload } from '@/types/actions/wait';
import { formatDuration } from '@/lib/format';

/**
 * Executor for waiting for 2x earnings.
 */
export const waitForEarningsBoostExecutor: ActionExecutor<'wait_for_earnings_boost'> = {
    execute() {
        // This action only progresses time, which is handled by the simulation engine.
        return 0;
    },

    getDisplayName() {
        return 'Wait: 2x Earnings (Mon 9AM PT)';
    },

    getEffectDescription(payload: WaitForEarningsBoostPayload) {
        return `Wait for <b>${formatDuration(payload.totalTimeSeconds)}</b> until next Monday 9AM PT`;
    },
};
