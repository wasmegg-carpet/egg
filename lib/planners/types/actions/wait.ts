/**
 * Wait action payloads shared by the planners.
 */

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
 * Payload for waiting without earnings, population growth, or egg shipping.
 */
export interface WaitWithoutEarningsPayload {
  totalTimeSeconds: number;
}
