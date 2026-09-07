import type { Action } from '@/types/actions/meta';
import { createSimAction } from '@/types/actions/meta';
import type { EngineState, SimulationContext, ShiftResult } from '../../types';
import { computeSnapshot } from '../../../engine/compute';
import { applyAction } from '../../../engine/apply';
import { advanceTimeFlat } from './advanceTime';
import {
  calculateMaxVehicleSlots,
  calculateMaxTrainLength,
  calculateShippingMultipliers,
} from '../../../calculations/shippingCapacity';
import { calculateArtifactModifiers } from '../../../lib/artifacts';
import {
  planMaxVehicles,
  planVehiclesForTimeLimit,
  HYPERLOOP_ID,
  type VehicleMultipliers,
} from '../../../calculations/vehiclePurchasePlan';
import type { VehicleCostModifiers } from '../../../lib/vehicles';

/**
 * Cost modifiers, shipping multipliers, and slot/train-length caps are identical setup for
 * both vehicle planners below; shared here so `runMaxVehiclesPlan` and
 * `runVehiclesForTimeLimit` can't drift out of sync on how they derive them.
 */
function buildVehiclePlanningInputs(currentState: EngineState, context: SimulationContext) {
  const costModifiers: VehicleCostModifiers = {
    bustUnionsLevel: context.epicResearchLevels['cheaper_vehicles'] || 0,
    vehicleCostMultiplier: context.colleggtibleModifiers.vehicleCost || 1,
  };

  const artifactMods = calculateArtifactModifiers(currentState.artifactLoadout);
  const transportationLobbyistLevel = context.epicResearchLevels['transportation_lobbyist'] || 0;
  const { universalMultiplier, hoverMultiplier, hyperloopMultiplier, epicMultiplier } = calculateShippingMultipliers(
    currentState.researchLevels,
    transportationLobbyistLevel
  );
  const multipliers: VehicleMultipliers = {
    universalMultiplier,
    hoverMultiplier,
    hyperloopMultiplier,
    epicMultiplier,
    shippingCapMultiplier: context.colleggtibleModifiers.shippingCap || 1,
    artifactMultiplier: artifactMods.shippingRate.totalMultiplier,
  };

  const maxSlots = calculateMaxVehicleSlots(currentState.researchLevels);
  const maxTrainLength = calculateMaxTrainLength(currentState.researchLevels);
  const startSnapshot = computeSnapshot(currentState, context, { skipGrowth: true });

  return { costModifiers, multipliers, maxSlots, maxTrainLength, startSnapshot };
}

/**
 * Common shape both `planMaxVehicles`'s and `planVehiclesForTimeLimit`'s otherwise
 * differently-typed steps get normalized into before `executeVehicleSteps` runs them —
 * `vehicleId` present means "buy this vehicle tier" (`buy_vehicle`), absent means "add a
 * Hyperloop car to the slot's existing train" (`buy_train_car`).
 */
interface NormalizedVehicleStep {
  slotIndex: number;
  cost: number;
  waitSeconds: number;
  vehicleId?: number;
}

/**
 * The one place that actually executes a vehicle-purchase plan against a mutable
 * `EngineState`: advances real time via the flat-rate `advanceTimeFlat` for each step's
 * wait, then applies the purchase and snapshots the result. Both `runMaxVehiclesPlan` and
 * `runVehiclesForTimeLimit` are thin wrappers that pick a planner and normalize its steps
 * into `NormalizedVehicleStep`s for this to run — this is the only place with the actual
 * wait/buy/snapshot logic, so the two can't diverge.
 *
 * Unlike `milestones.ts`'s boundary-aware version, this doesn't step onto sale/boost
 * boundaries mid-wait.
 */
