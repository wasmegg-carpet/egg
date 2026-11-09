/**
 * Vehicle purchase planning at this planner's vehicle prices. The planner itself lives in
 * lib/planners/calculations/vehiclePurchasePlan.ts.
 */

import {
  planMaxVehicles as planMaxVehiclesAt,
  planVehiclesForTimeLimit as planVehiclesForTimeLimitAt,
} from './vehiclePurchasePlan';
import { withPricing } from '../profile';
import { PROFILE } from '@planner/lib/profile';

export { HYPERLOOP_ID, calculateVehicleCapacity } from './vehiclePurchasePlan';
export type {
  VehicleMultipliers,
  VehiclePurchaseStep,
  VehiclePlanResult,
  VehiclePlanningSnapshot,
  VehicleTimeStep,
  VehicleTimePlanResult,
} from './vehiclePurchasePlan';

export const planMaxVehicles = withPricing(planMaxVehiclesAt, PROFILE.pricing);
export const planVehiclesForTimeLimit = withPricing(planVehiclesForTimeLimitAt, PROFILE.pricing);
