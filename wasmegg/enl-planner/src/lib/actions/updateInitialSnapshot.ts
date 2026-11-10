import { useActionsStore } from '@/stores/actions';
import { computeSnapshot } from 'lib/planners/engine/compute';
import { getSimulationContext, createBaseEngineState } from 'lib/planners/engine/adapter';

/** Recompute the pure initial snapshot from base conditions (ignoring simulated head state) and replay the plan. */
export function updateInitialSnapshotAndRecalculate() {
  const initialSnapshot = computeSnapshot(createBaseEngineState(null), getSimulationContext());
  return useActionsStore().setInitialSnapshot(initialSnapshot);
}
