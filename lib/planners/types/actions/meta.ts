/**
 * Action metadata helpers shared by the planners.
 */

import type { ResearchLevels, VehicleSlot } from '../index';

/**
 * Context passed to action executors.
 */
export interface StoreContext {
  habCapacity: {
    setHab(slotIndex: number, habId: number | null): void;
    habIds: (number | null)[];
  };
  shippingCapacity: {
    setVehicle(slotIndex: number, vehicleId: number | null): void;
    setTrainLength(slotIndex: number, length: number): void;
    vehicles: VehicleSlot[];
  };
  commonResearch: {
    setResearchLevel(researchId: string, level: number): void;
    researchLevels: ResearchLevels;
  };
  costModifiers: {
    habCostMultiplier: number;
    vehicleCostMultiplier: number;
    researchCostMultiplier: number;
  };
}

/**
 * Helper to generate action ID.
 */
export function generateActionId(): string {
  return `action_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
