/**
 * Change Artifacts Action Executor
 *
 * Changes the equipped artifact loadout. This is a free action
 * but affects all subsequent calculations.
 */

import type { ActionExecutor, ExecutorContext } from '../executor';
import type { ChangeArtifactsPayload } from '@/types';

export const changeArtifactsExecutor: ActionExecutor<'change_artifacts'> = {
  execute(payload: ChangeArtifactsPayload, context: ExecutorContext): number {
    // Apply the new loadout
    context.setArtifactLoadout(payload.toLoadout);

    // Changing artifacts is free
    return 0;
  },

  getDisplayName(_payload: ChangeArtifactsPayload): string {
    return 'Change Artifacts';
  },

  getEffectDescription(payload: ChangeArtifactsPayload): string {
    // Count how many slots changed
    const changedSlots = payload.toLoadout.filter((slot, i) => {
      const from = payload.fromLoadout[i];
      return slot.artifactId !== from?.artifactId;
    }).length;

    if (changedSlots === 0) {
      return 'Stone changes only';
    }

    return `${changedSlots} artifact${changedSlots !== 1 ? 's' : ''} changed`;
  },
};
