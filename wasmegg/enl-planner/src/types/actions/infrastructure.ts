import type { FuelEgg } from './eggs';
export type {
  BuyHabPayload,
  BuyVehiclePayload,
  BuyTrainCarPayload,
  BuySiloPayload,
} from 'lib/planners/types/actions/infrastructure';

/**
 * Payload for storing eggs in the fuel tank.
 */
export interface StoreFuelPayload {
  egg: FuelEgg; // Which virtue egg to store
  amount: number; // Number of eggs to store
  timeSeconds: number; // Time required (for display)
  fuelSpeed?: number; // 0.1 | 0.5 | 0.9 | 1.0 — default 1.0
  eggsShippedDuringFuel?: number; // eggs shipped at (1-speed) rate during fueling
  cashEarnedDuringFuel?: number; // bocks earned from shipped eggs during fueling
}

/**
 * Payload for removing eggs from the fuel tank.
 */
export interface RemoveFuelPayload {
  egg: FuelEgg; // Which virtue egg to remove
  amount: number; // Number of eggs to remove
}
