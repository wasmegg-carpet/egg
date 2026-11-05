// Core types for the Enlightenment Planner

// Re-export action types
export * from './actions/index';

/**
 * Initial state data loaded from player backup
 */
export interface InitialState {
  // Player info
  playerId: string;
  nickname: string;
  lastBackupTime: number; // Unix timestamp in seconds

  // Will be expanded with more fields as we centralize inputs
}

/**
 * Research entry from researches.json
 */
export interface Research {
  serial_id: number;
  id: string;
  name: string;
  type: string;
  tier: number;
  categories: string;
  description: string;
  effect_type: string;
  levels: number;
  per_level: number;
  levels_compound: 'additive' | 'multiplicative';
  prices: number[];
}

/**
 * Research level state - how many levels the user has purchased
 */
export interface ResearchLevels {
  [researchId: string]: number;
}

/**
 * Shared research definition for calculations.
 */
export interface BaseCalculationResearch {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  perLevel: number;
}

/**
 * Artifact effect for display in breakdowns
 */
export interface ArtifactEffectDisplay {
  source: 'artifact' | 'stone';
  label: string; // e.g., "T4L Demeters necklace"
  effect: string; // e.g., "+100% egg value"
  effectDelta: number; // e.g., 1.0
}

/**
 * Input for egg value calculation
 */
export interface EggValueInput {
  baseValue: number;
  researchLevels: ResearchLevels;
  artifactMultiplier: number; // Combined artifact/stone multiplier
  artifactEffects: ArtifactEffectDisplay[]; // Individual effects for display
}

/**
 * Output from egg value calculation - detailed breakdown
 */
export interface EggValueOutput {
  baseValue: number;
  researchMultiplier: number;
  artifactMultiplier: number;
  finalValue: number;

  // Breakdown per research for display
  researchBreakdown: {
    researchId: string;
    name: string;
    description: string;
    level: number;
    maxLevel: number;
    multiplier: number;
  }[];

  // Artifact breakdown for display
  artifactBreakdown: ArtifactEffectDisplay[];
}

/**
 * Input for hab capacity calculation
 */
export interface HabCapacityInput {
  habIds: (number | null)[]; // Array of 1-4 hab IDs (null = empty slot)
  researchLevels: ResearchLevels;
  habCapMultiplier: number; // Combined hab-capacity colleggtible multiplier (e.g., 1.05 = +5%)
  artifactMultiplier: number; // Combined artifact/stone multiplier (Gusset)
  artifactEffects: ArtifactEffectDisplay[]; // Individual effects for display
}

/**
 * Output from hab capacity calculation - detailed breakdown
 */
export interface HabCapacityOutput {
  // Per-hab breakdown
  habBreakdown: {
    slotIndex: number;
    habId: number | null;
    habName: string | null;
    baseCapacity: number;
    researchMultiplier: number;
    habCapMultiplier: number;
    artifactMultiplier: number;
    finalCapacity: number;
  }[];

  // Totals
  totalBaseCapacity: number;
  researchMultiplier: number; // Universal research multiplier
  portalResearchMultiplier: number; // Portal-only research multiplier
  habCapMultiplier: number;
  artifactMultiplier: number;
  totalFinalCapacity: number;

  // Research breakdown for display
  researchBreakdown: {
    researchId: string;
    name: string;
    description: string;
    level: number;
    maxLevel: number;
    multiplier: number;
    portalOnly: boolean;
  }[];

  // Artifact breakdown for display
  artifactBreakdown: ArtifactEffectDisplay[];
}

/**
 * Input for IHR (Internal Hatchery Rate) calculation
 */
export interface IHRInput {
  te: number; // Eggs of Truth (0-490), each provides 1.1x multiplier
  researchLevels: ResearchLevels;
  epicResearchLevels: {
    epicInternalIncubators: number; // Epic Int. Hatcheries (0-20)
    internalHatcheryCalm: number; // Internal Hatchery Calm (0-20)
  };
  ihrMultiplier: number; // Combined IHR colleggtible multiplier (e.g., 1.05 = +5%)
  artifactMultiplier: number; // Combined artifact/stone multiplier (The chalice, Life stone)
  artifactEffects: ArtifactEffectDisplay[]; // Individual effects for display
}

/**
 * Output from IHR calculation - detailed breakdown
 */
export interface IHROutput {
  // Base rate per hab (before multipliers)
  baseRatePerHab: number;

  // Multipliers
  teMultiplier: number; // From Eggs of Truth (1.01^TE)
  epicMultiplier: number; // From Epic Int. Hatcheries
  ihrMultiplier: number; // From IHR colleggtibles
  artifactMultiplier: number; // From artifacts (The chalice, Life stone)
  offlineMultiplier: number; // From Internal Hatchery Calm

  // Final rates (for 4 habs)
  onlineRate: number; // chickens/min when app is open
  offlineRate: number; // chickens/min when app is closed
  isClampedByMinRate: boolean;

  // Research breakdown for display
  researchBreakdown: {
    researchId: string;
    name: string;
    description: string;
    level: number;
    maxLevel: number;
    contribution: number; // chickens/min added (for additive) or multiplier (for multiplicative)
    isMultiplicative: boolean;
    isOfflineOnly: boolean;
    isEpic: boolean;
  }[];

