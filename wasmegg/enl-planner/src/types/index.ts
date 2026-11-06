// Core types for the Enlightenment Planner

import type { ArtifactEffectDisplay } from 'lib/planners/types';

// Types shared with the other planners (lib/planners/types)
export type {
  InitialState,
  Research,
  ResearchLevels,
  BaseCalculationResearch,
  ArtifactEffectDisplay,
  EggValueInput,
  EggValueOutput,
  HabCapacityInput,
  HabCapacityOutput,
  IHRInput,
  IHROutput,
  TimeUnit,
  LayRateInput,
  LayRateOutput,
  CurrentFarmState,
  VehicleSlot,
  ShippingCapacityInput,
  ShippingCapacityOutput,
  EffectiveLayRateInput,
  EffectiveLayRateOutput,
} from 'lib/planners/types';

// Re-export action types
export * from './actions/index';

/**
 * Input for Earnings calculation
 */
export interface EarningsInput {
  eggValue: number; // Value per egg ($/egg)
  effectiveLayRate: number; // eggs/second
  earningBonus: number; // SE × SE bonus × (1 + PE bonus)^PE × 1.01^TE
  earningsMultiplier: number; // Multiplier for all earnings (from colleggtibles)
  awayEarningsMultiplier: number; // Combined offline-earnings colleggtible multiplier
  artifactAwayMultiplier: number; // Artifact multiplier for offline earnings (lunar totem/stone - MULTIPLICATIVE)
  videoDoublerMultiplier: number; // 2x multiplier for video doubler
  eventMultiplier: number; // Multiplier from game events (e.g. 2x earnings)
  proPermit?: boolean; // false = Standard permit, which halves offline earnings. undefined = Pro
  artifactEffects: ArtifactEffectDisplay[]; // Individual effects for display
}

/**
 * Output from Earnings calculation
 */
export interface EarningsOutput {
  baseEarnings: number; // bocks/second (eggValue × ELR × (1 + earning bonus))
  earningBonus: number; // Earnings are multiplied by 1 + this
  earningsMultiplier: number; // From earnings colleggtibles (all earnings)
  awayEarningsMultiplier: number; // From offline-earnings colleggtibles (offline only)
  artifactAwayMultiplier: number; // From lunar totem/stone (offline only, MULTIPLICATIVE)
  permitAwayMultiplier: number; // 0.5 with Standard permit, 1 with Pro (offline only)
  onlineEarnings: number; // $/second
  offlineEarnings: number; // $/second
  videoDoublerMultiplier: number; // 2x multiplier if enabled
  eventMultiplier: number; // Multiplier from game events
  artifactBreakdown: ArtifactEffectDisplay[]; // Artifact effects for display
}

