import type { VirtueEgg } from './virtue';
import type { LaunchMissionEntry } from 'lib/planners/types/actions/missions';
export type {
  ActiveMissionInfo,
  LaunchMissionEntry,
  WaitForMissionsPayload,
} from 'lib/planners/types/actions/missions';

/**
 * Payload for launching rocket missions.
 */
export interface LaunchMissionsPayload {
  missions: LaunchMissionEntry[];
  totalTimeSeconds: number;
  totalMissions: number;
  fuelConsumed: Record<VirtueEgg, number>;
  isZeroTime?: boolean;
}
