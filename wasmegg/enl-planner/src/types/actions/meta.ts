import type { ActionPayloadMap, ActionType, CalculationsSnapshot } from './core';
import type { VirtueEgg } from './virtue';
import type { ArtifactSlotPayload } from './artifacts';
import type { VehicleSlot, ResearchLevels } from '../index';

/**
 * Base action interface.
 */
export interface BaseAction {
  id: string;
  index: number;
  timestamp: number;
  type: ActionType;
  cost: number;
  elrDelta: number;
  offlineEarningsDelta: number;
  eggValueDelta: number;
  habCapacityDelta: number;
  layRateDelta: number;
  shippingCapacityDelta: number;
  ihrDelta: number;
  bankDelta: number;
  populationDelta: number;
  endState: CalculationsSnapshot;
  totalTimeSeconds: number;
  dependsOn: string[];
  dependents: string[];
}

/**
 * Typed action with payload.
 * Defined as a union of all possible action types to ensure payload type safety.
 */
export type Action<T extends ActionType = ActionType> = {
  [K in T]: BaseAction & {
    type: K;
    payload: ActionPayloadMap[K];
  };
}[T];

/**
 * A minimal action structure used for temporary simulations.
 * Uses a mapped type to ensure the payload matches the action type.
 */
export type SimulatedAction = {
  [T in ActionType]: Pick<BaseAction, 'type' | 'cost'> & {
    type: T;
    payload: ActionPayloadMap[T];
  } & Partial<BaseAction>;
}[ActionType];

/**
 * Create a minimal action for simulation purposes.
 * Returns an Action with default values for deltas, ready to be hydrated.
 */
export function createSimAction<T extends ActionType>(
  type: T,
  payload: ActionPayloadMap[T],
  cost: number = 0
): Action<T> {
  return {
    id: `sim_${Math.random().toString(36).substring(2, 9)}`,
    index: 0,
    timestamp: Math.floor(Date.now() / 1000),
    type,
    payload,
    cost,
    elrDelta: 0,
    offlineEarningsDelta: 0,
    eggValueDelta: 0,
    habCapacityDelta: 0,
    layRateDelta: 0,
    shippingCapacityDelta: 0,
    ihrDelta: 0,
    bankDelta: 0,
    populationDelta: 0,
    totalTimeSeconds: 0,
    dependsOn: [],
    dependents: [],
    // We cast this placeholder because it will be hydrated immediately in the simulation loop
    endState: {} as CalculationsSnapshot,
  } as Action<T>;
}

/**
 * An action structure used when creating new actions.
 * It contains the core data but lacks the calculated fields like index, endState, and deltas.
 */
export type DraftAction = Omit<
  Action,
  | 'index'
  | 'dependents'
  | 'elrDelta'
  | 'offlineEarningsDelta'
  | 'eggValueDelta'
  | 'habCapacityDelta'
  | 'layRateDelta'
  | 'shippingCapacityDelta'
  | 'ihrDelta'
  | 'bankDelta'
  | 'populationDelta'
  | 'endState'
  | 'totalTimeSeconds'
> & {
  dependsOn: string[];
};

/**
 * Result of validating an undo operation.
 */
export interface UndoValidation {
  valid: boolean;
  action?: Action;
  dependentActions: Action[];
  needsRecursiveUndo: boolean;
}

/**
 * Context passed to action executors.
 */
export interface StoreContext {
  habCapacity: {
    setHab(slotIndex: number, habId: number | null): void;
    habIds: (number | null)[];
  };
  shippingCapacity: {
    setVehicle(slotIndex: number, vehicleId: number | null): void;
    setTrainLength(slotIndex: number, length: number): void;
    vehicles: VehicleSlot[];
  };
  commonResearch: {
    setResearchLevel(researchId: string, level: number): void;
    researchLevels: ResearchLevels;
  };
  costModifiers: {
    habCostMultiplier: number;
    vehicleCostMultiplier: number;
    researchCostMultiplier: number;
  };
}

/**
 * Helper to generate action ID.
 */
export function generateActionId(): string {
  return `action_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Helper to create empty undo validation.
 */
export function createEmptyUndoValidation(): UndoValidation {
  return {
    valid: false,
    dependentActions: [],
    needsRecursiveUndo: false,
  };
}

/**
 * Helper to create empty calculations snapshot.
 */
export function createEmptySnapshot(): CalculationsSnapshot {
  return {
    eggValue: 0,
    habCapacity: 0,
    elr: 0,
    shippingCapacity: 0,
    layRate: 0,
    onlineEarnings: 0,
    offlineEarnings: 0,
    onlineIHR: 0,
    offlineIHR: 0,
    ratePerChickenPerSecond: 0,
    bankValue: 0,
    currentEgg: 'curiosity',
    shiftCount: 0,
    te: 0,
    soulEggs: 0,
    siloCount: 1,
    siloTimeMinutes: 60,
    tankLevel: 0,
    fuelTankAmounts: {
      curiosity: 0,
      integrity: 0,
      humility: 0,
      resilience: 0,
      kindness: 0,
    },
    eggsDelivered: {
      curiosity: 0,
      integrity: 0,
      humility: 0,
      resilience: 0,
      kindness: 0,
    },
    teEarned: {
      curiosity: 0,
      integrity: 0,
      humility: 0,
      resilience: 0,
      kindness: 0,
    },
    population: 1,
    lastStepTime: 0,
    vehicles: [{ vehicleId: 0, trainLength: 1 }],
    habIds: [0, null, null, null],
    researchLevels: {},
    artifactLoadout: [
      { artifactId: null, stones: [] },
      { artifactId: null, stones: [] },
      { artifactId: null, stones: [] },
      { artifactId: null, stones: [] },
    ],
    activeArtifactSet: null,
    artifactSets: {
      earnings: null,
      elr: null,
    },
    activeSales: {
      research: false,
      hab: false,
      vehicle: false,
    },
    earningsBoost: {
      active: false,
      multiplier: 1,
    },
  };
}
