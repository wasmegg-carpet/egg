import type { WaitForMissionsPayload } from '@/types';
import type { ActionExecutor, ExecutorContext } from '../executor';
import { formatDuration } from '@/lib/format';

export const waitForMissionsExecutor: ActionExecutor<'wait_for_missions'> = {
  execute(payload: WaitForMissionsPayload, context: ExecutorContext): number {
    // This action doesn't buy anything, it just consumes time.
    // The time consumption is handled by the payload's totalTimeSeconds
    // which is added to the total ascension time by the simulation engine.
    return 0; // Cost is always 0
  },

  getDisplayName(): string {
    return 'Wait for Missions';
  },

  getEffectDescription(payload: WaitForMissionsPayload): string {
    const inFlightMissions = payload.missions.filter(m => !m.statusIsFueling);
    const missionCount = inFlightMissions.length;
    return `Waiting for ${missionCount} active virtue mission${missionCount === 1 ? '' : 's'} to return — ${formatDuration(payload.totalTimeSeconds)}.`;
  },
};
