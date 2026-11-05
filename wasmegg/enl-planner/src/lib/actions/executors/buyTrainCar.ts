/**
 * Buy Train Car Action Executor
 *
 * Adds a car to a hyperloop train in a specific slot.
 */

import type { ActionExecutor, ExecutorContext } from '../executor';
import type { BuyTrainCarPayload } from '@/types';
import { getDiscountedTrainCarPrice } from '@/lib/vehicles';
import { formatNumber } from '@/lib/format';

export const buyTrainCarExecutor: ActionExecutor<'buy_train_car'> = {
  execute(payload: BuyTrainCarPayload, context: ExecutorContext): number {
    const { slotIndex, toLength } = payload;

    // Calculate cost - toLength is 1-indexed, but carIndex for cost is 0-indexed
    // So buying car #2 (toLength=2) uses carIndex=1
    const carIndex = toLength - 1;
    const modifiers = context.getVehicleCostModifiers();
    const cost = getDiscountedTrainCarPrice(carIndex, modifiers);

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
