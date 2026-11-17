/**
 * Mission action payloads shared by the planners.
 */

/**
 * A single mission type entry in a launch_missions payload.
 */
export interface LaunchMissionEntry {
  ship: number; // Spaceship enum value
  duration: number; // DurationType enum value
  count: number;
  targetAfxId?: number; // absent means untargeted
  // Launched inside a 2x mission capacity event, per the artifact explorer's plan. Only an imported plan says
  // so, and the planners do not model what a mission brings home, so it is carried for display only.
  doubled?: true;
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
