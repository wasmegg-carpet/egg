/**
 * Action Executor Registry
 *
 * EXTENSION GUIDE FOR CLAUDE:
 * To add a new action type:
 * 1. Create executor file in src/lib/actions/executors/<type>.ts
 * 2. Import and register in executorMap below
 * 3. Add dependency rules in computeDependencies() if needed
 */

import type {
  ActionType,
  ActionPayloadMap,
  Action,
  BuyVehiclePayload,
  BuyResearchPayload,
  BuyTrainCarPayload,
  BuySiloPayload,
  VirtueEgg,
  StartAscensionPayload,
} from '@/types';
import type { BaseExecutorContext, PayloadExecutor } from 'lib/planners/actions/executorTypes';
import { PROFILE } from '@/lib/profile';
import { getResearchById, TIER_UNLOCK_THRESHOLDS } from '@/calculations/commonResearch';
import { startAscensionExecutor } from './executors/startAscension';
import { createBuyVehicleExecutor } from 'lib/planners/actions/executors/buyVehicle';
import { createBuyHabExecutor } from 'lib/planners/actions/executors/buyHab';
import { createBuyResearchExecutor } from 'lib/planners/actions/executors/buyResearch';
import { shiftExecutor } from './executors/shift';
import { createBuyTrainCarExecutor } from 'lib/planners/actions/executors/buyTrainCar';
import { changeArtifactsExecutor } from 'lib/planners/actions/executors/changeArtifacts';
import { buySiloExecutor } from 'lib/planners/actions/executors/buySilo';
import { storeFuelExecutor } from './executors/storeFuel';
import { waitForTEExecutor } from './executors/waitForTE';
import { launchMissionsExecutor } from './executors/launchMissions';
import { toggleSaleExecutor } from 'lib/planners/actions/executors/toggleSale';
import { equipArtifactSetExecutor } from './executors/equipArtifactSet';
import { updateArtifactSetExecutor } from './executors/updateArtifactSet';
import { createWaitForMissionsExecutor } from 'lib/planners/actions/executors/wait_for_missions';
import { waitForTimeExecutor } from 'lib/planners/actions/executors/wait_for_time';
import { waitForResearchSaleEndExecutor } from 'lib/planners/actions/executors/waitForResearchSaleEnd';
import { waitForEarningsBoostEndExecutor } from 'lib/planners/actions/executors/waitForEarningsBoostEnd';
import { removeFuelExecutor } from './executors/removeFuel';
import { waitForFullHabsExecutor } from 'lib/planners/actions/executors/wait_for_full_habs';
import { toggleEarningsBoostExecutor } from 'lib/planners/actions/executors/toggleEarningsBoost';
import { waitForResearchSaleExecutor } from 'lib/planners/actions/executors/waitForResearchSale';
import { waitForEarningsBoostExecutor } from 'lib/planners/actions/executors/waitForEarningsBoost';
import { waitForGemsExecutor } from './executors/waitForGems';
import { createWaitForNoEarningsExecutor } from 'lib/planners/actions/executors/wait_for_no_earnings';
import { notificationExecutor } from 'lib/planners/actions/executors/notification';
import { createModifyBankExecutor } from 'lib/planners/actions/executors/modifyBank';

// ============================================================================
// Executor Interface
// ============================================================================

/**
 * Interface for action executors, keyed by this planner's action types.
 * See lib/planners/actions/executorTypes.ts for the shared shape.
 */
export type ActionExecutor<T extends ActionType> = PayloadExecutor<ActionPayloadMap[T], ExecutorContext>;

/**
 * Context passed to executors with store access: the shared context plus this planner's fuel eggs.
 */
export interface ExecutorContext extends BaseExecutorContext {
  addFuel(egg: VirtueEgg, amount: number): boolean;
  removeFuel(egg: VirtueEgg, amount: number): void;
  addEggsDelivered(egg: VirtueEgg, amount: number): void;
  getFuelAmounts(): Record<VirtueEgg, number>;
  getEggsDelivered(): Record<VirtueEgg, number>;
  getTEEarned(): Record<VirtueEgg, number>;
}

