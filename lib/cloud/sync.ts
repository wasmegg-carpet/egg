/**
 * Two-way sync between one planner's local plan library (IndexedDB, one partition = one EID) and the EID's
 * cloud library.
 *
 * A pass compares three things: the local plans, the cloud index's entries for this planner, and the *links*
 * (local plan id → cloud id + the timestamp last synced), kept in the planner's metadata store. Links live
 * outside the plan records because every local writer builds a fresh record and would wipe extra fields.
 *
 *   local plan gone, linked          → deleted here: delete the cloud copy (tombstone in the index)
 *   cloud entry tombstoned            → deleted elsewhere: delete the local copy
 *   cloud entry, no local copy        → new elsewhere: download it
 *   cloud newer than local and link   → changed elsewhere: download it
 *   local plan, no link               → new here: upload it
 *   local newer than link             → changed here: upload it
 *
 * Every local plan syncs: those already in a browser when it first connects (a new library, another device, a
 * replaced library) upload on that first pass, so nothing is left behind for the player to send up by hand.
 * (Links written by earlier builds may carry a `localOnly` flag; it's ignored.)
 *
 * When both sides changed, the newer timestamp wins. All index changes from a pass go up in one main-file
 * write at the end, even when the pass stops early (rate limit, network), and links are only advanced once
 * that write succeeds, so an interrupted pass is simply redone.
 */
import { CloudError } from './api';
import { markDeleted, upsertEntry, type CloudLibrary, type IndexEntry, type LibraryIndex, type PlannerId } from './library';

/** The planners' local plan record (lib/planners/storage/db.ts PlanData). */
export interface LocalPlan {
  id: string;
  name: string;
  timestamp: number;
  data: unknown;
}

/** One planner's local library, for one EID partition. */
export interface LocalStore {
  list(): Promise<LocalPlan[]>;
  save(plan: LocalPlan): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface Link {
  cloudId?: string;
  /** The plan's timestamp when it was last uploaded or downloaded. */
  syncedTimestamp?: number;
}

export type Links = Record<string, Link>;

/** Persists links. `load` answers null until links were first saved (the cloud is new to this planner here). */
export interface LinkStore {
  load(): Promise<Links | null>;
  save(links: Links): Promise<void>;
}

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  deletedHere: number;
  deletedInCloud: number;
  /** Local plans that should be in the cloud but aren't up to date yet (retry later). */
  pending: number;
  /** Why the pass stopped early, if it did. */
  error?: CloudError | Error;
}

export interface SyncOptions {
  library: CloudLibrary;
  planner: PlannerId;
  local: LocalStore;
  links: LinkStore;
  /** A fresh local plan id, for a downloaded plan whose original id is taken here. */
  newLocalId?: () => string;
  /** Re-read the cloud index first (default true). */
  refresh?: boolean;
}

/** Status of one local plan, for the library's badges. */
export type PlanCloudState = 'synced' | 'pending';

export function planState(plan: LocalPlan, links: Links): PlanCloudState {
  const link = links[plan.id];
  if (!link) return 'pending';
  return link.cloudId && (link.syncedTimestamp ?? 0) >= plan.timestamp ? 'synced' : 'pending';
}

const passes = new Map<string, Promise<SyncResult>>();

/**
 * Run a pass, one at a time per library and planner: within this tab by chaining, and across tabs with a Web
 * Lock where the browser has them (two tabs syncing at once could both upload the same new plan).
 */
export function syncPlanner(options: SyncOptions): Promise<SyncResult> {
  const key = `${options.library.marker}:${options.planner}`;
  const previous = passes.get(key);
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const exclusive = (): Promise<SyncResult> =>
    locks ? locks.request(`wasmegg-cloud-sync:${key}`, () => runPass(options)) : runPass(options);
  const next = (previous ?? Promise.resolve()).catch(() => undefined).then(exclusive);
  passes.set(key, next);
  void next.finally(() => {
    if (passes.get(key) === next) passes.delete(key);
  });
  return next;
}

