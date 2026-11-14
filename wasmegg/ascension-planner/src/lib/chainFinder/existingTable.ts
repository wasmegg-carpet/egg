/**
 * Whether the table store already has a table for the Table Builder's picks, and what the simulator
 * and colleggtibles changed since it was built: what decides if building one is worth the hours.
 *
 * The catalog lists each table's delivery set but not its `simChange` or `colleggtibles` stamps,
 * nor whether it was built in silo mode, so each candidate's header is read (tableFetch.ts
 * `fetchTableHeader`, a few KB each).
 */
import { deliveryKey } from '@/buildTable/header';
import { colleggtibleChanges, type ColleggtibleChange } from '@/lib/instantSearch/colleggtibleChanges';
import { simChangesSince, type SimChange } from '@/lib/instantSearch/simChanges';
import type { TableHeader } from '@/lib/instantSearch/table';
import type { IndexEntry } from '@/lib/instantSearch/tableCatalog';
import {
  CHAIN_FINDER_DELIVERY_FAMILIES,
  deliveryOptions,
  type ChainFinderDeliverySelection,
} from './deliveryArtifacts';

/** The store's delivery tables (and the maxed one), one entry per file: the store lists each
 *  delivery table under its built name and `delivery-<key>.bin.gz`, and the maxed one as `maxed` and
 *  `table`; the first name is kept, a built name over an alias. */
export function storeDeliveryTables(entries: IndexEntry[]): IndexEntry[] {
  const byFile = new Map<string, IndexEntry>();
  for (const e of entries) {
    if (e.kind !== 'delivery' && e.kind !== 'maxed') continue;
    if (!e.deliveryKey) continue;
    const kept = byFile.get(e.sha256);
    if (!kept || (kept.name.startsWith('delivery-') && !e.name.startsWith('delivery-'))) byFile.set(e.sha256, e);
  }
  return [...byFile.values()];
}

/** The catalog entries built for exactly this delivery set (all four artifacts), one per file. */
export function tablesForDelivery(entries: IndexEntry[], deliveryIds: string[]): IndexEntry[] {
  const key = deliveryKey(deliveryIds);
  return storeDeliveryTables(entries).filter(e => e.deliveryKey === key);
}

/** A catalog entry and the header read from its file. */
export interface ReadTable {
  entry: IndexEntry;
  header: TableHeader;
}

export interface ExistingTable {
  entry: IndexEntry;
  header: TableHeader;
  simChanges: SimChange[];
  colleggtibleChanges: ColleggtibleChange[];
}

/** A table as the Table Builder would compare it: what it lacks since it was built. */
export function existingTable(entry: IndexEntry, header: TableHeader): ExistingTable {
  return { entry, header, simChanges: simChangesSince(header), colleggtibleChanges: colleggtibleChanges(header) };
}

/**
 * The newest of the tables read for this delivery set that match the silo setting, or null. Headers
 * that say nothing about silo mode were built without it.
 */
export function pickExistingTable(
  read: ReadTable[],
  silo: boolean
): ExistingTable | null {
  const time = (h: TableHeader) => {
    const t = Date.parse(h.builtAt);
    return Number.isNaN(t) ? -Infinity : t;
  };
  const best = read
    .filter(r => !!r.header.deferForEarnings === silo)
    .sort((a, b) => time(b.header) - time(a.header))[0];
  return best ? existingTable(best.entry, best.header) : null;
}

/** The store's newest table for exactly this delivery set and silo setting, or null. */
export function existingFor(read: ReadTable[], deliveryIds: string[], silo: boolean): ExistingTable | null {
  const key = deliveryKey(deliveryIds);
  return pickExistingTable(
    read.filter(r => r.entry.deliveryKey === key),
    silo
  );
}

/** How far a table is behind a build now: simulator changes and colleggtible changes together. */
export function changesBehind(table: ExistingTable): number {
  return table.simChanges.length + table.colleggtibleChanges.length;
}

/** Every pick the Table Builder offers, best first: metronome, then compass, then gusset. */
export function allDeliverySelections(): ChainFinderDeliverySelection[] {
  let out: Partial<ChainFinderDeliverySelection>[] = [{}];
  for (const family of CHAIN_FINDER_DELIVERY_FAMILIES)
    out = out.flatMap(s => deliveryOptions(family).map(o => ({ ...s, [family]: o.id })));
  return out as ChainFinderDeliverySelection[];
}
