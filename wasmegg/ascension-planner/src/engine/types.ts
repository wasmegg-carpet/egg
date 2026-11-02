import type { CalculationsSnapshot, VehicleSlot, ResearchLevels, ArtifactSlotPayload, VirtueEgg } from '@/types';
import type { Modifiers as ColleggtibleModifiers } from 'lib/collegtibles';

/**
 * The minimal mutable state required to compute the next state.
 * This corresponds to the "input" fields of CalculationsSnapshot.
 */
export interface EngineState {
  // Virtue State
  currentEgg: VirtueEgg;
  shiftCount: number;
  te: number;
  soulEggs: number;
  bankValue: number;

  // Farm State
  habIds: (number | null)[];
  vehicles: VehicleSlot[];
  researchLevels: ResearchLevels;
  siloCount: number;
  tankLevel: number;
  /** false = Standard permit (offline earnings halved, 2 silos, 2 artifacts). undefined = Pro. */
  proPermit?: boolean;

  // Artifacts
  artifactLoadout: ArtifactSlotPayload[];
  activeArtifactSet: import('@/types').ArtifactSetName | null;
  artifactSets: Record<import('@/types').ArtifactSetName, ArtifactSlotPayload[] | null>;

  // Progress State
  fuelTankAmounts: Record<VirtueEgg, number>;
  eggsDelivered: Record<VirtueEgg, number>;
  teEarned: Record<VirtueEgg, number>;

  population: number;
  lastStepTime: number;

  activeSales: {
    research: boolean;
    hab: boolean;
    vehicle: boolean;
  };
  earningsBoost: {
    active: boolean;
    multiplier: number;
  };
  maxELR?: number;
}

/**
 * Context that remains constant during a simulation run.
 */
export interface SimulationContext {
  epicResearchLevels: ResearchLevels;
  colleggtibleModifiers: ColleggtibleModifiers;
  ascensionStartTime: number; // Unix timestamp in seconds
  planStartOffset: number; // Seconds since ascension start at which planning begins
  assumeDoubleEarnings: boolean;
  rawBackup?: any; // ei.IBackup
  /**
   * Auto planner only: the artifact/stone inputs this ascension runs with. When set, C1/C3/H1 read
   * the earnings set, delivery candidates and stones from here instead of from `rawBackup`.
   */
  loadoutInputs?: import('@/auto/loadout/types').AutoLoadoutInputs;
  deferForEarningsMode: boolean;
  // TODO: Add any other global context needed (e.g. events?)
}

/**
 * Result of a simulation step.
 * Using existing types to minimize friction.
 */
export type SimulationResult = CalculationsSnapshot;
