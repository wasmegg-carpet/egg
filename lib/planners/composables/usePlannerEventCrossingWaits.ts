import { useActionsStore } from '@planner/stores/actions';
import { useActionExecutor } from './useActionExecutor';
import { generateActionId, type CalculationsSnapshot, type DraftAction } from '@planner/types';
import { computeDependencies } from '../actions/executor';
import type { CommonResearch } from '@planner/calculations/commonResearch';
import { getSimulationContext } from '../engine/adapter';
import { eventCrossingsForPurchase } from '../engine/researchSale';
import { useEventCrossingWaits as useSharedEventCrossingWaits } from './useEventCrossingWaits';

/** This planner's stores and research pricing wired into the shared crossing waits. */
export function useEventCrossingWaits() {
  const actionsStore = useActionsStore();
  const { prepareExecution, completeExecution, batch, isEditingPastGroup } = useActionExecutor();

  return useSharedEventCrossingWaits<CalculationsSnapshot, DraftAction, CommonResearch>({
    prepareExecution,
    completeExecution,
    batch,
    isEditingPastGroup,
    generateId: generateActionId,
    dependenciesFor: (type, payload) =>
      computeDependencies(type, payload, actionsStore.actionsBeforeInsertion, actionsStore.initialSnapshot.researchLevels),
    planTiming: getSimulationContext,
    crossingsForPurchase: (research, level, snapshot) =>
      eventCrossingsForPurchase(research, level, snapshot, getSimulationContext()),
  });
}
