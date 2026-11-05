/**
 * Eggs the fuel tank on a non-virtue farm can hold. An enlightenment farm only lays Enlightenment
 * eggs, so that's the only egg a plan can add to the tank; the others are what the player already has.
 */

export type FuelEgg =
  | 'edible'
  | 'superfood'
  | 'medical'
  | 'rocket_fuel'
  | 'super_material'
  | 'fusion'
  | 'quantum'
  | 'immortality'
  | 'tachyon'
  | 'graviton'
  | 'dilithium'
  | 'prodigy'
  | 'terraform'
  | 'antimatter'
  | 'dark_matter'
  | 'ai'
  | 'nebula'
  | 'universe'
  | 'enlightenment';

/** In `ei.Egg` order, which is the order of `backup.artifacts.tankFuels`. */
export const FUEL_EGGS: FuelEgg[] = [
  'edible',
  'superfood',
  'medical',
  'rocket_fuel',
  'super_material',
  'fusion',
  'quantum',
  'immortality',
  'tachyon',
  'graviton',
  'dilithium',
  'prodigy',
  'terraform',
  'antimatter',
  'dark_matter',
  'ai',
  'nebula',
  'universe',
  'enlightenment',
];

export const FUEL_EGG_NAMES: Record<FuelEgg, string> = {
  edible: 'Edible',
  superfood: 'Superfood',
  medical: 'Medical',
  rocket_fuel: 'Rocket Fuel',
  super_material: 'Super Material',
  fusion: 'Fusion',
  quantum: 'Quantum',
  immortality: 'Immortality',
  tachyon: 'Tachyon',
  graviton: 'Graviton',
  dilithium: 'Dilithium',
  prodigy: 'Prodigy',
  terraform: 'Terraform',
  antimatter: 'Antimatter',
  dark_matter: 'Dark Matter',
  ai: 'AI',
  nebula: 'Nebula',
  universe: 'Universe',
  enlightenment: 'Enlightenment',
};

/** The egg this planner's farm lays. */
export const FARM_EGG: FuelEgg = 'enlightenment';

/** `ei.Egg` value of a fuel egg (ei.Egg.EDIBLE is 1). */
export function fuelEggToEiEgg(egg: FuelEgg): number {
  return FUEL_EGGS.indexOf(egg) + 1;
}

/** Fuel egg for an `ei.Egg` value, or undefined when the tank can't hold it. */
export function eiEggToFuelEgg(egg: number): FuelEgg | undefined {
  return FUEL_EGGS[egg - 1];
}

export function createEmptyFuelAmounts(): Record<FuelEgg, number> {
  return Object.fromEntries(FUEL_EGGS.map(egg => [egg, 0])) as Record<FuelEgg, number>;
}
