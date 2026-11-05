/**
 * Buy Vehicle Action Executor
 */

import type { ActionExecutor, ExecutorContext } from '../executor';
import type { BuyVehiclePayload } from '@/types';
import { getVehicleType, getDiscountedVehiclePrice, countVehiclesOfType } from '@/lib/vehicles';
import { formatNumber } from '@/lib/format';

export const buyVehicleExecutor: ActionExecutor<'buy_vehicle'> = {
  execute(payload: BuyVehiclePayload, context: ExecutorContext): number {
    const { slotIndex, vehicleId, trainLength } = payload;

    // Get current vehicles to determine purchase index
    const vehicles = context.getVehicles();
    const purchaseIndex = countVehiclesOfType(vehicles, vehicleId);

    // Calculate cost with modifiers
    const modifiers = context.getVehicleCostModifiers();
    const cost = getDiscountedVehiclePrice(vehicleId, purchaseIndex, modifiers);

    // Apply changes to store
    context.setVehicle(slotIndex, vehicleId);
    if (trainLength !== undefined && vehicleId === 11) {
      context.setTrainLength(slotIndex, trainLength);
    }

    return cost;
  },

  getDisplayName(payload: BuyVehiclePayload): string {
    const vehicle = getVehicleType(payload.vehicleId);
    const name = vehicle?.name ?? 'Unknown Vehicle';

    if (payload.vehicleId === 11 && payload.trainLength && payload.trainLength > 1) {
      return `${name} (${payload.trainLength} cars) → slot ${payload.slotIndex + 1}`;
    }

    return `${name} → slot ${payload.slotIndex + 1}`;
  },

  getEffectDescription(payload: BuyVehiclePayload): string {
    const vehicle = getVehicleType(payload.vehicleId);
    if (!vehicle) return '';

    const capacity = vehicle.baseCapacityPerSecond;
    const multiplier = payload.vehicleId === 11 && payload.trainLength ? payload.trainLength : 1;
    const totalCapacity = capacity * multiplier;

    return `+${formatNumber(totalCapacity * 3600, 2)}/hr shipping`;
  },
};
