import type { PayloadExecutor } from '../executorTypes';
import type { WaitForResearchSaleEndPayload } from '../../types/actions/wait';
import { formatDuration } from '../../format';

/**
 * Executor for waiting for the running research sale to end.
 */
export const waitForResearchSaleEndExecutor: PayloadExecutor<WaitForResearchSaleEndPayload> = {
  execute() {
    // This action only progresses time, which is handled by the simulation engine.
    return 0;
  },

  getDisplayName() {
    return 'Wait: Research Sale Ends (Sat 9AM PT)';
  },

  getEffectDescription(payload: WaitForResearchSaleEndPayload) {
    return `Wait for <b>${formatDuration(payload.totalTimeSeconds)}</b> until the sale ends Saturday 9AM PT`;
  },
};
