import type { VirtueEgg } from './virtue';

/**
 * A single mission type entry in a launch_missions payload.
 *
 * `targetAfxId` is an `ei.ArtifactSpec.Name` — the protobuf's own numbering, shared with lib and
 * with the artifact explorer, so there is no second copy of it here to drift. It is recorded and
 * displayed and changes no calculation. Only the Humility plan import writes it; entries built by
 * hand in Rocket Actions have no target and leave it absent.
 *
 * Optional and additive, so plans saved before it existed keep loading and the plan-save version
 * does not move.
 */
export interface LaunchMissionEntry {
  ship: number; // Spaceship enum value
  duration: number; // DurationType enum value
  count: number;
  targetAfxId?: number; // ei.ArtifactSpec.Name; absent means untargeted
}

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

/**
 * Information about an active mission from the backup.
 */
export interface ActiveMissionInfo {
  ship: number; // Spaceship enum value
  duration: number; // DurationType enum value
  shipName: string;
  durationTypeName: string;
  shipIconPath: string;
  sensorTarget: string | null;
  returnTimestamp: number | null; // Unix timestamp in seconds
  statusIsFueling: boolean;
  statusName: string;
  capacity: number;
  durationSeconds: number | null;
  fuels: {
    egg: number;
    amount: number;
    eggIconPath: string;
  }[];
}

/**
 * Payload for waiting for active missions to return.
 */
export interface WaitForMissionsPayload {
  missions: ActiveMissionInfo[];
  totalTimeSeconds: number;
}
