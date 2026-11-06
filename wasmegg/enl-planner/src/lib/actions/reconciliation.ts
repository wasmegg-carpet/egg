import { Action, ActionType, CurrentFarmState, FUEL_EGGS } from '@/types';
import { InitialStateStoreState } from '@/stores/initialState';
import { GameEvent } from 'lib/planners/stores/events';

export type ReconstructionResult = 'completed' | 'pending' | 'na';

export interface ReconciliationContext {
  farm: CurrentFarmState | null;
  initialState: InitialStateStoreState;
  events: GameEvent[];
  /** The real-world timestamp when the plan was started (seconds) */
  planStartTime: number;
}

export interface ActionReconciliationStrategy<T extends ActionType = ActionType> {
  evaluate(action: Action<T>, context: ReconciliationContext): ReconstructionResult;
}

const strategyRegistry: Partial<Record<ActionType, ActionReconciliationStrategy<any>>> = {};

/**
 * Registers a new reconciliation strategy for a specific action type.
 */
export function registerStrategy<T extends ActionType>(
  type: T,
  strategy: ActionReconciliationStrategy<T>
) {
  strategyRegistry[type] = strategy;
}

/**
 * Retrieves a strategy for a specific action type.
 */
export function getStrategy<T extends ActionType>(
  type: T
): ActionReconciliationStrategy<T> | undefined {
  return strategyRegistry[type];
}

/**
 * Evaluates an action's completion status using the registered strategies.
 * Implementation includes the "Egg Progression Shortcut" logic.
 */
export function evaluateAction(
  action: Action,
  context: ReconciliationContext
): ReconstructionResult {
  const strategy = getStrategy(action.type);
  if (!strategy) {
    return 'na';
  }

  return strategy.evaluate(action, context);
}

// --- HELPER: Simple Comparison Strategy Factory ---

const createComparisonStrategy = <T extends ActionType>(
  evaluateFn: (payload: Action<T>['payload'], farm: CurrentFarmState) => boolean
): ActionReconciliationStrategy<T> => ({
  evaluate(action, context) {
    if (!context.farm) return 'pending';
    return evaluateFn(action.payload, context.farm) ? 'completed' : 'pending';
  }
});

/**
 * Helper: Checks if the action's simulated completion time has passed
 * based on the real-world start time and the current local wall-clock time.
 */
function isTemporallyCompleted(action: Action, context: ReconciliationContext): boolean {
  if (!context.planStartTime) return false;
  
  // current real-world timestamp in seconds
  const now = Math.floor(Date.now() / 1000);
  
  // simulatedTime is seconds since plan start
  const simulatedTime = action.endState.lastStepTime;
  const realElapsedTime = now - context.planStartTime;
  
  return realElapsedTime >= simulatedTime;
}

// --- STRATEGY DEFINITIONS ---

registerStrategy('start_ascension', {
  evaluate: (action, context) => (context.farm ? 'completed' : 'pending')
});

registerStrategy('buy_research', createComparisonStrategy((payload, farm) => {
  const currentLevel = farm.commonResearches[payload.researchId] || 0;
  return currentLevel >= payload.toLevel;
}));

registerStrategy('buy_hab', createComparisonStrategy((payload, farm) => {
  const currentHabId = farm.habs[payload.slotIndex] || 0;
  return currentHabId >= payload.habId;
}));

registerStrategy('buy_vehicle', createComparisonStrategy((payload, farm) => {
  const currentVehicleId = farm.vehicles[payload.slotIndex]?.vehicleId || 0;
  return currentVehicleId >= payload.vehicleId;
}));

registerStrategy('buy_train_car', createComparisonStrategy((payload, farm) => {
  const vehicle = farm.vehicles[payload.slotIndex];
  return !!(vehicle?.vehicleId === 11 && vehicle.trainLength >= payload.toLength);
}));

registerStrategy('buy_silo', createComparisonStrategy((payload, farm) => {
  return farm.numSilos >= payload.toCount;
}));

registerStrategy('wait_for_population', {
  evaluate(action, context) {
    if (!context.farm) return 'pending';
    return context.farm.population >= action.payload.targetPopulation ? 'completed' : 'pending';
  }
});
