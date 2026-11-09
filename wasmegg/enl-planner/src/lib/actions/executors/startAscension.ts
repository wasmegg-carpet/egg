/**
 * Start Plan Executor
 *
 * This is a special action that represents the initial state of a plan.
 * It is created automatically and cannot be undone.
 * Cost is always 0 - it represents the starting point.
 */

import type { PayloadExecutor } from 'lib/planners/actions/executorTypes';
import type { StartAscensionPayload } from '@/types';

export const startAscensionExecutor: PayloadExecutor<StartAscensionPayload> = {
  execute(_payload: StartAscensionPayload, _context) {
    // No state changes - the initial state is already set in stores
    // Cost is 0 since this is the starting point
    return 0;
  },

  getDisplayName() {
    return 'Start Enlightenment';
  },

  getEffectDescription(_payload: StartAscensionPayload) {
    return 'Initial state for this enlightenment plan';
  },
};
