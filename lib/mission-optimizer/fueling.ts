// The game's fueling pad, as both apps hand it to the optimizer: one pad feeds every mission slot, and it moves eggs
// into a ship at its tank level's output (`fuelTankOutputsPerMinute`, beside the tank sizes in `../missions.ts`),
// whatever the egg. A full tank takes from 400 seconds (level 0) to 3333 seconds (levels 2 and 7) to fuel, and a
// launch takes that times its share of the tank. Kept free of the loot dataset, so a store or a light module can
// import it. See `solver/SPEC.md` section 18.

import { fuelTankOutputsPerMinute } from '../missions';

// Eggs a second the pad moves at tank level `tankLevel`: the player's tank level, not the fuel budget the plan is held
// to, which can be what is stored in the tank. Undefined for a level the game does not have, which the optimizer reads
// as no pad at all.
export function fuelingRateOfLevel(tankLevel: number): number | undefined {
  const perMinute = Number.isInteger(tankLevel) ? fuelTankOutputsPerMinute[tankLevel] : undefined;
  return perMinute === undefined ? undefined : perMinute / 60;
}
