import type { Action, BuyResearchPayload, BuyHabPayload, BuyVehiclePayload, BuySiloPayload } from '@/types';
import { useContinuityStore } from '@/stores/continuity';

/**
 * Checks for continuity conflicts when inserting an action.
 * Returns a promise that:
 * - Resolves to `true` if the action is safe to insert (or user confirmed removal of conflicts).
 * - Resolves to `false` if the user cancelled the action.
 *
 * If conflicts are found, it triggers the Continuity Dialog.
 * If user confirms, it REMOVES the conflicting actions from the store!
 */
export async function checkAndHandleContinuity(
  actions: Action[],
  newAction: Omit<Action, 'id' | 'index' | 'timestamp' | 'endState' | 'cost' | 'dependents' | 'totalTimeSeconds'> & {
    dependsOn: string[];
  },
  insertIndex: number,
  removeActionsCallback: (idsToRemove: string[]) => Promise<void>
): Promise<boolean> {
  // If inserting at end, no future conflicts possible
  // (Unless there's some complex time travel, but usually insertion at end is current)
  // Actually insertIndex is -1 if at end.
  if (insertIndex === -1 || insertIndex >= actions.length) {
    return true;
  }

  // Determine current context
  const prevAction = actions[insertIndex - 1];
  // If no previous action, use default start values
  const currentShiftCount = prevAction?.endState.shiftCount ?? 0;

  // Identify conflicts
  const conflicts: Action[] = [];

  // Helper to check if an action is in a later shift
  const isLaterShift = (action: Action) => action.endState.shiftCount > currentShiftCount;

  // We only care about purchase actions in future shifts
  const futureActions = actions.slice(insertIndex);

  for (const action of futureActions) {
    if (!isLaterShift(action)) continue;

    const currentEgg = action.endState.currentEgg;

    // 1. Research (Curiosity)
    if (newAction.type === 'buy_research' && action.type === 'buy_research' && currentEgg === 'curiosity') {
      const newPayload = newAction.payload as BuyResearchPayload;
      const existingPayload = action.payload as BuyResearchPayload;

      if (existingPayload.researchId === newPayload.researchId) {
        conflicts.push(action);
      }
    }

    // 2. Hab (Kindness/Integrity)
    else if (
      newAction.type === 'buy_hab' &&
      action.type === 'buy_hab' &&
      (currentEgg === 'kindness' || currentEgg === 'integrity')
    ) {
      const newPayload = newAction.payload as BuyHabPayload;
      const existingPayload = action.payload as BuyHabPayload;

      // Conflict if same slot and new purchase is "better" or equal (invalidating later purchase)
      // Assuming habId is monotonic with quality (which it is, 0-18)
      if (existingPayload.slotIndex === newPayload.slotIndex && newPayload.habId >= existingPayload.habId) {
        conflicts.push(action);
      }
    }

    // 3. Vehicle (Kindness/Integrity)
    else if (
      newAction.type === 'buy_vehicle' &&
      action.type === 'buy_vehicle' &&
      (currentEgg === 'kindness' || currentEgg === 'integrity')
    ) {
      const newPayload = newAction.payload as BuyVehiclePayload;
      const existingPayload = action.payload as BuyVehiclePayload;

      if (existingPayload.slotIndex === newPayload.slotIndex && newPayload.vehicleId >= existingPayload.vehicleId) {
        // Special case: Hyperloop train length?
        // If vehicles are same, check train length?
        // User didn't specify, but "exceeds" implies simple ID check is mostly sufficient.
        conflicts.push(action);
      }
    }

    // 4. Silo (Resilience)
    else if (newAction.type === 'buy_silo' && action.type === 'buy_silo' && currentEgg === 'resilience') {
      const newPayload = newAction.payload as BuySiloPayload;
      const existingPayload = action.payload as BuySiloPayload;

      if (newPayload.toCount >= existingPayload.toCount) {
        conflicts.push(action);
      }
    }
  }

  if (conflicts.length === 0) {
    return true;
  }

  // Conflicts found - Trigger Dialog
  const store = useContinuityStore();
  const confirmed = await store.requestConfirmation(
    'Continuity Check',
    `This purchase conflicts with ${conflicts.length} later purchase${conflicts.length > 1 ? 's' : ''}. ` +
      `Buying this now invalidates the later purchase${conflicts.length > 1 ? 's' : ''}. ` +
      `Do you want to remove the later purchase${conflicts.length > 1 ? 's' : ''}?`,
    conflicts.map(a => a.id)
  );

  if (confirmed) {
    // User wants to proceed and remove future actions

    // IMPORTANT: Before removing, we must unlink any dependents that are NOT being removed.
    // This prevents the cascading removal from deleting future actions that are still valid
    // (e.g. "Buy Silo 10" depends on "Buy Silo 9", but if we remove "Buy Silo 9" because
    // we inserted a better purchase earlier, "Buy Silo 10" should stay).
    const conflictIds = new Set(conflicts.map(a => a.id));

    for (const conflict of conflicts) {
      for (const depId of conflict.dependents) {
        // If the dependent is NOT in the kill list, we must save it by breaking the dependency
        if (!conflictIds.has(depId)) {
          const depAction = actions.find(a => a.id === depId);
          if (depAction) {
            depAction.dependsOn = depAction.dependsOn.filter(id => id !== conflict.id);
          }
        }
      }
    }

    await removeActionsCallback(conflicts.map(a => a.id));
    return true;
  } else {
    // User cancelled
    return false;
  }
}
