/** The action executors only the enlightenment planner has. */

import { waitForPopulationExecutor } from './executors/waitForPopulation';

export const plannerExecutors = {
  wait_for_population: waitForPopulationExecutor,
};
