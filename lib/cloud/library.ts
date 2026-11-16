/**
 * One player's cloud library, unlocked. Wraps the worker API and the crypto into the operations the planners
 * need: create / unlock / resume, the encrypted index (the main file), plans, PIN change, delete.
 *
 * The index is the only list of the library's plans. Every change to it is a read-modify-write against the
 * main file's etag; on a conflict (another device saved first) it re-reads and reapplies the change.
 *
 * The session token is renewed by unlocking again with the remembered main id, before it expires or when the
 * worker says it has.
 */
import { CloudApi, CloudError, type Session } from './api';
import {
  decodeMainFile,
  derivePinKeys as deriveRaw,
  encodeMainFile,
  generateMasterKey,
  markerId,
  newSettings,
  normalizeEid,
  openJson,
  openMainFile,
  PinFormatError,
  reencodeMainFile,
  sealJson,
  type LibrarySettings,
  type PinKeys,
  type PinType,
} from './crypto';

/** derivePinKeys, with a PIN of the wrong shape reported as CloudError `pin_format`. */
async function derivePinKeys(eid: string, pin: string, settings: LibrarySettings): Promise<PinKeys> {
  try {
    return await deriveRaw(eid, pin, settings);
  } catch (err) {
    if (err instanceof PinFormatError) throw new CloudError('pin_format', err.message);
    throw err;
  }
}

/** Which app a plan belongs to; libraries are shared by all planners. */
export type PlannerId = 'ascension' | 'enlightenment' | (string & {});

export interface IndexEntry {
  /** The worker's id for the plan object. */
  id: string;
  planner: PlannerId;
  name: string;
  /** When the plan was last saved (ms), from the planner. */
  timestamp: number;
  /** Set when deleted: other devices drop their copy, then the entry is pruned. */
  deletedAt?: number;
}

/** A share link this library created (kept so the sender can see and revoke it; only in the encrypted index). */
export interface ShareRecord {
  id: string;
  revokeToken: string;
  kind: 'once' | 'multi';
  planner: PlannerId;
  name: string;
  created: number;
  expires: number;
  /** The link itself, so it can be copied again. */
  link: string;
}

export interface LibraryIndex {
  v: 1;
  plans: IndexEntry[];
  shares: ShareRecord[];
  prefs: Record<string, unknown>;
}

/** What a plan object holds, encrypted. */
export interface StoredPlan<T = unknown> {
  v: 1;
  planner: PlannerId;
  name: string;
  timestamp: number;
  /** The plan's id in the uploading device's local library; planners embed it in the plan data, so other
   *  devices reuse it when they can. */
  localId?: string;
  data: T;
}

/** A plan to store: `id` is the cloud object to replace (absent for a new one). */
export interface PlanToStore<T = unknown> {
  id?: string;
  planner: PlannerId;
  name: string;
  timestamp: number;
  localId?: string;
  data: T;
}

/** Everything a device keeps to reopen the library without the PIN (IndexedDB stores CryptoKeys as-is). */
export interface RememberedLibrary {
  eid: string;
  marker: string;
  mainId: string;
  master: CryptoKey;
  settings: LibrarySettings;
}

/** Deleted entries are kept this long so every device sees the deletion, then pruned. */
const TOMBSTONE_MS = 180 * 24 * 60 * 60 * 1000;
/** Renew the session when it has less than this left. */
const SESSION_MARGIN_S = 5 * 60;

export function emptyIndex(): LibraryIndex {
  return { v: 1, plans: [], shares: [], prefs: {} };
}

function requireEid(raw: string): string {
  const eid = normalizeEid(raw);
  if (!eid) throw new CloudError('invalid_eid', 'That isn’t an EID (EI followed by 16 digits).');
  return eid;
}

export class CloudLibrary {
  private constructor(
    private readonly api: CloudApi,
    readonly eid: string,
    readonly marker: string,
    private mainId: string,
    private master: CryptoKey,
    private wrappedKey: string,
    private _settings: LibrarySettings,
    private _index: LibraryIndex,
    private etag: string,
    private session: Session
  ) {}

  /** The library's settings when this EID has one, else null. */
  static async lookup(api: CloudApi, rawEid: string): Promise<LibrarySettings | null> {
    return api.getMarker(await markerId(requireEid(rawEid)));
  }

  /**
   * Create a library. `replace` throws away this EID's existing one (for a forgotten PIN): its plans become
   * unreachable. The UI must warn before passing it.
   */
  static async create(api: CloudApi, rawEid: string, pinType: PinType, pin: string, iterations?: number, replace = false): Promise<CloudLibrary> {
    const eid = requireEid(rawEid);
    const marker = await markerId(eid);
    const settings = newSettings(pinType, iterations);
    const { mainId, kek } = await derivePinKeys(eid, pin, settings);
    const master = await generateMasterKey();
    const index = emptyIndex();
    const body = await encodeMainFile(index, master, kek);
    const { etag, session } = await api.createLibrary({ eid, marker, main: mainId, settings, body, replace });
    const { wrappedKey } = await openMainFile<LibraryIndex>(body, master);
    return new CloudLibrary(api, eid, marker, mainId, master, wrappedKey, settings, index, etag, session);
  }

