import type { PayloadExecutor } from '../executorTypes';
import type { WaitForFullHabsPayload } from '../../types/actions/wait';
import { formatDuration } from '../../format';

export const waitForFullHabsExecutor: PayloadExecutor<WaitForFullHabsPayload> = {
  execute() {
    // Stores are not updated here as population is not a store-backed value in the same way
    // research or artifact sets are. The engine handles population growth during simulation.
    return 0;
  },

  getDisplayName() {
    return 'Wait for Full Habs';
  },

  getEffectDescription(payload: WaitForFullHabsPayload) {
    return `Wait ${formatDuration(payload.totalTimeSeconds)} until habs are full.`;
  },
};
