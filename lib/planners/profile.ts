/**
 * What differs between the planners, for code shared by both.
 *
 * Each planner defines one `PlannerProfile` (src/lib/profile.ts). Shared executors take it as a
 * factory argument; shared components read it with `usePlannerProfile()`
 * (ui/composables/planners/plannerProfile.ts), which each planner provides app-wide in main.ts.
 */

import type { Hab, HabCostModifiers } from './habs';
import type { VehicleCostModifiers } from './vehicles';
import type { CommonResearch, ResearchCostModifiers } from './calculations/commonResearch';

export interface PlannerCurrency {
  /** Plural noun used in text, e.g. 'gems' or 'bocks'. */
  name: string;
  /** Icon shown next to prices (an egginc/ asset path). */
  iconPath: string;
  /** Formats a price for display (no currency name). */
  formatPrice(price: number): string;
}

/** Discounted price lookups, in the planner's currency. */
export interface PlannerPricing {
  hab(hab: Hab, purchaseIndex: number, modifiers: HabCostModifiers, isActiveSale?: boolean): number;
  vehicle(vehicleId: number, purchaseIndex: number, modifiers: VehicleCostModifiers, isActiveSale?: boolean): number;
  trainCar(carIndex: number, modifiers: VehicleCostModifiers, isActiveSale?: boolean): number;
  research(
    research: CommonResearch,
    currentLevel: number,
    modifiers: ResearchCostModifiers,
    isActiveSale?: boolean
  ): number;
}

export interface PlannerProfile {
  /** What the planner spends. */
  currency: PlannerCurrency;
  missions: {
    /** Singular noun for a mission in text, e.g. 'virtue mission'. */
    noun: string;
    /** Heading over the active missions list. */
    activeHeading: string;
    /** Whether active mission cards carry a currency badge. */
    showCurrencyBadge: boolean;
  };
  /** Discounted prices, in the planner's currency (virtue prices vs regular prices). */
  pricing: PlannerPricing;
  /** Base of the internal hatchery rate's Truth Egg multiplier (base^TE). */
  ihrTruthEggBase: number;
}

/**
 * Binds a shared function that takes `pricing` first to one planner's prices, so the planner can
 * re-export it with its original signature.
 */
export function withPricing<A extends unknown[], R>(
  fn: (pricing: PlannerPricing, ...args: A) => R,
  pricing: PlannerPricing
): (...args: A) => R {
  return (...args) => fn(pricing, ...args);
}
