/**
 * The planner's view of the player's cloud library (lib/cloud): one shared state per page.
 *
 * When an EID is entered, the library opens by itself on a remembered device, or the UI asks for the PIN
 * right away; there is no separate "unlock" step for the player to find. Sync runs after opening, after local
 * library changes (`notifyLocalChange`, and the actions store's libraryUpdateTick), and when the tab comes back
 * into view. Downloads bump libraryUpdateTick so the library list refreshes.
 */
import { computed, reactive, shallowRef, watch } from 'vue';
import { PROFILE } from '@planner/lib/profile';
import { useActionsStore } from '@planner/stores/actions';
import * as plannerDb from '@planner/lib/storage/db';
import { CloudApi, CloudError } from '../../cloud/api';
import type { PinType } from '../../cloud/crypto';
import { cachedTable, cacheTable, forgetCachedTable, forgetDevice, rememberDevice, rememberedLibrary } from '../../cloud/device';
import { CloudLibrary, type CustomTableEntry, type ShareRecord } from '../../cloud/library';
import { LINKS_KEY, plannerStores } from '../../cloud/plannerStores';
import { createShare, createTableShare, forgetUsedShares, listShares, revokeShare, type SharedTableMeta } from '../../cloud/share';
import { planState, syncPlanner, type Links, type LocalPlan, type PlanCloudState, type SyncResult } from '../../cloud/sync';
import type { ShareKind } from '../../cloud/api';

export type CloudStatus =
  /** No EID entered. */
  | 'off'
  | 'checking'
  /** This EID has no cloud library. */
  | 'none'
  /** It has one; waiting for the PIN. */
  | 'locked'
  | 'opening'
  | 'ready'
  /** The cloud couldn't be reached; the local library works as always. */
  | 'unavailable';

const api = new CloudApi();
const library = shallowRef<CloudLibrary | null>(null);
const state = reactive({
  status: 'off' as CloudStatus,
  eid: '',
  partitionHash: '',
  pinType: 'pin6' as PinType,
  remembered: false,
  syncing: false,
  lastSync: null as SyncResult | null,
  links: {} as Links,
  error: '' as string,
  /** The open library's custom Chain Finder table (a reactive copy of its index entry). */
  customTable: null as CustomTableEntry | null,
});

let syncTimer: ReturnType<typeof setTimeout> | undefined;
let visibilityHooked = false;
let tickWatched = false;

/** Sync after every library save the actions store makes (it bumps libraryUpdateTick), on any tab. */
function watchLibraryTick(): void {
  if (tickWatched) return;
  tickWatched = true;
  const actions = useActionsStore();
  watch(
    () => actions.libraryUpdateTick,
    () => requestSync()
  );
}

/** A message for the player from any failure. */
export function cloudMessage(err: unknown): string {
  if (!(err instanceof CloudError)) return err instanceof Error ? err.message : String(err);
  switch (err.code) {
    case 'wrong_pin':
      return err.retryAfter ? `That PIN isn’t right. Wait ${err.retryAfter} s before trying again.` : 'That PIN isn’t right.';
    case 'throttled':
      return `Too many wrong PINs. Try again in ${err.retryAfter ?? 60} s.`;
    case 'pin_format':
      return err.message;
    case 'eid_not_found':
      return 'Egg Inc doesn’t know this EID, so a cloud library can’t be made for it.';
    case 'library_exists':
      return 'This EID already has a cloud library.';
    case 'quota_exceeded':
      return err.message.replace(/^a library/, 'A cloud library');
    case 'rate_limited':
      return 'The cloud library is busy. It will try again shortly.';
    case 'network':
      return 'Couldn’t reach the cloud library. Your plans are still saved in this browser.';
    case 'too_large':
      return 'This plan is too big to store in the cloud (5 MB).';
    default:
      return err.message;
  }
}

function eidOf(playerId: string): string {
  return playerId.trim().replace(/^mk2!/i, '');
}

function stores() {
  return plannerStores(plannerDb, state.partitionHash);
}

/** Back to "never synced": the next library opened here gets every local plan uploaded as new. */
async function resetLinks(): Promise<void> {
  await plannerDb.saveMetadata(state.partitionHash, LINKS_KEY, null);
}

async function loadLinks(): Promise<void> {
  state.links = (await stores().links.load()) ?? {};
}

