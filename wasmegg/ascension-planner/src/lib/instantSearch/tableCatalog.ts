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
import { getArtifact } from '@/lib/artifacts';

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

/** The delivery artifacts a table is built for. The fourth slot can be any T4L (the Table Builder
 *  uses the totem), and every player at 120 TE has one, so it is not compared. */
export const DELIVERY_CORE_FAMILIES = ['quantum-metronome', 'interstellar-compass', 'gusset'];

/** A delivery set's metronome, compass and gusset, in that order: null for one it doesn't have. */
export function deliveryCore(ids: (string | null)[]): (string | null)[] {
  return DELIVERY_CORE_FAMILIES.map(family => ids.find(id => !!id && getArtifact(id)?.familyId === family) ?? null);
}

/** A delivery set as tables are compared by it: its metronome, compass and gusset, so slot order and
 *  the fourth slot do not matter. '' when it has none of them. */
export function deliveryCoreKey(ids: (string | null)[]): string {
  return deliveryCore(ids)
    .filter((id): id is string => !!id)
    .join(',');
}

/** A delivery table for a delivery set, and how close it is. */
export interface DeliveryMatch {
  entry: IndexEntry;
  /** The set has the table's metronome, compass and gusset. */
  exact: boolean;
  /** Where they differ: the set's artifact (null when it has none of that kind) and the table's. */
  differs: { mine: string | null; table: string }[];
}

/** An artifact's tier and rarity on one scale (T3L is next to T4C), to tell how far apart two are. */
function grade(id: string): number {
  const a = getArtifact(id);
  return a ? a.tier * 4 + a.rarity : 0;
}

/**
 * The table closest to this delivery set's metronome, compass and gusset, or null: an exact one,
 * else one with two of the three, the third the nearest tier and rarity to the set's; none with fewer
 * than `minMatched`. Delivery tables and a maxed one whose `delivery` is filled in from its header
 * (the catalog lists it without) are candidates. The store lists each delivery table twice — its built
 * name and `delivery-<key>.bin.gz` — so a named file is preferred for the label only; both are the
 * same bytes.
 */
export function findDeliveryTable(entries: IndexEntry[], ids: (string | null)[], minMatched = 2): DeliveryMatch | null {
  const mine = deliveryCore(ids);
  if (mine.every(id => !id)) return null;
  let best: { match: DeliveryMatch; matched: number; distance: number } | null = null;
  const candidates = [...deliveryTables(entries), ...entries.filter(e => e.kind === 'maxed' && e.delivery?.length)];
  for (const entry of candidates) {
    const theirs = deliveryCore(entry.delivery!);
    if (theirs.some(id => !id)) continue;
    const differs: DeliveryMatch['differs'] = [];
    let distance = 0;
    mine.forEach((id, i) => {
      if (id === theirs[i]) return;
      differs.push({ mine: id, table: theirs[i]! });
      distance += id ? Math.abs(grade(id) - grade(theirs[i]!)) : 100;
    });
    const matched = 3 - differs.length;
    if (matched < minMatched) continue;
    const better =
      !best ||
      matched > best.matched ||
      (matched === best.matched &&
        (distance < best.distance ||
          (distance === best.distance &&
            best.match.entry.name.startsWith('delivery-') &&
            !entry.name.startsWith('delivery-'))));
    if (better) best = { match: { entry, exact: matched === 3, differs }, matched, distance };
  }
  return best?.match ?? null;
}
