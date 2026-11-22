/**
 * Share links. The sender's browser encrypts one plan with a fresh random key and uploads it; the link carries
 * the share id and the key after `#` (`#share=<id>.<key>`), so neither the site's host nor the worker ever sees
 * the key, and the worker can't read the plan.
 *
 * A share must never lead back to its sender's EID. The worker stores nothing linking it to a library; here,
 * the plan is scrubbed of player identifiers before it's encrypted (the planners' exports already redact them;
 * this is the backstop).
 */
import { CloudApi, type ShareKind } from './api';
import { fromBase64, generateMasterKey, open, openJson, seal, sealJson, toBase64 } from './crypto';
import type { CloudLibrary, CustomTableEntry, PlannerId, ShareContent, ShareRecord, StoredPlan } from './library';

/** A shared table's header facts, as its link's title carries them. */
export type SharedTableMeta = Pick<CustomTableEntry, 'from' | 'to' | 'delivery' | 'silo'>;

/**
 * A link's title, encrypted with the link key: what it holds, so a preview can route it (the plan library, or
 * the Chain Finder) before a one-time link is used. Links made before tables were shareable have a bare string
 * (the plan's name).
 */
type Title = { name: string; content: 'plan' } | ({ name: string; content: 'table' } & SharedTableMeta);

const LINK_PARAM = 'share';
/** What replaces an EID found anywhere in a shared plan. */
const EID_PLACEHOLDER = 'EIxxxxxxxxxx';
/** Fields that identify a player, removed wherever they appear in a shared plan. */
const IDENTITY_KEYS = new Set([
  'eiUserId',
  'userId',
  'userName',
  'username',
  'gameServicesId',
  'gameServicesIdScoped',
  'pushUserId',
  'deviceId',
  'ei_user_id',
  'user_id',
  'user_name',
]);

/**
 * A deep copy of `value` with player identifiers removed: identity fields dropped, any EID-shaped string
 * replaced, and `playerId` / `nickname` set to the planners' own redacted values.
 */
