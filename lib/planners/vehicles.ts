/**
 * Vehicle types and helpers shared by the planners. Prices live in each planner's lib/vehicles.ts.
 */

import type { VehicleType as LibVehicleType } from '../farm/shipping_capacity';
import { vehicleTypes as libVehicleTypes, isVehicleId } from '../farm/shipping_capacity';
import { calculateCostMultiplier } from './utils/pricing';

export type VehicleId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

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
