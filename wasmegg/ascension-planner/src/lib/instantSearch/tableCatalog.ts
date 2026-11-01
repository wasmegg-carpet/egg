/**
 * The table store's catalog: the ap-table-store Cloudflare Worker's `GET /tables/index.json`, one
 * line per served file (their src/tableHeader.ts `IndexEntry`, their src/catalog.ts naming standard):
 *
 *   maxed.bin.gz / table.bin.gz       the maxed reference table
 *   acct-<24 hex>.bin.gz              one account's own table
 *   gear-<24 hex>.bin.gz              one gear stamp's table
 *   table-<built name>-te<from>-<to>  a delivery-combination table, named as built
 *   delivery-<8 hex>.bin.gz           the same table under its gear hash
 *
 * Every alias of a file is listed as its own entry (the worker registers them at upload), so a
 * client that knows only a name — an account's PBKDF2 name or a gear stamp's hash — can look it up
 * without downloading anything. The catalog is edge-cached for 5 minutes on the worker.
 */

/** The table store: the maxed table and every other table it serves. */
export const TABLE_STORE = 'https://ap-table-store.carpet.workers.dev';

/** The four kinds the catalog lists. */
export type TableKind = 'maxed' | 'account' | 'gear' | 'delivery';

/** One line of `GET /tables/index.json`, byte-compatible with the store's index (their
 *  src/tableHeader.ts). Field order is the store's; the entries are in the order tables were
 *  first uploaded. */
export interface IndexEntry {
  name: string;
  kind: TableKind;
  /** Length of the file as served (gzipped). */
  bytes: number;
  /** SHA-256 of the file as served (gzipped bytes), not of the unpacked table. */
  sha256: string;
  deliveryKey: string | null;
  delivery: string[] | null;
  from: number;
  to: number;
  simVersion: string | null;
  builtWith: string | null;
  doubleEarnings: boolean | null;
  builtAt: string | null;
}

export interface TableIndex {
  tables: IndexEntry[];
}

/** The URL a catalog table is fetched from: its served name without the `.gz` (tableFetch.ts
 *  `fetchTable` tries the `.gz` first, then the plain file). */
export function tableUrl(name: string): string {
  return `${TABLE_STORE}/tables/${name.replace(/\.gz$/, '')}`;
}

/** The catalog, or null when it could not be had (offline, or a web page in its place): the caller
 *  falls back to the maxed table's own URL. Revalidated, not taken from cache: tables are added and
 *  replaced while the site is up. */
export async function fetchCatalog(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)
): Promise<IndexEntry[] | null> {
  try {
    const res = await fetchFn(`${TABLE_STORE}/tables/index.json`, { cache: 'no-cache' });
    if (!res.ok || /text\/html/.test(res.headers.get('content-type') ?? '')) return null;
    const index = (await res.json()) as TableIndex;
    return Array.isArray(index.tables) ? index.tables : null;
  } catch {
    return null;
  }
}

/** The catalog's entry for a name (an alias's own entry matches it), or null when the store has no
 *  table under that name. */
export function findTable(entries: IndexEntry[], name: string): IndexEntry | null {
  return entries.find(e => e.name === name) ?? null;
}

/** The maxed table's entry, under either of its names (`maxed.bin.gz`, `table.bin.gz`), or null. */
export function maxedTable(entries: IndexEntry[]): IndexEntry | null {
  return findTable(entries, 'maxed.bin.gz') ?? findTable(entries, 'table.bin.gz');
}

/** The delivery-combination tables: built with a fixed delivery set (the Table Builder's model). */
export function deliveryTables(entries: IndexEntry[]): IndexEntry[] {
  return entries.filter(e => e.kind === 'delivery' && (e.delivery?.length ?? 0) === 4);
}

/** A set as the catalog compares one: sorted, so slot order and the file's own order do not matter. */
function setKey(ids: string[]): string {
  return [...ids].sort().join(',');
}

/**
 * The delivery table built for exactly this delivery set, or null. The store lists each one twice —
 * its built name and `delivery-<key>.bin.gz` — so a named file is preferred for the label only; both
 * are the same bytes.
 */
export function findDeliveryTable(entries: IndexEntry[], ids: string[]): IndexEntry | null {
  if (ids.length !== 4) return null;
  const want = setKey(ids);
  const matches = deliveryTables(entries).filter(e => setKey(e.delivery!) === want);
  return matches.find(e => !e.name.startsWith('delivery-')) ?? matches[0] ?? null;
}
