import type { VirtueEgg } from './virtue';

/**
 * A single mission type entry in a launch_missions payload.
 */
export interface LaunchMissionEntry {
  ship: number; // Spaceship enum value
  duration: number; // DurationType enum value
  count: number;
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
