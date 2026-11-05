import type { ActionExecutor } from '../executor';
import type { UpdateArtifactSetPayload } from '@/types';
import { useInitialStateStore } from '@/stores/initialState';
import { summarizeLoadout, artifactSlotCount } from '@/lib/artifacts';

/**
 * Executor for updating an artifact set.
 */
export const updateArtifactSetExecutor: ActionExecutor<'update_artifact_set'> = {
  execute(payload) {
    const initialStateStore = useInitialStateStore();
    initialStateStore.updateArtifactSet(
      payload.setName,
      payload.newLoadout.map(slot => ({
        artifactId: slot.artifactId,
        stones: [...slot.stones],
      }))
    );
    return 0; // Free action
  },

  getDisplayName(payload) {
    return payload.setName === 'earnings' ? 'Change Artifacts' : 'Update Set 2';
  },

  getEffectDescription(payload) {
    return summarizeLoadout(
      payload.newLoadout.map(slot => ({
        artifactId: slot.artifactId,
        stones: [...slot.stones],
      })),
      artifactSlotCount(useInitialStateStore().proPermit)
    );
  },
};
