import type { WaitForMissionsPayload } from '../../types/actions/missions';
import type { PayloadExecutor, BaseExecutorContext } from '../executorTypes';
import type { PlannerProfile } from '../../profile';
import { formatDuration } from '../../format';

export function createWaitForMissionsExecutor(profile: PlannerProfile): PayloadExecutor<WaitForMissionsPayload> {
  return {
    execute(payload: WaitForMissionsPayload, context: BaseExecutorContext): number {
      // This action doesn't buy anything, it just consumes time.
      // The time consumption is handled by the payload's totalTimeSeconds
      // which is added to the total plan time by the simulation engine.
      return 0; // Cost is always 0
    },

    getDisplayName(): string {
      return 'Wait for Missions';
    },

    getEffectDescription(payload: WaitForMissionsPayload): string {
      const inFlightMissions = payload.missions.filter(m => !m.statusIsFueling);
      const missionCount = inFlightMissions.length;
      return `Waiting for ${missionCount} active ${profile.missions.noun}${missionCount === 1 ? '' : 's'} to return — ${formatDuration(payload.totalTimeSeconds)}.`;
    },
  };
}
