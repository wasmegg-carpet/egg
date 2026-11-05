import type { ActionExecutor } from '../executor';
import type { WaitForFullHabsPayload } from '@/types';
import { formatDuration } from '@/lib/format';

export const waitForFullHabsExecutor: ActionExecutor<'wait_for_full_habs'> = {
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
