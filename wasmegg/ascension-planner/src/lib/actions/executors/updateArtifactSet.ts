import type { PayloadExecutor } from 'lib/planners/actions/executorTypes';
import type { UpdateArtifactSetPayload } from '@/types';
import { useInitialStateStore } from '@/stores/initialState';
import { summarizeLoadout, artifactSlotCount } from '@/lib/artifacts';

/**
 * Executor for updating an artifact set.
 */
export const updateArtifactSetExecutor: PayloadExecutor<UpdateArtifactSetPayload> = {
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
    const name = payload.setName === 'earnings' ? 'Earnings' : 'Delivery';
    return `Update ${name} Set`;
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
