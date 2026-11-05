/**
 * Shift Action Executor
 *
 * Handles shifting to a different virtue egg.
 * Cost is 0 (shifting is free in the game).
 */

import type { ActionExecutor, ExecutorContext } from '../executor';
import type { ShiftPayload } from '@/types';
import { VIRTUE_EGG_NAMES } from '@/types';

export const shiftExecutor: ActionExecutor<'shift'> = {
  execute(_payload: ShiftPayload, _context: ExecutorContext): number {
    // Shifting is free - the actual state change is handled by the caller
    // who updates the virtue store before computing the snapshot
    return 0;
  },

  getDisplayName(payload: ShiftPayload): string {
    const toName = VIRTUE_EGG_NAMES[payload.toEgg];
    return `Shift to ${toName}`;
  },

  getEffectDescription(payload: ShiftPayload): string {
    return `Shift #${payload.newShiftCount}`;
  },
};
