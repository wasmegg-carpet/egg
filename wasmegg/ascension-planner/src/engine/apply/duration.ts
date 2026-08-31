import {
  Action,
  CalculationsSnapshot,
  LaunchMissionsPayload,
  WaitForTEPayload,
  StoreFuelPayload,
  WaitForGemsPayload,
} from '@/types';
import { getNextPacificTime } from '@/lib/events';
import {
  solveForTime,
  integrateRate,
  getTimeToSave,
  calculateEggsDeliveredForTime,
  boostTransitionsFrom,
} from './math';
import { eggsNeededForTE, countTEThresholdsPassed } from '@/lib/truthEggs';
import { calculateArtifactModifiers } from '@/lib/artifacts';
import { getResearchById, getDiscountedVirtuePrice } from '@/calculations/commonResearch';
import { getHabById, getDiscountedHabPrice, countHabsOfType, type HabId } from '@/lib/habs';
import { getDiscountedVehiclePrice, countVehiclesOfType, getDiscountedTrainCarPrice } from '@/lib/vehicles';
import { nextSiloCost } from '@/stores/silos';
import type { SimulationContext } from '../types';

/**
 * Recalculate an action's payload based on the state before it executes.
 */
export function refreshActionPayload(
  action: Action,
  prevSnapshot: CalculationsSnapshot,
  context?: SimulationContext
): Action {
  if (context) {
    if (action.type === 'buy_research') {
      const payload = action.payload as import('@/types').BuyResearchPayload;
      const artifactMods = calculateArtifactModifiers(prevSnapshot.artifactLoadout);
      const modifiers = {
        labUpgradeLevel: context.epicResearchLevels['cheaper_research'] || 0,
        researchCostMultiplier: context.colleggtibleModifiers.researchCost || 1,
        puzzleCubeMultiplier: artifactMods.researchCost.totalMultiplier,
      };
      const research = getResearchById(payload.researchId);
      if (research) {
        const refreshedCost = getDiscountedVirtuePrice(
          research,
          payload.fromLevel,
          modifiers,
          prevSnapshot.activeSales.research
        );
        if (action.cost !== refreshedCost) action = { ...action, cost: refreshedCost };
      }
    } else if (action.type === 'buy_hab') {
      const payload = action.payload as import('@/types').BuyHabPayload;
      const modifiers = {
        cheaperContractorsLevel: context.epicResearchLevels['cheaper_contractors'] || 0,
        habCostMultiplier: context.colleggtibleModifiers.habCost || 1,
      };
      const hab = getHabById(payload.habId as HabId);
      if (hab) {
        const habIds = prevSnapshot.habIds.slice(0, payload.slotIndex);
        const purchaseIndex = countHabsOfType(habIds, payload.habId);
        const refreshedCost = getDiscountedHabPrice(hab, purchaseIndex, modifiers, prevSnapshot.activeSales.hab);
        if (action.cost !== refreshedCost) action = { ...action, cost: refreshedCost };
      }
    } else if (action.type === 'buy_vehicle') {
      const payload = action.payload as import('@/types').BuyVehiclePayload;
      const modifiers = {
        bustUnionsLevel: context.epicResearchLevels['bust_unions'] || 0,
        vehicleCostMultiplier: context.colleggtibleModifiers.vehicleCost || 1,
      };
      const vehicles = prevSnapshot.vehicles.slice(0, payload.slotIndex);
      const purchaseIndex = countVehiclesOfType(vehicles as { vehicleId: number | null }[], payload.vehicleId);
      const refreshedCost = getDiscountedVehiclePrice(
        payload.vehicleId,
        purchaseIndex,
        modifiers,
        prevSnapshot.activeSales.vehicle
      );
      if (action.cost !== refreshedCost) action = { ...action, cost: refreshedCost };
    } else if (action.type === 'buy_train_car') {
      const payload = action.payload as import('@/types').BuyTrainCarPayload;
      const modifiers = {
        bustUnionsLevel: context.epicResearchLevels['bust_unions'] || 0,
        vehicleCostMultiplier: context.colleggtibleModifiers.vehicleCost || 1,
      };
      const carIndex = payload.toLength - 1;
      const refreshedCost = getDiscountedTrainCarPrice(carIndex, modifiers, prevSnapshot.activeSales.vehicle);
      if (action.cost !== refreshedCost) action = { ...action, cost: refreshedCost };
    } else if (action.type === 'buy_silo') {
      const payload = action.payload as import('@/types').BuySiloPayload;
      const refreshedCost = nextSiloCost(payload.fromCount);
      if (action.cost !== refreshedCost) action = { ...action, cost: refreshedCost };
    }
  }

  if (action.type === 'wait_for_te') {
    const payload = { ...(action.payload as WaitForTEPayload) };
    const egg = payload.egg;
    const currentDelivered = prevSnapshot.eggsDelivered[egg] || 0;
    payload.eggsToLay = eggsNeededForTE(currentDelivered, payload.targetTE);
    payload.timeSeconds = solveForTime(
      payload.eggsToLay,
      prevSnapshot.population,
      prevSnapshot.offlineIHR / 60,
      prevSnapshot.ratePerChickenPerSecond,
      prevSnapshot.shippingCapacity,
      prevSnapshot.habCapacity
    );
    payload.startEggsDelivered = currentDelivered;
    const thresholdsPassed = countTEThresholdsPassed(currentDelivered);
    const claimedTE = prevSnapshot.teEarned?.[egg] || 0;
    payload.startTE = Math.max(claimedTE, thresholdsPassed);
    payload.teGained = Math.max(0, payload.targetTE - payload.startTE);
    return { ...action, payload };
  }

  if (action.type === 'store_fuel') {
    const payload = { ...(action.payload as StoreFuelPayload) };
    const fuelSpeed = payload.fuelSpeed ?? 1.0;
    const effectiveR = prevSnapshot.ratePerChickenPerSecond * fuelSpeed;

    payload.timeSeconds = solveForTime(
      payload.amount,
      prevSnapshot.population,
      prevSnapshot.offlineIHR / 60,
      effectiveR,
      Infinity, // Tanking is limited by production, not shipping
      prevSnapshot.habCapacity
    );

    // Variable-speed: compute eggs shipped and gems earned during fueling
    if (fuelSpeed < 1.0 && payload.timeSeconds > 0) {
      const remainingR = prevSnapshot.ratePerChickenPerSecond * (1 - fuelSpeed);
      payload.eggsShippedDuringFuel = integrateRate(
        payload.timeSeconds,
        prevSnapshot.population,
        prevSnapshot.offlineIHR / 60,
        remainingR,
        prevSnapshot.shippingCapacity, // shipping caps the shipped portion
        prevSnapshot.habCapacity
      );
      const valuePerEgg = prevSnapshot.elr > 0 ? prevSnapshot.offlineEarnings / prevSnapshot.elr : 0;
      payload.gemsEarnedDuringFuel = payload.eggsShippedDuringFuel * valuePerEgg;
    } else {
      payload.eggsShippedDuringFuel = 0;
      payload.gemsEarnedDuringFuel = 0;
    }

    return { ...action, payload };
  }

  if (action.type === 'wait_for_missions') {
    const payload = { ...(action.payload as import('@/types').WaitForMissionsPayload) };
    const maxReturn = Math.max(...payload.missions.map(m => m.returnTimestamp || 0));
    payload.totalTimeSeconds = Math.max(0, maxReturn - prevSnapshot.lastStepTime);
    return { ...action, payload };
  }

  if (action.type === 'wait_for_full_habs') {
    const payload = { ...(action.payload as import('@/types').WaitForFullHabsPayload) };
    payload.habCapacity = prevSnapshot.habCapacity;
    payload.currentPopulation = prevSnapshot.population;
    payload.ihr = prevSnapshot.offlineIHR;
    const chickensNeeded = Math.max(0, payload.habCapacity - payload.currentPopulation);
    payload.totalTimeSeconds = payload.ihr > 0 ? chickensNeeded / (payload.ihr / 60) : 0;
    return { ...action, payload };
  }

  if (action.type === 'wait_for_research_sale' || action.type === 'wait_for_earnings_boost') {
    if (context) {
      const payload = {
        ...(action.payload as
          | import('@/types').WaitForResearchSalePayload
          | import('@/types').WaitForEarningsBoostPayload),
      };
      const targetDay = action.type === 'wait_for_research_sale' ? 5 : 1; // Friday or Monday
      const targetHour = 9; // 9 AM
      // (Plan Start Time) + (Total Simulation Relative Seconds - Start Offset)
      const absoluteSimTime = context.ascensionStartTime + (prevSnapshot.lastStepTime - context.planStartOffset);
      const nextTime = getNextPacificTime(targetDay, targetHour, absoluteSimTime);
      payload.totalTimeSeconds = Math.max(0, nextTime - absoluteSimTime);
      return { ...action, payload };
    }
  }

  if (action.type === 'wait_for_gems') {
    const payload = { ...(action.payload as WaitForGemsPayload) };
    payload.currentGems = prevSnapshot.bankValue;
    payload.requiredGems = Math.max(0, payload.targetGems - payload.currentGems);
    payload.timeSeconds = getTimeToSave(payload.targetGems, prevSnapshot);
    return { ...action, payload };
  }

  return action;
}

