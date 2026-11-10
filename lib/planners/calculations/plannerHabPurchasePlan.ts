/**
 * Hab purchase planning at this planner's hab prices. The planner itself lives in
 * lib/planners/calculations/habPurchasePlan.ts.
 */

import { simulateHabPurchases as simulateHabPurchasesAt } from './habPurchasePlan';
import { withPricing } from '../profile';
import { PROFILE } from '@planner/lib/profile';

export { CHICKEN_UNIVERSE_ID } from './habPurchasePlan';
export type { HabMultipliers, HabPurchaseStep, HabPlanResult } from './habPurchasePlan';

export const simulateHabPurchases = withPricing(simulateHabPurchasesAt, PROFILE.pricing);
