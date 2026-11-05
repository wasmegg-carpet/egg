import type { VirtueEgg } from './virtue';

/**
 * Payload for waiting to accumulate Truth Eggs (TE).
 */
export interface WaitForTEPayload {
  egg: VirtueEgg; // Which virtue egg
  targetTE: number; // Target TE number (1-98)
  teGained: number; // How many TE gained in this action
  eggsToLay: number; // Eggs to lay to reach target
  timeSeconds: number; // Time required
  startEggsDelivered: number; // Eggs delivered before this action
  startTE: number; // TE thresholds passed before this action
}

/**
 * Payload for waiting for a fixed amount of time.
 */
export interface WaitForTimePayload {
  totalTimeSeconds: number;
}

/**
 * Payload for waiting for habs to fill.
 */
export interface WaitForFullHabsPayload {
  habCapacity: number;
  ihr: number;
  currentPopulation: number;
  totalTimeSeconds: number;
}

/**
 * Payload for waiting for the next research sale.
 */
export interface WaitForResearchSalePayload {
  totalTimeSeconds: number;
}

/**
 * Payload for waiting for the running research sale to end.
 */
export interface WaitForResearchSaleEndPayload {
  totalTimeSeconds: number;
}

/**
 * Payload for waiting for the next 2x earnings event.
 */
export interface WaitForEarningsBoostPayload {
  totalTimeSeconds: number;
}

/**
 * Payload for waiting for the running 2x earnings event to end.
 */
export interface WaitForEarningsBoostEndPayload {
  totalTimeSeconds: number;
}

/**
 * Payload for waiting to reach a target gem count.
 */
export interface WaitForGemsPayload {
  targetGems: number;
  currentGems: number;
  requiredGems: number;
  earningsPerSecond: number;
  timeSeconds: number;
}

/**
 * Payload for waiting without earnings, population growth, or egg shipping.
 */
export interface WaitWithoutEarningsPayload {
  totalTimeSeconds: number;
}
