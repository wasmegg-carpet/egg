/**
 * "Remember this device": the unlocked library's keys (never the PIN) in IndexedDB, per EID, so the planners
 * reopen the cloud library without asking again. CryptoKeys are stored as-is (structured clone).
 *
 * Every wasmegg app is served from one origin, so remembering in one planner covers the others.
 */
import type { RememberedLibrary } from './library';

const DB_NAME = 'wasmegg-cloud';
const STORE = 'remembered';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'eid' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
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
