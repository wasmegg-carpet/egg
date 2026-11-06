import type { Action } from '@/types/actions/meta';
import type { EquippedArtifact } from '@/lib/artifacts/types';
import { withEmptyStones } from './fromBackup';
import { cloneLoadoutInputs } from './hash';
import type { AutoLoadoutInputs } from './types';

function lastSetUpdate(actions: Action[], setName: 'earnings' | 'elr'): EquippedArtifact[] | null {
  for (let i = actions.length - 1; i >= 0; i--) {
    const action = actions[i];
    if (action.type !== 'update_artifact_set') continue;
    const payload = action.payload as { setName: string; newLoadout: EquippedArtifact[] };
    if (payload.setName === setName) return payload.newLoadout;
  }
  return null;
}

/**
 * The loadout an ascension actually ran with, as editor inputs: C1's earnings set, H1's delivery set
 * as a `fixed` structure, and the stones it was simulated with. Falls back to `resolved` (the inputs
 * that ascension was given) for anything its actions don't show.
 */
export function extractUsedLoadout(
  actions: Action[],
  resolved: AutoLoadoutInputs
): AutoLoadoutInputs {
  const inputs = cloneLoadoutInputs(resolved);
  const earnings = lastSetUpdate(actions, 'earnings');
  if (earnings) inputs.earnings = withEmptyStones(earnings);
  const elr = lastSetUpdate(actions, 'elr');
  if (elr) {
    const artifactIds = elr.slice(0, 4).map(slot => slot.artifactId ?? null);
    while (artifactIds.length < 4) artifactIds.push(null);
    inputs.delivery = { mode: 'fixed', artifactIds };
  }
  return inputs;
}
