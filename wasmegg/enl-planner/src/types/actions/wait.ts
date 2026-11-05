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
 * Payload for waiting to reach a target bock count.
 */
export interface WaitForCashPayload {
  targetCash: number;
  currentCash: number;
  requiredCash: number;
  earningsPerSecond: number;
  timeSeconds: number;
}

/**
 * Payload for waiting without earnings, population growth, or egg shipping.
 */
export interface WaitWithoutEarningsPayload {
  totalTimeSeconds: number;
}