export function scrubPlayer<T>(value: T, senderEid?: string): T {
  const eidPattern = /EI\d{16}/gi;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      let out = v.replace(eidPattern, EID_PLACEHOLDER);
      if (senderEid) out = out.split(senderEid).join(EID_PLACEHOLDER);
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v)) {
        if (IDENTITY_KEYS.has(k)) continue;
        if (k === 'playerId') out[k] = EID_PLACEHOLDER;
        else if (k === 'nickname') out[k] = 'Redacted';
        else out[k] = walk(child);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** The share id and key in a link (or a bare `#share=…` fragment), or null if it has none. */
export function parseShareLink(linkOrHash: string): { id: string; key: string } | null {
  const hash = linkOrHash.includes('#') ? linkOrHash.slice(linkOrHash.indexOf('#') + 1) : linkOrHash;
  const value = new URLSearchParams(hash).get(LINK_PARAM);
  const match = value && /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(value);
  return match ? { id: match[1]!, key: match[2]! } : null;
}

/** `pageUrl` with the share in its fragment (any existing fragment is replaced). */
export function shareLink(pageUrl: string, id: string, key: string): string {
  return `${pageUrl.split('#')[0]}#${LINK_PARAM}=${id}.${key}`;
}

async function importLinkKey(key: string): Promise<CryptoKey> {
  const raw = fromBase64(key.replace(/-/g, '+').replace(/_/g, '/') + '=');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function exportLinkKey(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return toBase64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Create a share link for one plan and record it in the library's index. `pageUrl` is the page the link opens
 * (the planner). The library's EID is scrubbed from the plan before it leaves the browser.
 */
export async function createShare<T>(
  library: CloudLibrary,
  plan: { planner: PlannerId; name: string; timestamp: number; data: T },
  kind: ShareKind,
  pageUrl: string
): Promise<ShareRecord> {
  const key = await generateMasterKey();
  const stored: StoredPlan<T> = { v: 1, planner: plan.planner, name: plan.name, timestamp: plan.timestamp, data: scrubPlayer(plan.data, library.eid) };
  const body = await sealJson(key, stored);
  return uploadShare(library, key, body, { name: plan.name, content: 'plan' }, plan.planner, kind, pageUrl);
}

/**
 * Create a share link for a Chain Finder table (`table` = the gzipped table file) and record it in the index.
 * A table holds no player identifiers (it's built for gear, not an account), so nothing is scrubbed.
 */
export async function createTableShare(
  library: CloudLibrary,
  table: { name: string; bytes: Uint8Array } & SharedTableMeta,
  kind: ShareKind,
  pageUrl: string
): Promise<ShareRecord> {
  const key = await generateMasterKey();
  const body = await seal(key, table.bytes, false);
  const title: Title = { name: table.name, content: 'table', from: table.from, to: table.to, delivery: [...table.delivery], silo: table.silo };
  return uploadShare(library, key, body, title, 'ascension', kind, pageUrl);
}

async function uploadShare(
  library: CloudLibrary,
  key: CryptoKey,
  body: Uint8Array<ArrayBuffer>,
  title: Title,
  planner: PlannerId,
  kind: ShareKind,
  pageUrl: string
): Promise<ShareRecord> {
  const sealedTitle = toBase64(await sealJson(key, title));
  const created = await library.sessionForApi((api, session) => api.createShare(session, { kind, title: sealedTitle, body }));
  const record: ShareRecord = {
    id: created.id,
    revokeToken: created.revokeToken,
    kind,
    planner,
    name: title.name,
    created: Date.now(),
    expires: created.expires,
    link: shareLink(pageUrl, created.id, await exportLinkKey(key)),
    content: title.content,
  };
  await library.updateIndex(index => {
    index.shares = [...index.shares.filter(s => s.expires > Date.now()), record];
  });
  return record;
}

export interface ShareInfo {
  kind: ShareKind;
  name: string;
  expires: number;
  /** A plan, or a Chain Finder table (with its header facts). */
  content: ShareContent;
  table?: SharedTableMeta;
}

/** What a link holds, without using it up; null when it's gone. Needs no library. */
export async function previewShare(api: CloudApi, link: string): Promise<ShareInfo | null> {
  const parsed = parseShareLink(link);
  if (!parsed) return null;
  const preview = await api.previewShare(parsed.id);
  if (!preview) return null;
  const title = await openJson<Title | string>(await importLinkKey(parsed.key), fromBase64(preview.title));
  if (typeof title === 'string') return { kind: preview.kind, name: title, expires: preview.expires, content: 'plan' };
  const info: ShareInfo = { kind: preview.kind, name: title.name, expires: preview.expires, content: title.content };
  if (title.content === 'table') info.table = { from: title.from, to: title.to, delivery: title.delivery, silo: title.silo };
  return info;
}

/** Import a shared table: its gzipped file (a one-time link is used up); null when it's gone. Preview first. */
export async function claimTableShare(api: CloudApi, link: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const parsed = parseShareLink(link);
  if (!parsed) return null;
  const body = await api.claimShare(parsed.id);
  return body ? open(await importLinkKey(parsed.key), body) : null;
}

/** Import a shared plan (a one-time link is used up); null when it's gone. Needs no library. Preview first: a
 *  table link must go to claimTableShare. */
export async function claimShare<T = unknown>(api: CloudApi, link: string): Promise<StoredPlan<T> | null> {
  const parsed = parseShareLink(link);
  if (!parsed) return null;
  const body = await api.claimShare(parsed.id);
  return body ? openJson<StoredPlan<T>>(await importLinkKey(parsed.key), body) : null;
}

/** The library's shares, each with whether it can still be used. */
export async function listShares(library: CloudLibrary): Promise<(ShareRecord & { live: boolean })[]> {
  const api = await library.sessionForApi(async api => api);
  return Promise.all(
    library.index.shares.map(async s => ({ ...s, live: s.expires > Date.now() && (await api.previewShare(s.id)) !== null }))
  );
}

/** Revoke a share and drop it from the index. */
export async function revokeShare(library: CloudLibrary, id: string): Promise<void> {
  const record = library.index.shares.find(s => s.id === id);
  if (record) await library.sessionForApi(api => api.revokeShare(id, record.revokeToken));
  await library.updateIndex(index => {
    index.shares = index.shares.filter(s => s.id !== id);
  });
}

/** Drop records of shares that are used up or expired. */
export async function forgetUsedShares(library: CloudLibrary): Promise<number> {
  const shares = await listShares(library);
  const dead = new Set(shares.filter(s => !s.live).map(s => s.id));
  if (dead.size) await library.updateIndex(index => {
    index.shares = index.shares.filter(s => !dead.has(s.id));
  });
  return dead.size;
}
