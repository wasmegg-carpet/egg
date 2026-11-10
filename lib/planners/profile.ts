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
import type { CurrencyWaitType } from './actions/currencyWait';
import type { FuelEarningsField } from './actions/fuelEarnings';

export interface PlannerCurrency {
  /** Plural noun used in text, e.g. 'gems' or 'bocks'. */
  name: string;
  /** Singular noun used in text, e.g. 'gem' or 'bock'. */
  singular: string;
  /** Plural noun at the start of a label, e.g. 'Gems' or 'Bocks'. */
  title: string;
  /** The action type this planner's saved plans use for "wait for the bank to reach an amount". */
  waitActionType: CurrencyWaitType;
  /** The field this planner's saved plans use for what partial-speed fueling earned. */
  fuelEarningsField: FuelEarningsField;
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
  /** Start of this planner's browser storage keys, so the planners' settings don't collide. */
  storagePrefix: string;
  /** Whether research offers delivery views. Enlightenment plans are about earnings and hatching, so it doesn't. */
  hasDeliveryViews: boolean;
  /** How the Max Vehicles ROI note says you get to the vehicles, including a trailing space if not empty. */
  maxVehiclesRoiRoute: string;
  /** Whether a plan moves between eggs in shifts. */
  hasShifts: boolean;
  /** The planner's name, used in the page title. */
  appName: string;
  /** What the start-of-plan settings are headed with. */
  planLabel: string;
  /** Start of exported library file names. */
  planFilePrefix: string;
  /** The egg the Wait for Missions section is limited to, or null to always show it. */
  missionsWaitEgg: string | null;
  /** Fuel eggs that don't go in the tank, so they never count against it. */
  tanklessFuelEggs: string[];
  /** Whether the Setup tab has the fuel tank panel with its per-egg amounts. */
  setupShowsFuelTank: boolean;
  /** The egg the Wait for Research Sale button is limited to, or null to always show it. */
  researchSaleEgg: string | null;
  /** Value of one egg before research. */
  baseEggValue: number;
  /** Icon asset for a fuel egg. */
  fuelEggIconPath: (egg: string) => string;
  /** A research puzzle cube multiplier that replaces the equipped set's, or null to use the set. */
  researchCubeMultiplier?: () => number | null;
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