function executeVehicleSteps(
  startState: EngineState,
  context: SimulationContext,
  timeLimit: number,
  steps: NormalizedVehicleStep[]
): ShiftResult {
  let currentState: EngineState = { ...startState };
  let elapsedSeconds = 0;
  const actions: Action[] = [];
  const trainLengths: Record<number, number> = {};

  for (const step of steps) {
    if (elapsedSeconds + step.waitSeconds > timeLimit) break;

    const advanced = advanceTimeFlat(currentState, actions, elapsedSeconds, context, step.waitSeconds);
    currentState = advanced.currentState;
    elapsedSeconds = advanced.elapsedSeconds;

    let action: Action;
    if (step.vehicleId !== undefined) {
      action = createSimAction('buy_vehicle', { slotIndex: step.slotIndex, vehicleId: step.vehicleId }, step.cost);
      trainLengths[step.slotIndex] = 1;
    } else {
      const fromLength = trainLengths[step.slotIndex] ?? currentState.vehicles[step.slotIndex]?.trainLength ?? 1;
      action = createSimAction('buy_train_car', { slotIndex: step.slotIndex, fromLength, toLength: fromLength + 1 }, step.cost);
      trainLengths[step.slotIndex] = fromLength + 1;
    }

    currentState = applyAction(currentState, action);

    const finalSnap = computeSnapshot(currentState, context, { skipGrowth: true });
    action.endState = finalSnap;
    action.totalTimeSeconds = 0;
    action.bankDelta = -step.cost;

    actions.push(action);
  }

  return {
    actions,
    elapsedSeconds,
    endState: currentState,
  };
}

/**
 * `planMaxVehicles` plans against a snapshot up front; this executes that plan step-by-step
 * against a mutable `EngineState`.
 *
 * Only sensible for an unbounded (or generously large) `timeLimit` — see `planMaxVehicles`'s
 * doc comment. K2/K3 call this with `Infinity`. For a genuinely tight budget (K1), use
 * `runVehiclesForTimeLimit` instead, which picks purchases by ROI rather than always committing
 * straight to Hyperloop.
 */
export function runMaxVehiclesPlan(startState: EngineState, context: SimulationContext, timeLimit: number): ShiftResult {
  const currentState: EngineState = { ...startState };
  const { costModifiers, multipliers, maxSlots, maxTrainLength, startSnapshot } = buildVehiclePlanningInputs(
    currentState,
    context
  );

  const plan = planMaxVehicles(
    currentState.vehicles,
    maxSlots,
    maxTrainLength,
    costModifiers,
    currentState.activeSales.vehicle,
    multipliers,
    startSnapshot
  );

  const steps: NormalizedVehicleStep[] = plan.steps.map(step => ({
    slotIndex: step.slotIndex,
    cost: step.cost,
    waitSeconds: step.waitSeconds,
    vehicleId: step.type === 'upgrade_hyperloop' ? HYPERLOOP_ID : undefined,
  }));

  return executeVehicleSteps(currentState, context, timeLimit, steps);
}

/**
 * Counterpart to `runMaxVehiclesPlan` for a genuinely bounded `timeLimit` (K1's default
 * 1800s, early in an ascension when earnings are low). Backed by `planVehiclesForTimeLimit`,
 * which ranks candidate purchases by deltaCapacity/cost ROI across every slot and every
 * vehicle tier — not just Hyperloop — so a low-earning farm ends up spreading affordable
 * cheap vehicles across many slots instead of stalling on the wait for a single Hyperloop
 * and buying nothing else (see that function's doc comment for the full rationale).
 *
 * Since the planner itself already stops adding steps once nothing fits `timeLimit`, the
 * per-step `timeLimit` check inside `executeVehicleSteps` is redundant in principle for this
 * caller — kept only as a defensive backstop against the virtual plan drifting from the real
 * executed state.
 */
export function runVehiclesForTimeLimit(startState: EngineState, context: SimulationContext, timeLimit: number): ShiftResult {
  const currentState: EngineState = { ...startState };
  const { costModifiers, multipliers, maxSlots, maxTrainLength, startSnapshot } = buildVehiclePlanningInputs(
    currentState,
    context
  );

  const plan = planVehiclesForTimeLimit(
    currentState.vehicles,
    maxSlots,
    maxTrainLength,
    costModifiers,
    currentState.activeSales.vehicle,
    multipliers,
    timeLimit,
    startSnapshot
  );

  const steps: NormalizedVehicleStep[] = plan.steps.map(step => ({
    slotIndex: step.slotIndex,
    cost: step.cost,
    waitSeconds: step.waitSeconds,
    vehicleId: step.type === 'vehicle' ? step.vehicleId : undefined,
  }));

  return executeVehicleSteps(currentState, context, timeLimit, steps);
}