  /**
   * Open with the PIN. Throws CloudError `no_library`, `wrong_pin` (with `retryAfter` once the slow-down has
   * started) or `throttled`.
   */
  static async unlock(api: CloudApi, rawEid: string, pin: string): Promise<CloudLibrary> {
    const eid = requireEid(rawEid);
    const marker = await markerId(eid);
    const settings = await api.getMarker(marker);
    if (!settings) throw new CloudError('no_library', 'There’s no cloud library for this EID yet.');
    const { mainId, kek } = await derivePinKeys(eid, pin, settings);
    const opened = await api.unlock(marker, mainId);
    const { master, index } = await decodeMainFile<LibraryIndex>(opened.body, kek);
    const { wrappedKey } = await openMainFile<LibraryIndex>(opened.body, master);
    return new CloudLibrary(api, eid, marker, mainId, master, wrappedKey, settings, index, opened.etag, opened.session);
  }

  /**
   * Reopen on a remembered device, without the PIN. Throws CloudError `wrong_pin` when the PIN was changed on
   * another device (forget the remembered keys and ask for the PIN), or `no_library` when it was deleted.
   */
  static async resume(api: CloudApi, remembered: RememberedLibrary): Promise<CloudLibrary> {
    const opened = await api.unlock(remembered.marker, remembered.mainId);
    const { index, wrappedKey } = await openMainFile<LibraryIndex>(opened.body, remembered.master);
    return new CloudLibrary(
      api,
      remembered.eid,
      remembered.marker,
      remembered.mainId,
      remembered.master,
      wrappedKey,
      remembered.settings,
      index,
      opened.etag,
      opened.session
    );
  }

  get settings(): LibrarySettings {
    return this._settings;
  }

  /** The decrypted index as last read or written. */
  get index(): LibraryIndex {
    return this._index;
  }

  /** Live (not deleted) plans, optionally for one planner. */
  plans(planner?: PlannerId): IndexEntry[] {
    return this._index.plans.filter(p => !p.deletedAt && (!planner || p.planner === planner));
  }

  remember(): RememberedLibrary {
    return { eid: this.eid, marker: this.marker, mainId: this.mainId, master: this.master, settings: this._settings };
  }

  // ---- Sessions and the index ---------------------------------------------------------------------------

  /** Re-read the main file. Uses the session when it's live (cheap), else unlocks again (renewing it). */
  async refresh(): Promise<void> {
    if (this.sessionLive()) {
      try {
        const read = await this.api.getMain(this.session, this.marker, this.mainId);
        await this.adopt(read.body, read.etag);
        return;
      } catch (err) {
        if (!(err instanceof CloudError && err.code === 'unauthorized')) throw err;
      }
    }
    await this.reunlock();
  }

  /** Unlock again with the remembered main id: a fresh session and the latest main file. */
  private async reunlock(): Promise<void> {
    const opened = await this.api.unlock(this.marker, this.mainId);
    await this.adopt(opened.body, opened.etag);
    this.session = opened.session;
  }

  private async adopt(body: Uint8Array, etag: string): Promise<void> {
    const { index, wrappedKey } = await openMainFile<LibraryIndex>(body, this.master);
    this._index = index;
    this.wrappedKey = wrappedKey;
    this.etag = etag;
  }

  private sessionLive(): boolean {
    return this.session.expires - Date.now() / 1000 >= SESSION_MARGIN_S;
  }

  /** Run `call` with a live session, renewing it first if it's about to expire, and once more on a 401. */
  private async withSession<T>(call: (session: Session) => Promise<T>): Promise<T> {
    if (!this.sessionLive()) await this.reunlock();
    try {
      return await call(this.session);
    } catch (err) {
      if (!(err instanceof CloudError && err.code === 'unauthorized')) throw err;
      await this.reunlock();
      return call(this.session);
    }
  }

