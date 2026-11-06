import { isVehicleId } from 'lib/farm/shipping_capacity';
import { applyDiscount } from 'lib/planners/utils/pricing';
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
 * Hyperloop train car virtue costs.
 * Index 0 = first car (free, comes with train), Index 1-9 = additional cars.
 */
export const HYPERLOOP_CAR_VIRTUE_COSTS: readonly number[] = [
  0, // 1st car (free with train)
  1.13231e26, // 2nd car
  6.86482e26, // 3rd car
  2.518e27, // 4th car
  6.96e27, // 5th car
  1.6056e28, // 6th car
  3.2636e28, // 7th car
  6.0422e28, // 8th car
  1.042e29, // 9th car
  1.69709e29, // 10th car
];

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
  if (purchaseIndex < 0 || purchaseIndex >= vehicle.virtueCost.length) return 0;

  const basePrice = vehicle.virtueCost[purchaseIndex];
  return applyDiscount(basePrice, getVehicleCostMultiplier(modifiers, isActiveSale));
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
  if (carIndex < 0 || carIndex >= HYPERLOOP_CAR_VIRTUE_COSTS.length) return 0;

  const basePrice = HYPERLOOP_CAR_VIRTUE_COSTS[carIndex];
  return applyDiscount(basePrice, getVehicleCostMultiplier(modifiers, isActiveSale));
}
