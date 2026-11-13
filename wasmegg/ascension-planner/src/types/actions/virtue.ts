/**
 * Virtue Egg types and constants.
 */

export type VirtueEgg = 'curiosity' | 'integrity' | 'kindness' | 'resilience' | 'humility';

export const VIRTUE_EGG_NAMES: Record<VirtueEgg, string> = {
  curiosity: 'Curiosity',
  integrity: 'Integrity',
  kindness: 'Kindness',
  resilience: 'Resilience',
  humility: 'Humility',
};

export const VIRTUE_EGGS: VirtueEgg[] = ['curiosity', 'integrity', 'humility', 'resilience', 'kindness'];

/** The names code shared with the enlightenment planner uses for these. */
export type FuelEgg = VirtueEgg;
export const FUEL_EGG_NAMES = VIRTUE_EGG_NAMES;
export const FUEL_EGGS = VIRTUE_EGGS;

export function createEmptyFuelAmounts(): Record<VirtueEgg, number> {
  return { curiosity: 0, integrity: 0, humility: 0, resilience: 0, kindness: 0 };
}