async function runPass({ library, planner, local, links: linkStore, newLocalId = randomLocalId, refresh = true }: SyncOptions): Promise<SyncResult> {
  const result: SyncResult = { uploaded: 0, downloaded: 0, deletedHere: 0, deletedInCloud: 0, pending: 0 };
  const links = (await linkStore.load()) ?? {};
  const indexChanges: ((index: LibraryIndex) => void)[] = [];
  const afterIndex: (() => void)[] = [];

  try {
    if (refresh) await library.refresh();
    const localPlans = new Map((await local.list()).map(p => [p.id, p]));
    const entries = library.index.plans.filter(e => e.planner === planner);
    const entryById = new Map(entries.map(e => [e.id, e]));
    const localIdByCloudId = new Map<string, string>();
    for (const [localId, link] of Object.entries(links)) if (link.cloudId) localIdByCloudId.set(link.cloudId, localId);

    // Deleted here.
    for (const [localId, link] of Object.entries(links)) {
      if (localPlans.has(localId)) continue;
      const entry = link.cloudId ? entryById.get(link.cloudId) : undefined;
      if (entry && !entry.deletedAt) {
        await library.removePlan(entry.id);
        indexChanges.push(index => markDeleted(index, entry.id));
        afterIndex.push(() => delete links[localId]);
        result.deletedInCloud++;
      } else {
        delete links[localId];
      }
    }

    // Changed or deleted elsewhere.
    for (const entry of entries) {
      const localId = localIdByCloudId.get(entry.id);
      const plan = localId ? localPlans.get(localId) : undefined;
      if (entry.deletedAt) {
        if (localId && plan) {
          await local.remove(localId);
          localPlans.delete(localId);
          result.deletedHere++;
        }
        if (localId) delete links[localId];
        continue;
      }
      if (localId && !plan) continue; // deleted here; handled above
      const link = localId ? links[localId] : undefined;
      const newer = !plan || (entry.timestamp > (link?.syncedTimestamp ?? 0) && entry.timestamp > plan.timestamp);
      if (!newer) continue;
      const stored = await library.loadPlan(entry.id);
      if (!stored) continue; // object gone; touch() will drop the entry
      const id = localId ?? (stored.localId && !localPlans.has(stored.localId) && !links[stored.localId] ? stored.localId : newLocalId());
      const downloaded: LocalPlan = { id, name: stored.name, timestamp: stored.timestamp, data: stored.data };
      await local.save(downloaded);
      localPlans.set(id, downloaded);
      links[id] = { cloudId: entry.id, syncedTimestamp: stored.timestamp };
      result.downloaded++;
    }

    // Changed here.
    for (const plan of localPlans.values()) {
      const link = links[plan.id];
      if (link?.cloudId && plan.timestamp <= (link.syncedTimestamp ?? 0) && entryById.has(link.cloudId)) continue;
      const previous = link?.cloudId;
      const id = await library.storePlan({ id: previous, planner, name: plan.name, timestamp: plan.timestamp, localId: plan.id, data: plan.data });
      const entry: IndexEntry = { id, planner, name: plan.name, timestamp: plan.timestamp };
      indexChanges.push(index => upsertEntry(index, entry, previous));
      afterIndex.push(() => {
        links[plan.id] = { cloudId: id, syncedTimestamp: plan.timestamp };
      });
      result.uploaded++;
    }
  } catch (err) {
    result.error = err instanceof Error ? err : new Error(String(err));
  } finally {
    if (indexChanges.length) {
      try {
        await library.updateIndex(index => indexChanges.forEach(change => change(index)));
        afterIndex.forEach(apply => apply());
      } catch (err) {
        result.error ??= err instanceof Error ? err : new Error(String(err));
        // Uploaded objects the index doesn't list are orphans; they expire. Links stay put, so the next
        // pass uploads again.
      }
    }
    await linkStore.save(links);
  }

  for (const plan of await local.list()) {
    if (planState(plan, links) === 'pending') result.pending++;
  }
  return result;
}

function randomLocalId(): string {
  return Math.random().toString(36).substring(2, 15);
}
