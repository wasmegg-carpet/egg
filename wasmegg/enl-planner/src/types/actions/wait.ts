export type {
  WaitForTimePayload,
  WaitForFullHabsPayload,
  WaitForResearchSalePayload,
  WaitForResearchSaleEndPayload,
  WaitForEarningsBoostPayload,
  WaitForEarningsBoostEndPayload,
  WaitWithoutEarningsPayload,
} from 'lib/planners/types/actions/wait';

/**
 * Payload for waiting until the farm holds a target population (a trophy, NAH, or any number).
 */
export interface WaitForPopulationPayload {
  targetPopulation: number;
  /** What the target is for, shown in the action history (e.g. 'Diamond'). */
  label?: string;
  currentPopulation: number;
  /** Offline internal hatchery rate, chickens per minute. */
  ihr: number;
  /** False when the habs can't hold the target: the wait then stops at full habs. */
  reachable: boolean;
  totalTimeSeconds: number;
}

export type { WaitForCashPayload } from 'lib/planners/actions/currencyWait';