async function opened(lib: CloudLibrary, remember: boolean): Promise<void> {
  library.value = lib;
  state.customTable = lib.customTable;
  state.pinType = lib.settings.pinType;
  state.status = 'ready';
  state.error = '';
  if (remember) {
    await rememberDevice(lib.remember());
    state.remembered = true;
  }
  void lib.touch().catch(() => undefined);
  await runSync();
}

/** Point the cloud at the entered EID (and its local partition). Opens it by itself when this device is remembered. */
async function connect(playerId: string, partitionHash: string): Promise<void> {
  watchLibraryTick();
  const eid = eidOf(playerId);
  if (eid === state.eid && partitionHash === state.partitionHash && state.status !== 'unavailable') return;
  library.value = null;
  state.customTable = null;
  state.eid = eid;
  state.partitionHash = partitionHash;
  state.lastSync = null;
  state.error = '';
  state.remembered = false;
  if (!eid || !partitionHash) {
    state.status = 'off';
    return;
  }
  await loadLinks();
  state.status = 'checking';
  try {
    const remembered = await rememberedLibrary(eid);
    if (remembered) {
      state.status = 'opening';
      try {
        await opened(await CloudLibrary.resume(api, remembered), false);
        state.remembered = true;
        return;
      } catch (err) {
        // Offline: say so, and keep the remembered keys for next time.
        if (err instanceof CloudError && (err.code === 'network' || err.code === 'rate_limited' || err.code === 'busy')) throw err;
        // Anything else (PIN changed or library replaced elsewhere, or unusable remembered keys): forget, and ask.
        await forgetDevice(eid);
      }
    }
    const settings = await CloudLibrary.lookup(api, eid);
    if (state.eid !== eid) return; // the EID changed meanwhile
    state.status = settings ? 'locked' : 'none';
    if (settings) state.pinType = settings.pinType;
  } catch (err) {
    state.status = 'unavailable';
    state.error = cloudMessage(err);
  }
}

async function unlock(pin: string, remember: boolean): Promise<void> {
  state.status = 'opening';
  try {
    await opened(await CloudLibrary.unlock(api, state.eid, pin), remember);
  } catch (err) {
    state.status = 'locked';
    throw new Error(cloudMessage(err));
  }
}

/** Set up a library (or replace this EID's, for a forgotten PIN). The UI confirms the PIN and warns first. */
async function create(pinType: PinType, pin: string, remember: boolean, replace = false): Promise<void> {
  const before = state.status;
  state.status = 'opening';
  try {
    if (replace) await forgetDevice(state.eid);
    const lib = await CloudLibrary.create(api, state.eid, pinType, pin, undefined, replace);
    // A fresh library: every plan already in this browser uploads on the first sync.
    await resetLinks();
    await loadLinks();
    await opened(lib, remember);
  } catch (err) {
    state.status = before;
    throw new Error(cloudMessage(err));
  }
}

async function changePin(pinType: PinType, pin: string): Promise<void> {
  const lib = library.value;
  if (!lib) return;
  try {
    await lib.changePin(pinType, pin);
  } catch (err) {
    throw new Error(cloudMessage(err));
  }
  state.pinType = pinType;
  if (state.remembered) await rememberDevice(lib.remember());
}

async function forget(): Promise<void> {
  await forgetDevice(state.eid);
  state.remembered = false;
  library.value = null;
  state.customTable = null;
  state.status = 'locked';
}

/** Delete the cloud library and every plan in it. Plans in this browser stay (as local-only). */
async function deleteLibrary(): Promise<void> {
  const lib = library.value;
  if (!lib) return;
  try {
    await lib.deleteLibrary();
  } catch (err) {
    throw new Error(cloudMessage(err));
  }
  await forgetDevice(state.eid);
  await resetLinks();
  await forgetCachedTable(lib.marker);
  library.value = null;
  state.customTable = null;
  state.links = {};
  state.remembered = false;
  state.lastSync = null;
  state.status = 'none';
}

async function runSync(): Promise<SyncResult | null> {
  const lib = library.value;
  if (!lib || !state.partitionHash) return null;
  state.syncing = true;
  try {
    const { local, links } = stores();
    const result = await syncPlanner({ library: lib, planner: PROFILE.storagePrefix, local, links });
    state.lastSync = result;
    state.customTable = lib.customTable;
    state.error = result.error ? cloudMessage(result.error) : '';
    await loadLinks();
    if (result.downloaded || result.deletedHere) {
      const actions = useActionsStore();
      actions.libraryUpdateTick++;
    }
    // Retry what's left over after a rate limit or network blip.
    if (result.error && result.pending) requestSync(result.error instanceof CloudError && result.error.retryAfter ? result.error.retryAfter * 1000 : 30_000);
    return result;
  } finally {
    state.syncing = false;
  }
}

