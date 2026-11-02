import type { ActionExecutor } from '../executor';
import type { WaitForEarningsBoostEndPayload } from '@/types/actions/wait';
import { formatDuration } from '@/lib/format';

/**
 * Executor for waiting for the running 2x earnings event to end.
 */
export const waitForEarningsBoostEndExecutor: ActionExecutor<'wait_for_earnings_boost_end'> = {
    execute() {
        // This action only progresses time, which is handled by the simulation engine.
        return 0;
    },

    getDisplayName() {
        return 'Wait: 2x Earnings Ends (Tue 9AM PT)';
    },

    getEffectDescription(payload: WaitForEarningsBoostEndPayload) {
        return `Wait for <b>${formatDuration(payload.totalTimeSeconds)}</b> until 2x earnings ends Tuesday 9AM PT`;
    },
};
