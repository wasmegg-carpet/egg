import type { VirtueEgg } from './virtue';

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

/**
 * Payload for storing eggs in the fuel tank.
 */
export interface StoreFuelPayload {
  egg: VirtueEgg; // Which virtue egg to store
  amount: number; // Number of eggs to store
  timeSeconds: number; // Time required (for display)
  fuelSpeed?: number; // 0.1 | 0.5 | 0.9 | 1.0 — default 1.0
  eggsShippedDuringFuel?: number; // eggs shipped at (1-speed) rate during fueling
  gemsEarnedDuringFuel?: number; // gems earned from shipped eggs during fueling
}

/**
 * Payload for removing eggs from the fuel tank.
 */
export interface RemoveFuelPayload {
  egg: VirtueEgg; // Which virtue egg to remove
  amount: number; // Number of eggs to remove
}