/**
 * Seconds-since-epoch that `prevSnapshot` represents, for calendar-boundary lookups (earnings
 * boost start/end). Same derivation `refreshActionPayload`'s `wait_for_research_sale`/
 * `wait_for_earnings_boost` branch already uses above.
 */
function absoluteSimTimeFor(prevSnapshot: CalculationsSnapshot, context: SimulationContext): number {
  return context.ascensionStartTime + (prevSnapshot.lastStepTime - context.planStartOffset);
}

/**
 * Calculate the duration of an action in seconds.
 *
 * `context`, when provided, makes gem-costing actions boundary-aware: the wait is split at the
 * earnings boost's real next start/end (via `boostTransitionsFrom`) instead of assuming
 * `prevSnapshot.earningsBoost.active` holds flat for the whole wait — without it, a wait that
 * starts just before the boost turns on (or off) is mis-priced in time, since `prevSnapshot`'s own
 * flag may already be stale by the time this runs (see `boostTransitionsFrom`'s doc comment).
 */
export function getActionDuration(
  action: Action,
  prevSnapshot: CalculationsSnapshot,
  context?: SimulationContext
): number {
  if (action.type === 'store_fuel' || action.type === 'wait_for_te' || action.type === 'wait_for_gems') {
    return (action.payload as { timeSeconds?: number }).timeSeconds || 0;
  }

  if (
    action.type === 'wait_for_missions' ||
    action.type === 'wait_for_time' ||
    action.type === 'wait_for_full_habs' ||
    action.type === 'wait_for_research_sale' ||
    action.type === 'wait_for_earnings_boost' ||
    action.type === 'wait_for_no_earnings'
  ) {
    return (action.payload as { totalTimeSeconds?: number }).totalTimeSeconds || 0;
  }

  const transitions = context
    ? boostTransitionsFrom(prevSnapshot, absoluteSimTimeFor(prevSnapshot, context))
    : undefined;

  if (action.type === 'launch_missions') {
    const T = action.cost > 0 ? getTimeToSave(action.cost, prevSnapshot, transitions) : 0;
    return T + ((action.payload as LaunchMissionsPayload).totalTimeSeconds || 0);
  }

  const GEM_COSTING_TYPES = ['buy_research', 'buy_hab', 'buy_vehicle', 'buy_train_car', 'buy_silo'];
  if (GEM_COSTING_TYPES.includes(action.type) && action.cost > 0) {
    return getTimeToSave(action.cost, prevSnapshot, transitions);
  }

  return 0;
}

/**
 * Calculate the number of eggs passively delivered during an action's duration.
 */
export function computePassiveEggsDelivered(
  action: Action,
  prevSnapshot: CalculationsSnapshot,
  context?: SimulationContext
): number {
  const NO_PASSIVE_TYPES = [
    'store_fuel',
    'wait_for_te',
    'start_ascension',
    'shift',
    'change_artifacts',
    'toggle_sale',
    'equip_artifact_set',
    'update_artifact_set',
    'remove_fuel',
    'toggle_earnings_boost',
    'notification',
    'wait_for_no_earnings',
    'modify_bank',
  ];
  if (NO_PASSIVE_TYPES.includes(action.type)) return 0;

  const durationSeconds = getActionDuration(action, prevSnapshot, context);
  if (durationSeconds > 0) {
    return calculateEggsDeliveredForTime(durationSeconds, prevSnapshot);
  }
  return 0;
}
