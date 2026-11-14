import { useActionsStore } from '@planner/stores/actions';
import { usePlanStore } from '@planner/stores/plan';
import { useActionExecutor } from './useActionExecutor';
import { generateActionId } from '@planner/types';
import { computeDependencies } from '../actions/executor';
import { useEventWaits as useSharedEventWaits } from './useEventWaits';

/** This planner's stores wired into the shared research sale and 2x earnings waits. */
export function useEventWaits() {
  const actionsStore = useActionsStore();
  const planStore = usePlanStore();
  const { prepareExecution, completeExecution, batch } = useActionExecutor();

  return useSharedEventWaits({
    planStartSeconds: () => planStore.planStartTime.getTime() / 1000,
    planStartOffset: () => actionsStore.planStartOffset,
    snapshot: () => actionsStore.effectiveSnapshot,
    prepareExecution,
    completeExecution,
    batch,
    generateId: generateActionId,
    dependenciesFor: (type, payload) =>
      computeDependencies(type, payload, actionsStore.actionsBeforeInsertion, actionsStore.initialSnapshot.researchLevels),
  });
}
