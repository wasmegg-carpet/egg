import type { BaseCalculationsSnapshot } from '../types/actions/core';
import { calculateEggsDeliveredForTime } from './apply/math';

const NO_PASSIVE_DELIVERY = new Set([
  'store_fuel',
  'wait_for_te',
  'start_ascension',
  'shift',
  'change_artifacts',
  'toggle_sale',
  'equip_artifact_set',
  'update_artifact_set',
  'remove_fuel',
  'toggle_earnings_boost',
  'notification',
  'wait_for_no_earnings',
  'modify_bank',
]);

/** How many eggs ship on their own during an action taking `durationSeconds`. */
export function computePassiveEggsDelivered(
  action: { type: string },
  durationSeconds: number,
  prevSnapshot: BaseCalculationsSnapshot
): number {
  if (NO_PASSIVE_DELIVERY.has(action.type) || durationSeconds <= 0) return 0;
  return calculateEggsDeliveredForTime(durationSeconds, prevSnapshot);
}

/** `state` with `passiveEggs` added to the current egg's delivered total. */
export function applyPassiveEggs<S extends { currentEgg: string; eggsDelivered: Record<string, number> }>(
  state: S,
  passiveEggs: number
): S {
  if (passiveEggs <= 0) return state;
  const egg = state.currentEgg;
  return { ...state, eggsDelivered: { ...state.eggsDelivered, [egg]: (state.eggsDelivered[egg] || 0) + passiveEggs } };
}
