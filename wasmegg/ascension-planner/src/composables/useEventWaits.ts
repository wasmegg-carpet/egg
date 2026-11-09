import { useActionsStore } from '@/stores/actions';
import { usePlanStore } from '@/stores/plan';
import { useActionExecutor } from '@/composables/useActionExecutor';
import { generateActionId } from '@/types';
import { computeDependencies } from '@/lib/actions/executor';
import { useEventWaits as useSharedEventWaits } from 'lib/planners/composables/useEventWaits';

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
