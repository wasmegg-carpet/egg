/**
 * Start Ascension Executor
 *
 * This is a special action that represents the initial state of an ascension.
 * It is created automatically and cannot be undone.
 * Cost is always 0 - it represents the starting point.
 */

import type { ActionExecutor } from '../executor';
import type { StartAscensionPayload } from '@/types';
import { VIRTUE_EGG_NAMES } from '@/types';

export const startAscensionExecutor: ActionExecutor<'start_ascension'> = {
  execute(_payload: StartAscensionPayload, _context) {
    // No state changes - the initial state is already set in stores
    // Cost is 0 since this is the starting point
    return 0;
  },

  getDisplayName(payload: StartAscensionPayload) {
    const eggName = VIRTUE_EGG_NAMES[payload.initialEgg];
    return `Start Ascension (${eggName})`;
  },

  getEffectDescription(_payload: StartAscensionPayload) {
    return 'Initial state for this ascension plan';
  },
};
