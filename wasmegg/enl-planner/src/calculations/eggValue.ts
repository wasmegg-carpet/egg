/**
 * Pure calculation functions for egg value.
 * These have no Vue dependencies and are fully testable.
 */

export {
  calculateResearchMultiplier,
  calculateTotalResearchMultiplier,
  calculateEggValue,
} from 'lib/planners/calculations/eggValue';

/** Base value of an Enlightenment egg (lib/eggs.ts). */
export const ENLIGHTENMENT_EGG_VALUE = 1e-7;