/** Sync soon (debounced): after a local change, or to retry. */
function requestSync(delayMs = 1500): void {
  if (!library.value) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void runSync(), delayMs);
}

function hookVisibility(): void {
  if (visibilityHooked || typeof document === 'undefined') return;
  visibilityHooked = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync(500);
  });
}

async function share(plan: LocalPlan, kind: ShareKind): Promise<ShareRecord> {
  const lib = library.value;
  if (!lib) throw new Error('Open your cloud library to share plans.');
  try {
    const pageUrl = typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`;
    return await createShare(lib, { planner: PROFILE.storagePrefix, name: plan.name, timestamp: plan.timestamp, data: plan.data }, kind, pageUrl);
  } catch (err) {
    throw new Error(cloudMessage(err));
  }
}

// ---- The custom Chain Finder table ----

function openLibrary(): CloudLibrary {
  const lib = library.value;
  if (!lib) throw new Error('Open your cloud library first.');
  return lib;
}

/** Store `bytes` (a gzipped table file) as the custom table, replacing any. */
async function saveTable(bytes: Uint8Array<ArrayBuffer>, meta: Omit<CustomTableEntry, 'id' | 'size' | 'savedAt'>): Promise<CustomTableEntry> {
  const lib = openLibrary();
  try {
    const entry = await lib.saveTable(bytes, meta);
    state.customTable = entry;
    await cacheTable(lib.marker, entry, bytes);
    return entry;
  } catch (err) {
    throw new Error(cloudMessage(err));
  }
}

/** The custom table's file: this browser's copy when it's current, else downloaded (and kept). */
async function loadCustomTable(): Promise<Uint8Array<ArrayBuffer> | null> {
  const lib = openLibrary();
  const entry = lib.customTable;
  if (!entry) return null;
  const cached = await cachedTable(lib.marker, entry);
  if (cached) return cached;
  try {
    const bytes = await lib.loadTable();
    if (bytes) await cacheTable(lib.marker, entry, bytes);
    return bytes;
  } catch (err) {
    throw new Error(cloudMessage(err));
  }
}

async function deleteTable(): Promise<void> {
  const lib = openLibrary();
  try {
    await lib.deleteTable();
  } catch (err) {
    throw new Error(cloudMessage(err));
  }
  await forgetCachedTable(lib.marker);
  state.customTable = null;
}

async function shareTable(table: { name: string; bytes: Uint8Array } & SharedTableMeta, kind: ShareKind): Promise<ShareRecord> {
  const lib = openLibrary();
  try {
    const pageUrl = typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`;
    return await createTableShare(lib, table, kind, pageUrl);
  } catch (err) {
    throw new Error(cloudMessage(err));
  }
}

export function useCloudLibrary() {
  hookVisibility();
  return {
    state,
    library,
    api,
    isReady: computed(() => state.status === 'ready'),
    /**
     * This EID has a cloud library that isn't open yet (or we're still finding out): the library's plans stay
     * hidden until the PIN is entered, so nobody mistakes the browser's copies for a synced library. Not while
     * the cloud is unreachable: then the browser's copies show, so no one is locked out of their own plans.
     */
    libraryLocked: computed(() => state.status === 'checking' || state.status === 'locked' || (state.status === 'opening' && !library.value)),
    planState: (plan: LocalPlan): PlanCloudState | null => (state.status === 'ready' ? planState(plan, state.links) : null),
    connect,
    /** Try again after the cloud couldn't be reached. */
    retry: () => connect(state.eid, state.partitionHash),
    unlock,
    create,
    changePin,
    forget,
    deleteLibrary,
    notifyLocalChange: () => requestSync(),
    syncNow: runSync,
    share,
    saveTable,
    loadCustomTable,
    deleteTable,
    shareTable,
    listShares: () => (library.value ? listShares(library.value) : Promise.resolve([])),
    revokeShare: (id: string) => (library.value ? revokeShare(library.value, id) : Promise.resolve()),
    forgetUsedShares: () => (library.value ? forgetUsedShares(library.value) : Promise.resolve(0)),
  };
}
