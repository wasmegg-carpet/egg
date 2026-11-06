/**
 * Vehicle purchase planning at this planner's vehicle prices. The planner itself lives in
 * lib/planners/calculations/vehiclePurchasePlan.ts.
 */

import {
  planMaxVehicles as planMaxVehiclesAt,
  planVehiclesForTimeLimit as planVehiclesForTimeLimitAt,
} from 'lib/planners/calculations/vehiclePurchasePlan';
import { withPricing } from 'lib/planners/profile';
import { PROFILE } from '@/lib/profile';

export { HYPERLOOP_ID, calculateVehicleCapacity } from 'lib/planners/calculations/vehiclePurchasePlan';
export type {
  VehicleMultipliers,
  VehiclePurchaseStep,
  VehiclePlanResult,
  VehiclePlanningSnapshot,
  VehicleTimeStep,
  VehicleTimePlanResult,
} from 'lib/planners/calculations/vehiclePurchasePlan';

export const planMaxVehicles = withPricing(planMaxVehiclesAt, PROFILE.pricing);
export const planVehiclesForTimeLimit = withPricing(planVehiclesForTimeLimitAt, PROFILE.pricing);
