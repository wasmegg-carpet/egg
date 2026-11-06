/**
 * Buy Train Car Action Executor
 *
 * Adds a car to a hyperloop train in a specific slot.
 */

import type { PayloadExecutor, BaseExecutorContext } from '../executorTypes';
import type { PlannerProfile } from '../../profile';
import type { BuyTrainCarPayload } from '../../types/actions/infrastructure';
import { formatNumber } from '../../format';

export function createBuyTrainCarExecutor(profile: PlannerProfile): PayloadExecutor<BuyTrainCarPayload> {
  return {
    execute(payload: BuyTrainCarPayload, context: BaseExecutorContext): number {
      const { slotIndex, toLength } = payload;

      // Calculate cost - toLength is 1-indexed, but carIndex for cost is 0-indexed
      // So buying car #2 (toLength=2) uses carIndex=1
      const carIndex = toLength - 1;
      const modifiers = context.getVehicleCostModifiers();
      const cost = profile.pricing.trainCar(carIndex, modifiers);

      // Apply changes to store
      context.setTrainLength(slotIndex, toLength);

      return cost;
    },

    getDisplayName(payload: BuyTrainCarPayload): string {
      return `Train Car #${payload.toLength} → slot ${payload.slotIndex + 1}`;
    },

    getEffectDescription(payload: BuyTrainCarPayload): string {
      // Each car adds 50M/min capacity
      const capacityPerCar = 50e6 / 60; // per second
      return `+${formatNumber(capacityPerCar * 3600, 2)}/hr shipping`;
    },
  };
}
