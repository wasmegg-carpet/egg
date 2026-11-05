import type { ActionExecutor, ExecutorContext } from '../executor';
import type { WaitForResearchSalePayload } from '@/types/actions/wait';
import { formatDuration } from '@/lib/format';

/**
 * Executor for waiting for the next research sale.
 */
export const waitForResearchSaleExecutor: ActionExecutor<'wait_for_research_sale'> = {
    execute() {
        // This action only progresses time, which is handled by the simulation engine.
        return 0;
    },

    getDisplayName() {
        return 'Wait: Research Sale (Fri 9AM PT)';
    },

    getEffectDescription(payload: WaitForResearchSalePayload) {
        return `Wait for <b>${formatDuration(payload.totalTimeSeconds)}</b> until next Friday 9AM PT`;
    },
};
