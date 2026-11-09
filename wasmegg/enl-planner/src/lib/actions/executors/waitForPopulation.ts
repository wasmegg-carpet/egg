/**
 * Wait For Population Action Executor
 *
 * Waits until the farm holds a target population: a trophy, NAH, or any number the player picks.
 */

import type { PayloadExecutor } from 'lib/planners/actions/executorTypes';
import type { WaitForPopulationPayload } from '@/types';
import { formatDuration, formatNumber } from '@/lib/format';

export const waitForPopulationExecutor: PayloadExecutor<WaitForPopulationPayload> = {
  execute() {
    return 0;
  },

  getDisplayName(payload: WaitForPopulationPayload) {
    const target = formatNumber(payload.targetPopulation, 3);
    return payload.label ? `Wait for ${payload.label} (${target})` : `Wait for ${target} chickens`;
  },

  getEffectDescription(payload: WaitForPopulationPayload) {
    const time = formatDuration(payload.totalTimeSeconds);
    return payload.reachable ? time : `${time} (only until habs are full: they can't hold the target)`;
  },
};