  /**
   * Change the index: `change` edits a copy and the result is saved. On a conflict the main file is re-read
   * and `change` runs again on the newer index, so it must be safe to repeat.
   */
  async updateIndex(change: (index: LibraryIndex) => void): Promise<LibraryIndex> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const next = structuredClone(this._index);
      change(next);
      pruneTombstones(next);
      const body = await reencodeMainFile(next, this.master, this.wrappedKey);
      try {
        this.etag = await this.withSession(s => this.api.putMain(s, this.marker, this.mainId, this.etag, body));
        this._index = next;
        return next;
      } catch (err) {
        if (!(err instanceof CloudError && err.code === 'conflict')) throw err;
        await this.refresh();
      }
    }
    throw new CloudError('busy', 'The cloud library kept changing while saving; try again.');
  }

  // ---- Plans --------------------------------------------------------------------------------------------

  /**
   * Store a plan's object without touching the index: a new object when `id` is absent (or gone), else a
   * replacement. Returns the object's id. Callers that change many plans store them all, then update the
   * index once (see sync.ts); savePlan does both for one.
   */
  async storePlan<T>(plan: PlanToStore<T>): Promise<string> {
    const stored: StoredPlan<T> = { v: 1, planner: plan.planner, name: plan.name, timestamp: plan.timestamp, localId: plan.localId, data: plan.data };
    const body = await sealJson(this.master, stored);
    if (plan.id) {
      const id = plan.id;
      try {
        await this.withSession(s => this.api.putPlan(s, id, body));
        return id;
      } catch (err) {
        if (!(err instanceof CloudError && err.code === 'not_found')) throw err;
        // deleted elsewhere, or expired: store it afresh
      }
    }
    return (await this.withSession(s => this.api.createPlan(s, body))).id;
  }

  /** Delete a plan's object without touching the index (already gone is fine). */
  async removePlan(id: string): Promise<void> {
    await this.withSession(s => this.api.deletePlan(s, id));
  }

  /** Save one plan and its index entry. Returns the plan's id (new if the old object was gone). */
  async savePlan<T>(plan: PlanToStore<T>): Promise<string> {
    const id = await this.storePlan(plan);
    await this.updateIndex(index => upsertEntry(index, { id, planner: plan.planner, name: plan.name, timestamp: plan.timestamp }, plan.id));
    return id;
  }

  /** A plan's contents, or null if the object is gone. */
  async loadPlan<T>(id: string): Promise<StoredPlan<T> | null> {
    const body = await this.api.getPlan(id);
    return body ? openJson<StoredPlan<T>>(this.master, body) : null;
  }

  /** Delete everywhere: the object, and a tombstone in the index so other devices drop their copy. */
  async deletePlan(id: string): Promise<void> {
    await this.removePlan(id);
    const now = Date.now();
    await this.updateIndex(index => markDeleted(index, id, now));
  }

  /**
   * Keep everything alive (objects not written for 180 days are rewritten) and drop index entries whose
   * objects are gone. Call after unlocking; cheap when nothing is old.
   */
  async touch(): Promise<{ missing: string[] }> {
    const ids = this.plans().map(p => p.id);
    const { missing } = await this.withSession(s => this.api.touch(s, this.mainId, ids));
    if (missing.length) {
      const gone = new Set(missing);
      await this.updateIndex(index => {
        index.plans = index.plans.filter(p => !gone.has(p.id));
      });
    }
    return { missing };
  }

  // ---- Shares -------------------------------------------------------------------------------------------

  /** A live session, for modules that call the API on the library's behalf (share.ts). */
  async sessionForApi<T>(call: (api: CloudApi, session: Session) => Promise<T>): Promise<T> {
    return this.withSession(session => call(this.api, session));
  }

  // ---- The library itself -------------------------------------------------------------------------------

  /** Change the PIN (and maybe its type). Other remembered devices will need the new PIN. */
  async changePin(pinType: PinType, pin: string, iterations = this._settings.kdf.iterations): Promise<void> {
    const settings = newSettings(pinType, iterations);
    const { mainId, kek } = await derivePinKeys(this.eid, pin, settings);
    for (let attempt = 0; attempt < 3; attempt++) {
      const body = await encodeMainFile(this._index, this.master, kek);
      try {
        this.etag = await this.withSession(s => this.api.rekey(s, this.marker, this.mainId, this.etag, { main: mainId, settings, body }));
        this.mainId = mainId;
        this._settings = settings;
        this.wrappedKey = (await openMainFile<LibraryIndex>(body, this.master)).wrappedKey;
        return;
      } catch (err) {
        if (!(err instanceof CloudError && err.code === 'conflict')) throw err;
        await this.refresh();
      }
    }
    throw new CloudError('busy', 'The cloud library kept changing; try again.');
  }

  /** Delete every plan and the library. The EID can create a new one afterwards. */
  async deleteLibrary(): Promise<void> {
    for (const p of this._index.plans) if (!p.deletedAt) await this.withSession(s => this.api.deletePlan(s, p.id));
    await this.withSession(s => this.api.deleteLibrary(s, this.marker, this.mainId));
  }
}

/** Put `entry` in the index, replacing any entry for its id (or for `previousId`, when the object was re-created). */
export function upsertEntry(index: LibraryIndex, entry: IndexEntry, previousId?: string): void {
  index.plans = index.plans.filter(p => p.id !== entry.id && p.id !== previousId);
  index.plans.push(entry);
}

export function markDeleted(index: LibraryIndex, id: string, now = Date.now()): void {
  for (const p of index.plans) if (p.id === id) p.deletedAt = now;
}

function pruneTombstones(index: LibraryIndex, now = Date.now()): void {
  index.plans = index.plans.filter(p => !p.deletedAt || now - p.deletedAt < TOMBSTONE_MS);
}
