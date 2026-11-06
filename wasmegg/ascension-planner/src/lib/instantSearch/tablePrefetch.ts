/**
 * The Chain Finder's tables fetched in the background, ported from AutoAutoAP (their
 * src/search/tablePrefetch.ts) and adapted to the table store's catalog: once a save is loaded and
 * the page is idle, the files this player's Chain Finder will read, so the answer is ready when they
 * open the tab. Only the files that player will use, in the order the store loads them, one at a
 * time and at low priority, gzipped: the browser's HTTP cache keeps them, and the store's own fetch
 * then revalidates instead of downloading again. Never on a phone, a small machine, a saved-data
 * connection or a 2G one; never an error: a file that fails is simply fetched when the tab opens.
 *
 * AutoAutoAP also prefetches the nearest tables above and below the player's gear (their
 * `prefetchPlan`'s bracket); the store's catalog carries no gear numbers (bonus, delivery k) to
 * bracket by, so the plan here is the own table, the gear table, and the maxed one.
 */
import type { IndexEntry } from './tableCatalog';

/** The files to fetch for a player, in order: their own table if the store has one; else the table
 *  of their gear and the maxed one; else the maxed one. */
export function prefetchPlan(o: {
  entries: IndexEntry[];
  /** The player's own table's catalog name (tableGear.ts `tableName`, with its `.gz`), and their
   *  gear's: the names to try, in the order the store tries them (`gearTableNames`). */
  own: string | null;
  gear: string | string[] | null;
  /** The start TE the Chain Finder would search from: a table that starts above it is no use. */
  te: number;
}): string[] {
  const usable = o.entries.filter(e => e.from <= o.te);
  const has = (f: string | null) => !!f && usable.some(e => e.name === f);
  if (has(o.own)) return [o.own!];
  const gear = (Array.isArray(o.gear) ? o.gear : o.gear ? [o.gear] : []).find(f => usable.some(e => e.name === f));
  if (gear) return [gear, 'maxed.bin.gz'];
  return ['maxed.bin.gz'];
}

type Nav = Partial<Navigator> & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

/** Whether this device and connection should fetch ahead at all. */
export function prefetchAllowed(nav: Nav = globalThis.navigator ?? {}): boolean {
  const c = nav.connection;
  if (c?.saveData) return false;
  if (c?.effectiveType && /(^|-)2g$/.test(c.effectiveType)) return false;
  return !isSmallDevice(nav);
}

/** A phone or a small machine: the files are a few MB each and the answer is wanted now, not later. */
function isSmallDevice(nav: Nav): boolean {
  if (/iPhone|iPod|Android.*Mobile/i.test(nav.userAgent ?? '')) return true;
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
}

/**
 * Each file's .gz, one after another, at low priority into the HTTP cache; the bytes are read and
 *  dropped (the store reads them from the cache). Failures are ignored.
 */
export async function prefetchFiles(
  base: string,
  files: string[],
  fetchFn: (url: string, init: RequestInit & { priority?: string }) => Promise<Response> = (u, i) => fetch(u, i)
): Promise<string[]> {
  const fetched: string[] = [];
  for (const f of files) {
    try {
      const res = await fetchFn(`${base}${f}`, { priority: 'low' });
      if (!res.ok || /text\/html/.test(res.headers.get('content-type') ?? '')) continue;
      const reader = res.body?.getReader();
      if (reader) while (!(await reader.read()).done);
      fetched.push(f);
    } catch {
      // The store fetches it when the tab opens.
    }
  }
  return fetched;
}

/** Whether the Chain Finder has a table of this player's own: 'own' (built from their account),
 *  'gear' (built on a board account with exactly their gear), or 'none' (the maxed one). */
export type GearCoverage = 'own' | 'gear' | 'none';
export function gearCoverage(entries: IndexEntry[], own: string | null, gear: string[]): GearCoverage {
  if (own && entries.some(e => e.name === own)) return 'own';
  if (gear.some(f => entries.some(e => e.name === f))) return 'gear';
  return 'none';
}
