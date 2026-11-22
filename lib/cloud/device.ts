/**
 * "Remember this device": the unlocked library's keys (never the PIN) in IndexedDB, per EID, so the planners
 * reopen the cloud library without asking again. CryptoKeys are stored as-is (structured clone).
 *
 * Every wasmegg app is served from one origin, so remembering in one planner covers the others.
 */
import type { CustomTableEntry, RememberedLibrary } from './library';

const DB_NAME = 'wasmegg-cloud';
const STORE = 'remembered';
/** Local copies of custom Chain Finder tables, by library (marker id). */
const TABLES = 'tables';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'eid' });
      if (!request.result.objectStoreNames.contains(TABLES)) request.result.createObjectStore(TABLES, { keyPath: 'marker' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>, name = STORE): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(name, mode).objectStore(name));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function rememberDevice(remembered: RememberedLibrary): Promise<void> {
  await withStore('readwrite', store => store.put(remembered));
}

/** The remembered keys for this EID on this device, or null. */
export async function rememberedLibrary(eid: string): Promise<RememberedLibrary | null> {
  try {
    return ((await withStore('readonly', store => store.get(eid))) as RememberedLibrary | undefined) ?? null;
  } catch {
    return null; // private mode, blocked storage: just ask for the PIN
  }
}

export async function forgetDevice(eid: string): Promise<void> {
  await withStore('readwrite', store => store.delete(eid));
}

// ---- Local copy of the custom Chain Finder table -------------------------------------------------------

interface CachedTable {
  marker: string;
  id: string;
  savedAt: number;
  bytes: Uint8Array<ArrayBuffer>;
}

/** The local copy of this library's custom table, when it's the same save as `entry`; else null. */
export async function cachedTable(marker: string, entry: CustomTableEntry): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const hit = (await withStore('readonly', store => store.get(marker), TABLES)) as CachedTable | undefined;
    return hit && hit.id === entry.id && hit.savedAt === entry.savedAt ? hit.bytes : null;
  } catch {
    return null;
  }
}

export async function cacheTable(marker: string, entry: CustomTableEntry, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  try {
    await withStore('readwrite', store => store.put({ marker, id: entry.id, savedAt: entry.savedAt, bytes } satisfies CachedTable), TABLES);
  } catch {
    // no local copy: it's downloaded again next time
  }
}

export async function forgetCachedTable(marker: string): Promise<void> {
  try {
    await withStore('readwrite', store => store.delete(marker), TABLES);
  } catch {
    // nothing to forget
  }
}
