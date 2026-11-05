/**
 * @module StorageDB
 * @description Native IndexedDB wrapper for Enlightenment Planner.
 * Supports partitioned storage using SHA-256 hashes of Player IDs.
 */

const DB_NAME = 'EnlightenmentPlannerDB';
const DB_VERSION = 1;

export interface PlanData {
    id: string;
    name: string;
    timestamp: number;
    data: unknown; // Full exported plan data
}

/**
 * Hash a string using SHA-256.
 */
export async function hashID(id: string): Promise<string> {
    if (!id) return 'anonymous';
    const msgUint8 = new TextEncoder().encode(id.toLowerCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains('plans')) {
                db.createObjectStore('plans', { keyPath: 'storageKey' });
            }
            if (!db.objectStoreNames.contains('metadata')) {
                db.createObjectStore('metadata', { keyPath: 'key' });
            }
        };
    });
}

/**
 * Save a plan to the library.
 * storageKey = hash(EID) + "_" + UUID
 */
export async function savePlanToLibrary(partitionHash: string, plan: PlanData): Promise<void> {
    const db = await openDB();
    const tx = db.transaction('plans', 'readwrite');
    const store = tx.objectStore('plans');

    const storageKey = `${partitionHash}_${plan.id}`;
    // Sanitize data through JSON round-trip to avoid DataCloneError with complex Vue Proxies
    const sanitizedPlan = JSON.parse(JSON.stringify(plan));

    await new Promise<void>((resolve, reject) => {
        const request = store.put({ ...sanitizedPlan, storageKey, partitionHash });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Load all plans for a specific partition.
 */
export async function loadLibraryPlans(partitionHash: string): Promise<PlanData[]> {
    const db = await openDB();
    const tx = db.transaction('plans', 'readonly');
    const store = tx.objectStore('plans');

    return new Promise((resolve, reject) => {
        const plans: PlanData[] = [];
        const request = store.openCursor();

        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
                if (cursor.value.partitionHash === partitionHash) {
                    plans.push(cursor.value);
                }
                cursor.continue();
            } else {
                resolve(plans.sort((a, b) => b.timestamp - a.timestamp));
            }
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Delete a plan from the library.
 */
export async function deletePlanFromLibrary(partitionHash: string, planId: string): Promise<void> {
    const db = await openDB();
    const tx = db.transaction('plans', 'readwrite');
    const store = tx.objectStore('plans');
    const storageKey = `${partitionHash}_${planId}`;

    await new Promise<void>((resolve, reject) => {
        const request = store.delete(storageKey);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Save metadata (Active Draft, currentPlanId, etc.) for a partition.
 */
export async function saveMetadata(partitionHash: string, key: string, value: unknown): Promise<void> {
    const db = await openDB();
    const tx = db.transaction('metadata', 'readwrite');
    const store = tx.objectStore('metadata');

    const storageKey = `${partitionHash}_${key}`;
    // Sanitize data through JSON round-trip to avoid DataCloneError with complex Vue Proxies
    const sanitizedValue = JSON.parse(JSON.stringify(value));

    await new Promise<void>((resolve, reject) => {
        const request = store.put({ key: storageKey, partitionHash, value: sanitizedValue });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Load metadata for a partition.
 */
export async function loadMetadata<T>(partitionHash: string, key: string): Promise<T | null> {
    const db = await openDB();
    const tx = db.transaction('metadata', 'readonly');
    const store = tx.objectStore('metadata');

    const storageKey = `${partitionHash}_${key}`;
    return new Promise((resolve, reject) => {
        const request = store.get(storageKey);
        request.onsuccess = () => resolve(request.result?.value ?? null);
        request.onerror = () => reject(request.error);
    });
}