// ============================================================================
// Executor Registry
// ============================================================================

/**
 * Map of action types to their executors.
 * Add new executors here when extending the system.
 */
const executorMap: { [K in ActionType]: ActionExecutor<K> } = {
  start_ascension: startAscensionExecutor,
  buy_vehicle: createBuyVehicleExecutor(PROFILE),
  buy_hab: createBuyHabExecutor(PROFILE),
  buy_research: createBuyResearchExecutor(PROFILE),
  shift: shiftExecutor,
  buy_train_car: createBuyTrainCarExecutor(PROFILE),
  change_artifacts: changeArtifactsExecutor,
  buy_silo: buySiloExecutor,
  store_fuel: storeFuelExecutor,
  remove_fuel: removeFuelExecutor,
  wait_for_te: waitForTEExecutor,
  launch_missions: launchMissionsExecutor,
  toggle_sale: toggleSaleExecutor,
  equip_artifact_set: equipArtifactSetExecutor,
  update_artifact_set: updateArtifactSetExecutor,
  wait_for_missions: createWaitForMissionsExecutor(PROFILE),
  wait_for_time: waitForTimeExecutor,
  wait_for_full_habs: waitForFullHabsExecutor,
  wait_for_research_sale: waitForResearchSaleExecutor,
  wait_for_research_sale_end: waitForResearchSaleEndExecutor,
  wait_for_earnings_boost: waitForEarningsBoostExecutor,
  wait_for_earnings_boost_end: waitForEarningsBoostEndExecutor,
  wait_for_gems: waitForGemsExecutor,
  wait_for_no_earnings: createWaitForNoEarningsExecutor(PROFILE),
  toggle_earnings_boost: toggleEarningsBoostExecutor,
  notification: notificationExecutor,
  modify_bank: createModifyBankExecutor(PROFILE),
};

/**
 * Get the executor for an action type.
 */
export function getExecutor<T extends ActionType>(type: T): ActionExecutor<T> {
  return executorMap[type];
}

// ============================================================================
// Dependency Computation
// ============================================================================

/**
 * Compute dependencies for a new action based on existing actions.
 * Returns array of action IDs that this action depends on.
 *
 * Dependency rules:
 * - Research level N depends on the action that bought level N-1
 * - Hyperloop train cars 6-10 depend on graviton coupling research
 * - Train cars depend on the hyperloop vehicle purchase in that slot
 * - Add more rules here as needed
 */
