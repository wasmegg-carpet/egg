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
    const name = payload.setName === 'earnings' ? '1' : '2';
    return `Equip Set ${name}`;
  },

  getEffectDescription(payload) {
    const name = payload.setName === 'earnings' ? '1' : '2';
    return `Switched to artifact set ${name}.`;
  },
};
