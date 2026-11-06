/**
 * Research related payloads.
 */

export interface BuyResearchPayload {
  researchId: string;
  fromLevel: number;
  toLevel: number;
}

/**
 * Sale types for toggle_sale action.
 */
export type SaleType = 'research' | 'hab' | 'vehicle';

/**
 * Payload for toggling a sale on or off.
 */
export interface ToggleSalePayload {
  saleType: SaleType;
  active: boolean;
  multiplier: number;
}

/**
 * Payload for toggling earnings boost.
 */
export interface ToggleEarningsBoostPayload {
  active: boolean;
  multiplier: number;
  eventId?: string;
}
