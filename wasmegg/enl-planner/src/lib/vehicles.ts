import {
  vehicleTypes as libVehicleTypes,
  type VehicleType as LibVehicleType,
  isVehicleId,
} from 'lib/farm/shipping_capacity';
import { calculateCostMultiplier, applyDiscount } from '@/utils/pricing';

export type VehicleId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export { isVehicleId };

export interface VehicleType extends LibVehicleType {
  // Alias baseCapacity to baseCapacityPerSecond for compatibility
  baseCapacityPerSecond: number;
  isHover: boolean;
  isHyperloop: boolean;
  // virtueCost is now in LibVehicleType
}

export const vehicleTypes: VehicleType[] = libVehicleTypes.map(v => {
  const isHover = v.id >= 9;
  const isHyperloop = v.id === 11;
  return {
    ...v,
    baseCapacityPerSecond: v.baseCapacity,
    isHover,
    isHyperloop,
    virtueCost: v.virtueCost,
  };
});

/**
 * Get a vehicle type by ID.
 */
export function getVehicleType(id: number): VehicleType | undefined {
  if (!isVehicleId(id)) return undefined;
  return vehicleTypes[id];
}

/**
 * Base fleet size without research.
 */
export const BASE_FLEET_SIZE = 4;

/**
 * Base train length for hyperloop without research.
 */
export const BASE_TRAIN_LENGTH = 5;

/**
 * Maximum train length with all research.
 */
export const MAX_TRAIN_LENGTH = 10;

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
 * Cost modifiers for vehicle purchases.
 */
export interface VehicleCostModifiers {
  bustUnionsLevel: number; // Epic research: -5% per level (max 10)
  vehicleCostMultiplier: number; // Colleggtible: 0.90-1.0
}

/**
 * Calculate the total cost multiplier from all sources.
 */
export function getVehicleCostMultiplier(modifiers: VehicleCostModifiers, isActiveSale: boolean = false): number {
  const multiplier = calculateCostMultiplier(modifiers.bustUnionsLevel, 0.05, modifiers.vehicleCostMultiplier);
  return isActiveSale ? multiplier * 0.25 : multiplier;
}

/**
 * Count how many of a specific vehicle type are in the current fleet.
 */
export function countVehiclesOfType(vehicles: { vehicleId: number | null }[], targetVehicleId: number): number {
  return vehicles.filter(v => v.vehicleId === targetVehicleId).length;
}

/**
 * Count how many of a specific vehicle type are in slots before a given index.
 * Used for displaying what was likely paid for a vehicle in a specific slot.
 */
export function countVehiclesOfTypeBefore(
  vehicles: { vehicleId: number | null }[],
  targetVehicleId: number,
  beforeIndex: number
): number {
  return vehicles.slice(0, beforeIndex).filter(v => v.vehicleId === targetVehicleId).length;
}

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