export function computeDependencies(
  type: ActionType,
  payload: ActionPayloadMap[ActionType],
  existingActions: Action[] = [],
  initialResearchLevels: Record<string, number> = {}
): string[] {
  const deps: string[] = [];

  if (!existingActions || !Array.isArray(existingActions)) {
    return [];
  }

  // 1. Every action depends on the most recent shift/start_ascension (the "group header")
  // This ensures that undoing a shift also undoes all actions performed during that shift.
  const lastHeader = [...existingActions].reverse().find(a => a.type === 'shift' || a.type === 'start_ascension');
  if (lastHeader) {
    deps.push(lastHeader.id);
  }

  // Research level dependencies
  // Level N depends on the action that bought level N-1
  if (type === 'buy_research') {
    const researchPayload = payload as BuyResearchPayload;

    // If buying level > 1, find the action that bought the previous level
    if (researchPayload.fromLevel > 0) {
      const previousLevelAction = findResearchLevelAction(
        existingActions,
        researchPayload.researchId,
        researchPayload.fromLevel // The level we're upgrading FROM is the toLevel of the previous action
      );
      if (previousLevelAction) {
        deps.push(previousLevelAction.id);
      }
    }
  }

  // Train car dependencies (for hyperloop via buy_vehicle)
  if (type === 'buy_vehicle') {
    const vehiclePayload = payload as BuyVehiclePayload;

    // If buying hyperloop with train length > 5, depends on graviton coupling
    if (vehiclePayload.vehicleId === 11 && vehiclePayload.trainLength && vehiclePayload.trainLength > 5) {
      const requiredGCLevel = vehiclePayload.trainLength - 5;
      const gcAction = findGravitonCouplingAction(existingActions, requiredGCLevel);
      if (gcAction) deps.push(gcAction.id);
    }
  }

  // Train car dependencies (via buy_train_car action)
  if (type === 'buy_train_car') {
    const carPayload = payload as BuyTrainCarPayload;

    // Depends on the hyperloop vehicle purchase in that slot
    const hyperloopAction = findHyperloopPurchase(existingActions, carPayload.slotIndex);
    if (hyperloopAction) deps.push(hyperloopAction.id);

    // Depends on the previous train car purchase in that slot (if not car #2)
    if (carPayload.fromLength >= 2) {
      const prevCarAction = findTrainCarAction(existingActions, carPayload.slotIndex, carPayload.fromLength);
      if (prevCarAction) deps.push(prevCarAction.id);
    }

    // If buying car 6-10, depends on graviton coupling research
    if (carPayload.toLength > 5) {
      const requiredGCLevel = carPayload.toLength - 5;
      const gcAction = findGravitonCouplingAction(existingActions, requiredGCLevel);
      if (gcAction) deps.push(gcAction.id);
    }
  }

  // Silo dependencies
  // Silo N depends on the action that bought silo N-1
  if (type === 'buy_silo') {
    const siloPayload = payload as BuySiloPayload;

    // If buying silo > 2, find the action that bought the previous silo
    if (siloPayload.fromCount > 1) {
      const previousSiloAction = findSiloPurchaseAction(existingActions, siloPayload.fromCount);
      if (previousSiloAction) {
        deps.push(previousSiloAction.id);
      }
    }
  }

  // Artifact Set Dependencies
  if (type === 'update_artifact_set' || type === 'equip_artifact_set') {
    // These actions are self-contained but follow the group header
    // No additional specific dependencies needed for now
  }

  // Tier unlock dependencies
  if (type === 'buy_research') {
    const researchPayload = payload as BuyResearchPayload;
    const research = getResearchById(researchPayload.researchId);
    if (research && research.tier > 1) {
      const threshold = TIER_UNLOCK_THRESHOLDS[research.tier - 1];
      const thresholdAction = findNthResearchPurchase(existingActions, threshold, initialResearchLevels);
      if (thresholdAction) {
        deps.push(thresholdAction.id);
      }
    }
  }

  return deps;
}

/**
 * Find the N-th research purchase in the entire history (across all tiers).
 * This is the action that definitively unlocked a higher tier.
 */
