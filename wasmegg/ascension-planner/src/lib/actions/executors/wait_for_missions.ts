import type { WaitForMissionsPayload } from '@/types';
import type { PayloadExecutor, BaseExecutorContext } from 'lib/planners/actions/executorTypes';
import { formatDuration } from '@/lib/format';

export const waitForMissionsExecutor: PayloadExecutor<WaitForMissionsPayload> = {
  execute(payload: WaitForMissionsPayload, context: BaseExecutorContext): number {
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
