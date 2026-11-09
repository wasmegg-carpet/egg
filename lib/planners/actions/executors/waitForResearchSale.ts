import type { PayloadExecutor, BaseExecutorContext } from '../executorTypes';
import type { WaitForResearchSalePayload } from '../../types/actions/wait';
import { formatDuration } from '../../format';

/**
 * Executor for waiting for the next research sale.
 */
export const waitForResearchSaleExecutor: PayloadExecutor<WaitForResearchSalePayload> = {
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