function findNthResearchPurchase(
  actions: Action[],
  n: number,
  initialResearchLevels: Record<string, number> = {}
): Action | undefined {
  let count = 0;
  // Initialize count with levels already purchased in tiers 1 through n-1
  // Wait, wait. The threshold is TOTAL purchases in tiers 1 to X-1.
  // Actually, Egg Inc thresholds are cumulative.
  // If threshold is 1655, it means total research purchases MUST be >= 1655.
  // Wait, let's verify if TIER_UNLOCK_THRESHOLDS is "purchases in previous tiers" or "total purchases".
  // commonResearch.ts: Index 12 = tier 13 (requires 1655 purchases from tiers 1-12)

  // So for threshold N, we only care about purchases in tiers that contributes to that threshold.
  // But which tiers contribute to threshold for tier X? Tiers 1 to X-1.

  // This findNthResearchPurchase is currently used for ANY threshold.
  // It's a bit of an approximation in the original code (it just counted all research).

  // Let's make it a bit better.
  // Threshold n is for tier X if n = TIER_UNLOCK_THRESHOLDS[X-1].
  // So we want to find the action that makes (T1..X-1 total) >= n.

  // Let's find which tier this threshold belongs to.
  let targetTier = (TIER_UNLOCK_THRESHOLDS as readonly number[]).indexOf(n);
  if (targetTier === -1) targetTier = 13; // Fallback

  // Start count with initial purchases in tiers < targetTier + 1 (i.e. Tiers 1 to targetTier)
  // Wait, if targetTier 12 is for Tier 13. Threshold n is at index 12.
  // So we need purchases in Tiers 1-12 to be >= n.

  for (const [id, level] of Object.entries(initialResearchLevels)) {
    const research = getResearchById(id);
    if (research && research.tier <= targetTier) {
      count += level;
    }
  }

  if (count >= n) return undefined; // Already unlocked by backup or initial snapshot

  for (const action of actions) {
    if (action.type === 'buy_research') {
      const payload = action.payload as BuyResearchPayload;
      const research = getResearchById(payload.researchId);
      if (research && research.tier <= targetTier) {
        const levelsBought = payload.toLevel - payload.fromLevel;
        count += levelsBought;
        if (count >= n) {
          return action;
        }
      }
    } else if (action.type === 'start_ascension') {
      const payload = action.payload as StartAscensionPayload;
      if (payload.initialFarmState?.commonResearches) {
        for (const [id, level] of Object.entries(payload.initialFarmState.commonResearches)) {
          const research = getResearchById(id);
          if (research && research.tier <= targetTier) {
            count += level as number;
            if (count >= n) {
              return action;
            }
          }
        }
      }
    }
  }
  return undefined;
}

/**
 * Find the research action that purchased a specific level of a research.
 */
function findResearchLevelAction(actions: Action[], researchId: string, toLevel: number): Action | undefined {
  return actions.find(
    a =>
      a.type === 'buy_research' &&
      (a.payload as BuyResearchPayload).researchId === researchId &&
      (a.payload as BuyResearchPayload).toLevel === toLevel
  );
}

/**
 * Find the graviton coupling research action that unlocked a specific train length.
 */
function findGravitonCouplingAction(actions: Action[], minLevel: number): Action | undefined {
  // Find the earliest action that gave us at least this level
  return actions.find(
    a =>
      a.type === 'buy_research' &&
      (a.payload as BuyResearchPayload).researchId === 'micro_coupling' &&
      (a.payload as BuyResearchPayload).toLevel >= minLevel
  );
}

/**
 * Find the action that bought the hyperloop train in a specific slot.
 */
function findHyperloopPurchase(actions: Action[], slotIndex: number): Action | undefined {
  return actions.find(
    a =>
      a.type === 'buy_vehicle' &&
      (a.payload as BuyVehiclePayload).slotIndex === slotIndex &&
      (a.payload as BuyVehiclePayload).vehicleId === 11
  );
}

/**
 * Find the action that bought a specific train car in a slot.
 */
function findTrainCarAction(actions: Action[], slotIndex: number, toLength: number): Action | undefined {
  return actions.find(
    a =>
      a.type === 'buy_train_car' &&
      (a.payload as BuyTrainCarPayload).slotIndex === slotIndex &&
      (a.payload as BuyTrainCarPayload).toLength === toLength
  );
}

/**
 * Find the action that bought a specific silo number.
 * @param toCount The silo count after the purchase (e.g., 3 for silo #3)
 */
function findSiloPurchaseAction(actions: Action[], toCount: number): Action | undefined {
  return actions.find(a => a.type === 'buy_silo' && (a.payload as BuySiloPayload).toCount === toCount);
}

/**
 * Check if an action would create invalid state if removed.
 * Used for dependency validation during undo.
 */
export function wouldCreateInvalidState(
  actionToRemove: Action,
  remainingActions: Action[]
): { invalid: boolean; reason?: string } {
  // Check if any remaining action depends on the removed action
  for (const action of remainingActions) {
    if (action.dependsOn.includes(actionToRemove.id)) {
      return {
        invalid: true,
        reason: `Action "${getExecutor(action.type).getDisplayName(action.payload)}" depends on this action`,
      };
    }
  }

  return { invalid: false };
}
