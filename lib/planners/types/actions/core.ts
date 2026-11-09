/**
 * Core action payloads shared by the planners.
 */

import type { ResearchLevels, VehicleSlot } from '../index';
import type { ArtifactSetName, ArtifactSlotPayload } from './artifacts';

/**
 * Payload for generic notifications or markers in history.
 */
export interface NotificationPayload {
  message: string;
  submessage?: string;
  icon?: string;
}

/**
 * Payload for manually overriding the bank value.
 * `mode: 'set'` replaces the bank value outright (amount is the new total);
 * `mode: 'delta'` adds/subtracts a fixed amount (amount is the +/- adjustment).
 */
export interface ModifyBankPayload {
  mode: 'set' | 'delta';
  amount: number;
  previousValue: number;
  delta: number;
}

/**
 * The parts of a calculation snapshot every planner has. Each planner's `CalculationsSnapshot`
 * extends this with its own egg/fuel bookkeeping and full outputs.
 */
export interface BaseCalculationsSnapshot {
  eggValue: number;
  habCapacity: number;
  elr: number;
  shippingCapacity: number;
  layRate: number;
  onlineEarnings: number;
  offlineEarnings: number;
  onlineIHR: number;
  offlineIHR: number;
  ratePerChickenPerSecond: number;
  bankValue: number;
  te: number;
  soulEggs: number;
  siloCount: number;
  siloTimeMinutes: number;
  tankLevel: number;
  /** false = Standard permit. undefined = Pro (snapshots from before Standard was supported). */
  proPermit?: boolean;
  population: number;
  lastStepTime: number;
  vehicles: VehicleSlot[];
  habIds: (number | null)[];
  researchLevels: ResearchLevels;
  artifactLoadout: ArtifactSlotPayload[];
  activeArtifactSet: ArtifactSetName | null;
  artifactSets: Record<ArtifactSetName, ArtifactSlotPayload[] | null>;
  activeSales: {
    research: boolean;
    hab: boolean;
    vehicle: boolean;
  };
  earningsBoost: {
    active: boolean;
    multiplier: number;
  };
}
