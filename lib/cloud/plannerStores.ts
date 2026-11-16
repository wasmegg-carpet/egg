/**
 * Adapters from a planner's IndexedDB (lib/planners/storage/db.ts) to what sync.ts needs, for one EID
 * partition. Links go in the planner's metadata store under `cloudLinks`, beside its other per-EID metadata.
 */
import type { createPlannerDb, PlanData } from '../planners/storage/db';
import type { LinkStore, Links, LocalStore } from './sync';

type PlannerDb = Pick<ReturnType<typeof createPlannerDb>, 'loadLibraryPlans' | 'savePlanToLibrary' | 'deletePlanFromLibrary' | 'saveMetadata' | 'loadMetadata'>;

export const LINKS_KEY = 'cloudLinks';

export function plannerStores(db: PlannerDb, partitionHash: string): { local: LocalStore; links: LinkStore } {
  return {
    local: {
      list: () => db.loadLibraryPlans(partitionHash),
      save: plan => db.savePlanToLibrary(partitionHash, plan as PlanData),
      remove: id => db.deletePlanFromLibrary(partitionHash, id),
    },
    links: {
      load: () => db.loadMetadata<Links>(partitionHash, LINKS_KEY),
      save: links => db.saveMetadata(partitionHash, LINKS_KEY, links),
    },
  };
}
