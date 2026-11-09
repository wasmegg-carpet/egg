import { isVehicleId } from 'lib/farm/shipping_capacity';

import { VEHICLE_REGULAR_COSTS, HYPERLOOP_CAR_REGULAR_COSTS } from './vehicleCosts';
import type { VehicleCostModifiers } from 'lib/planners/vehicles';
import { getVehicleType, getVehicleCostMultiplier } from 'lib/planners/vehicles';
export type { VehicleId, VehicleType, VehicleCostModifiers } from 'lib/planners/vehicles';
export {
  vehicleTypes,
  getVehicleType,
  BASE_FLEET_SIZE,
  BASE_TRAIN_LENGTH,
  MAX_TRAIN_LENGTH,
  getVehicleCostMultiplier,
  countVehiclesOfType,
  countVehiclesOfTypeBefore,
} from 'lib/planners/vehicles';
export { isVehicleId };

/**
 * Hyperloop train car base costs (regular, not virtue).
 * Index 0 = first car (free, comes with train), Index 1-9 = additional cars.
 */
export const HYPERLOOP_CAR_COSTS: readonly number[] = HYPERLOOP_CAR_REGULAR_COSTS;

/**
 * Get the discounted price for purchasing a vehicle at a specific slot.
 * @param vehicleId The vehicle type to purchase
 * @param purchaseIndex Which purchase of this vehicle type (0-16)
 * @param modifiers Cost modifiers
 * @returns Discounted cost
 */
export function getDiscountedVehiclePrice(
  vehicleId: number,
  purchaseIndex: number,
  modifiers: VehicleCostModifiers,
  isActiveSale: boolean = false
): number {
  const vehicle = getVehicleType(vehicleId);
  if (!vehicle) return 0;
  const costs = VEHICLE_REGULAR_COSTS[vehicle.id];
  if (purchaseIndex < 0 || purchaseIndex >= costs.length) return 0;

  return costs[purchaseIndex] * getVehicleCostMultiplier(modifiers, isActiveSale);
}

/**
 * Get the discounted price for adding a train car to hyperloop.
 * @param carIndex Which car (0 = free first car, 1-9 = additional cars)
 * @param modifiers Cost modifiers
 * @returns Discounted cost
 */
export function getDiscountedTrainCarPrice(
  carIndex: number,
  modifiers: VehicleCostModifiers,
  isActiveSale: boolean = false
): number {
  if (carIndex < 0 || carIndex >= HYPERLOOP_CAR_COSTS.length) return 0;

  return HYPERLOOP_CAR_COSTS[carIndex] * getVehicleCostMultiplier(modifiers, isActiveSale);
}
