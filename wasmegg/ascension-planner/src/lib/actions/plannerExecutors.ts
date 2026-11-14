/** The action executors only the ascension planner has. */

import { shiftExecutor } from './executors/shift';
import { waitForTEExecutor } from './executors/waitForTE';

export const plannerExecutors = {
  shift: shiftExecutor,
  wait_for_te: waitForTEExecutor,
};