  // Artifact breakdown for display
  artifactBreakdown: ArtifactEffectDisplay[];
}

/**
 * Time unit for rate displays
 */
export type TimeUnit = 'minute' | 'hour' | 'day';

/**
 * Input for Lay Rate calculation
 */
export interface LayRateInput {
  researchLevels: ResearchLevels;
  epicComfyNestsLevel: number; // Epic Comfy Nests (0-20)
  elrMultiplier: number; // Combined lay-rate colleggtible multiplier (e.g., 1.05 = +5%)
  population: number; // Current chicken population for total eggs calculation
  artifactMultiplier: number; // Combined artifact/stone multiplier (Quantum metronome, Tachyon stone)
  artifactEffects: ArtifactEffectDisplay[]; // Individual effects for display
}

/**
 * Output from Lay Rate calculation - detailed breakdown
 */
export interface LayRateOutput {
  // Base rate (eggs/chicken/second)
  baseRatePerSecond: number;

  // Multipliers
  researchMultiplier: number; // Combined multiplier from all common researches
  epicMultiplier: number; // From Epic Comfy Nests
  elrMultiplier: number; // From lay-rate colleggtibles
  artifactMultiplier: number; // From artifacts (Quantum metronome, Tachyon stone)

  // Final rates per chicken (eggs/second)
  ratePerChickenPerSecond: number;

  // Total rates (eggs/second) - multiply by population
  totalRatePerSecond: number;

  // Research breakdown for display
  researchBreakdown: {
    researchId: string;
    name: string;
    description: string;
    level: number;
    maxLevel: number;
    multiplier: number; // 1 + perLevel * level
    isEpic: boolean;
  }[];

  // Artifact breakdown for display
  artifactBreakdown: ArtifactEffectDisplay[];
}

/**
 * Current farm state from player backup
 */
export interface CurrentFarmState {
  eggType: number;
  cash: number;
  numSilos: number;
  commonResearches: ResearchLevels;
  habs: (number | null)[];
  vehicles: VehicleSlot[];
  population: number;
  deliveredEggs: number;
  lastStepTime: number;
  cashEarned: number;
  cashSpent: number;
}

/**
 * Vehicle slot configuration
 */
export interface VehicleSlot {
  vehicleId: number | null; // null = empty slot
  trainLength: number; // Only used for Hyperloop (id=11), otherwise 1
}

/**
 * Input for Shipping Capacity calculation
 */
export interface ShippingCapacityInput {
  vehicles: VehicleSlot[]; // Array of vehicle slots (4-17 depending on research)
  researchLevels: ResearchLevels;
  transportationLobbyistLevel: number; // Epic research (0-30): +5% shipping capacity per level
  shippingCapMultiplier: number; // Combined shipping-capacity colleggtible multiplier
  artifactMultiplier: number; // Combined artifact/stone multiplier (Compass, Quantum stone)
  artifactEffects: ArtifactEffectDisplay[]; // Individual effects for display
}

/**
 * Output from Shipping Capacity calculation - detailed breakdown
 */
export interface ShippingCapacityOutput {
  // Per-vehicle breakdown
  vehicleBreakdown: {
    slotIndex: number;
    vehicleId: number | null;
    vehicleName: string | null;
    trainLength: number;
    baseCapacity: number; // eggs/second before multipliers
    universalMultiplier: number; // from universal research
    hoverMultiplier: number; // from hover-only research (if applicable)
    hyperloopMultiplier: number; // from hyperloop-only research (if applicable)
    shippingCapMultiplier: number;
    artifactMultiplier: number; // from artifacts (Compass, Quantum stone)
    finalCapacity: number; // eggs/second after all multipliers
  }[];

  // Totals
  totalBaseCapacity: number; // eggs/second
  universalMultiplier: number;
  epicMultiplier: number; // from Transportation Lobbyists
  hoverMultiplier: number; // for hover vehicles
  hyperloopMultiplier: number; // for hyperloop
  shippingCapMultiplier: number;
  totalFinalCapacity: number; // eggs/second

  // Fleet info
  maxVehicleSlots: number; // 4 + fleet size research
  maxTrainLength: number; // 5 + graviton coupling research

  // Research breakdown for display
  researchBreakdown: {
    researchId: string;
    name: string;
    description: string;
    level: number;
    maxLevel: number;
    multiplier: number;
    hoverOnly: boolean;
    hyperloopOnly: boolean;
  }[];

  // Fleet size research breakdown
  fleetSizeBreakdown: {
    researchId: string;
    name: string;
    level: number;
    maxLevel: number;
    slotsAdded: number;
  }[];

  // Artifact breakdown for display
  artifactMultiplier: number;
  artifactBreakdown: ArtifactEffectDisplay[];
}

/**
 * Input for Effective Lay Rate calculation
 */
export interface EffectiveLayRateInput {
  layRate: number;
  shippingCapacity: number;
}

/**
 * Output from Effective Lay Rate calculation
 */
export interface EffectiveLayRateOutput {
  layRate: number; // eggs/second from lay rate calculation
  shippingCapacity: number; // eggs/second from shipping calculation
  effectiveLayRate: number; // min(layRate, shippingCapacity)
  limitedBy: 'laying' | 'shipping' | 'equal';
}

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


