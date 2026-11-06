/**
 * What differs between the planners, for code shared by both.
 *
 * Each planner defines one `PlannerProfile` (src/lib/profile.ts). Shared executors take it as a
 * factory argument; shared components read it with `usePlannerProfile()`
 * (ui/composables/planners/plannerProfile.ts), which each planner provides app-wide in main.ts.
 */

export interface PlannerCurrency {
  /** Plural noun used in text, e.g. 'gems' or 'bocks'. */
  name: string;
  /** Icon shown next to prices (an egginc/ asset path). */
  iconPath: string;
  /** Formats a price for display (no currency name). */
  formatPrice(price: number): string;
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
  /** Base of the internal hatchery rate's Truth Egg multiplier (base^TE). */
  ihrTruthEggBase: number;
}
