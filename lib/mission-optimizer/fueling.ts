// The game's fueling pad, as both apps hand it to the optimizer: one pad feeds every mission slot, and it moves eggs
// into a ship at a rate proportional to the tank it draws from, 0.0003 of the tank's size a second at every tank
// level (9T a minute at the 500T tank), whatever the egg. So a full tank takes `1 / 0.0003` seconds, about 55.6
// minutes, to fuel at any level, and a launch takes that times its share of the tank. Kept free of the loot dataset,
// so a store or a light module can import it. See `solver/SPEC.md` section 18.

// The share of the tank the pad moves a second.
export const FUELING_TANK_SHARE_PER_SECOND = 0.0003;

// Eggs a second the pad moves for a tank of `tankCapacity` eggs: the player's tank size for their tank level
// (`fuelTankSizes[tankLevel]`), not the fuel budget the plan is held to, which can be what is stored in it.
export function fuelingRateOf(tankCapacity: number): number {
  return tankCapacity * FUELING_TANK_SHARE_PER_SECOND;
}
