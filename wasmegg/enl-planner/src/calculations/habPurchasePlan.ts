/**
 * Hab purchase planning at this planner's hab prices. The planner itself lives in
 * lib/planners/calculations/habPurchasePlan.ts.
 */

import { simulateHabPurchases as simulateHabPurchasesAt } from 'lib/planners/calculations/habPurchasePlan';
import { withPricing } from 'lib/planners/profile';
import { PROFILE } from '@/lib/profile';

export { CHICKEN_UNIVERSE_ID } from 'lib/planners/calculations/habPurchasePlan';
export type { HabMultipliers, HabPurchaseStep, HabPlanResult } from 'lib/planners/calculations/habPurchasePlan';

export const simulateHabPurchases = withPricing(simulateHabPurchasesAt, PROFILE.pricing);
