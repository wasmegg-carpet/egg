import type { ActionExecutor } from '../executor';
import type { EquipArtifactSetPayload } from '@/types';
import { useInitialStateStore } from '@/stores/initialState';

/**
 * Executor for equipping an artifact set.
 */
export const equipArtifactSetExecutor: ActionExecutor<'equip_artifact_set'> = {
  execute(payload) {
    const initialStateStore = useInitialStateStore();
    initialStateStore.setActiveArtifactSet(payload.setName);
    return 0; // Free action
  },

  getDisplayName(payload) {
    return payload.setName === 'earnings' ? 'Equip Artifacts' : 'Equip Set 2';
  },

  getEffectDescription(payload) {
    return payload.setName === 'earnings' ? 'Equipped the artifact set.' : 'Switched to artifact set 2.';
  },
};
