/**
 * Infrastructure action payloads shared by the planners.
 */

/**
 * Payload for buying/upgrading a vehicle in a specific slot.
 */
export interface BuyVehiclePayload {
  slotIndex: number;
  vehicleId: number;
  trainLength?: number; // For hyperloop, defaults to 1
}

/**
 * Payload for buying/upgrading a hab in a specific slot.
 */
export interface BuyHabPayload {
  slotIndex: number;
  habId: number;
}

/**
 * Payload for buying a train car for a hyperloop train.
 */
export interface BuyTrainCarPayload {
  slotIndex: number; // Which vehicle slot has the hyperloop
  fromLength: number; // Train length before this purchase
  toLength: number; // Train length after this purchase
}

/**
 * Payload for buying a silo.
 */
export interface BuySiloPayload {
  fromCount: number; // Silos owned before purchase
  toCount: number; // Silos owned after purchase
}
