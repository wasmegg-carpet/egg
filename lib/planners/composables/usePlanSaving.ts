import type { Ref } from 'vue';
import { useActionsStore } from '@planner/stores/actions';
import { safeImport } from '../import';

/** Saving the current plan to the library, under its existing name or a new one. */
export function usePlanSaving(partitionHash: Ref<string | null>) {
  const actionsStore = useActionsStore();

  async function saveCurrentPlan() {
    if (!partitionHash.value) return;

    if (actionsStore.activePlanId) {
      const plans = await (await safeImport(() => import('@planner/lib/storage/db'))).loadLibraryPlans(partitionHash.value!);
      const current = plans.find(p => p.id === actionsStore.activePlanId);
      if (current) {
        await actionsStore.savePlan(current.name, partitionHash.value);
        return;
      }
    }

    // Prompt for name if no active plan
    const name = prompt('Enter a name for this plan:');
    if (name) {
      await actionsStore.savePlan(name, partitionHash.value);
    }
  }

  async function savePlanAs() {
    if (!partitionHash.value) return;
    const name = prompt('Enter a new name for this plan:');
    if (name) {
      // Reset ID to trigger a new save
      const tempId = actionsStore.activePlanId;
      actionsStore.activePlanId = null;
      try {
        await actionsStore.savePlan(name, partitionHash.value);
      } catch (err) {
        actionsStore.activePlanId = tempId;
        alert('Save failed: ' + err);
      }
    }
  }

  return { saveCurrentPlan, savePlanAs };
}
