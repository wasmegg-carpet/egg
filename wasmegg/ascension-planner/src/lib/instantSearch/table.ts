/**
 * Reads the `table.bin` that scripts/buildTable.ts --pack and the Table Builder write
 * (src/buildTable/pack.ts), as AutoAutoAP's `readTable` does (src/search/precomputedTable.ts there).
 *
 * LAYOUT. A little-endian uint32 header length, the header as UTF-8 JSON, padding to 8 bytes, then
 * float64s: for each start TE `from..to`, each of the 168 Pacific hours, `slots` builds of nine
 * numbers: [sales + 8 if tier 13 (0 = empty), waitStart, saleEnd, peakELR, delivered x 5].
 */
import { canonicalDelivered, EGG_ORDER, rebase, WEEK_HOURS, type BuildParams } from './precomputedLeg';
import type { BuildLookup } from './routeFinder';
import type { TableGear } from './tableGear';

const FIELDS = 9;

export interface TableHeader {
  version: 1;
  /** Unix second of the Monday 00:00 Pacific every cell was simulated from. */
  referenceWeek: number;
  cteBonus: number;
  deliveryScore: number;
  from: number;
  to: number;
  slots: number;
  builtAt: string;
  /** The simulator commit the cells came from (scripts/simVersion.ts). */
  simVersion?: string;
  /** Built in silo mode (the auto-planner's defer for earnings). Only silo tables have it now;
   *  older ones may say `false`. */
  deferForEarnings?: boolean;
  /** Whether cells assume the video doubler; absent in tables from before it (built with it off). */
  doubleEarnings?: boolean;
  /** The gear the cells were simulated with (src/buildTable/header.ts `tableGear`); absent in tables
   *  from before it. */
  earnings?: string[];
  delivery?: string[];
  /** 8 hex of the delivery set: the store's `delivery-<key>.bin.gz` alias names it. */
  deliveryKey?: string;
  /** The research a build waits with and the table's delivery set there (the builder's k3 record):
   *  a player's peak delivery rate is compared with the table's at that research. */
  k3?: {
    research?: Record<string, number>;
    delivery?: unknown[];
    /** The table's own peak delivery rate (eggs/s): a player's own build there, against this, is
     *  their delivery scale. */
    peak?: number;
  };
  /** An account's own table: the gear it was built on (tableGear.ts). The page uses it only for a
   *  save whose stamp matches. Absent on the maxed reference table. */
  gear?: TableGear;
  /** A gear table joined to the maxed one (compositeTable): the last start TE from the gear table. */
  gearTo?: number;
  /** The simulation settings the cells were built with. Absent on tables packed before 19 Oct 2026. */
  settings?: { assumeDoubleEarnings?: boolean; deferForEarnings?: boolean };
  /** What the simulator reads of the account it was built on, for a table with no gear stamp (the
   *  maxed one): the epic research it models and the colleggtible effects. */
  epicResearch?: Record<string, number>;
  colleggtibleEffects?: Record<string, number>;
  /** Rows below what was generated filled from the nearest real ones, for trying the page while the
   *  table is built. Never a real answer. */
  fake?: boolean;
  /** Who built it and with what: provenance, not a stamp. */
  builtWith?: string;
  stones?: Record<string, number>;
}

export interface Table {
  header: TableHeader;
  /** The builds for a start TE at a Pacific hour, or null outside the table. */
  lookup(te: number, hour: number): BuildParams[] | null;
}

/**
 * Decoded cells kept. A cell is ~1.3 KB decoded and a 120–489 table has 62,160 of them; the bytes stay
 * in the ArrayBuffer, and decoding again is cheap next to the route arithmetic.
 */
const DECODED_CELLS = 4096;

/** A `Map` capped at `max` entries, dropping the least recently used. */
class LruCache<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly max: number) {}
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K);
  }
}

export function readTable(buffer: ArrayBuffer): Table {
  const view = new DataView(buffer);
  const len = buffer.byteLength >= 4 ? view.getUint32(0, true) : 0;
  let header: TableHeader;
  try {
    if (!len || 4 + len > buffer.byteLength) throw new Error('bad length');
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, len))) as TableHeader;
  } catch {
    throw new Error('that file is not a precomputed table');
  }
  if (header.version !== 1) throw new Error(`precomputed table version ${header.version} is not supported`);
  const start = Math.ceil((4 + len) / 8) * 8;
  // A file cut short would read its missing cells as empty, and the finder would quietly route
  // around them.
  const expected = start + (header.to - header.from + 1) * WEEK_HOURS * header.slots * FIELDS * 8;
  if (!(header.slots > 0) || buffer.byteLength !== expected)
    throw new Error(`the precomputed table is incomplete (${buffer.byteLength} of ${expected} bytes)`);
  const body = new Float64Array(buffer, start);
  const cache = new LruCache<number, BuildParams[]>(DECODED_CELLS);
  return {
    header,
    lookup(te, hour) {
      if (te < header.from || te > header.to || hour < 0 || hour >= WEEK_HOURS) return null;
      const key = (te - header.from) * WEEK_HOURS + hour;
      const hit = cache.get(key);
      if (hit) return hit;
      const builds: BuildParams[] = [];
      for (let i = 0; i < header.slots; i++) {
        const at = (key * header.slots + i) * FIELDS;
        const flags = body[at];
        if (!flags) continue;
        builds.push({
          sales: flags % 8,
          tier13: flags >= 8,
          waitStart: body[at + 1],
          saleEnd: body[at + 2],
          peakELR: body[at + 3],
          delivered: Array.from(body.subarray(at + 4, at + 4 + EGG_ORDER.length)),
        });
      }
      cache.set(key, builds);
      return builds;
    },
  };
}

/**
 * The table as read for a player whose earnings artifacts are `shift` Clothed TE below the table's: TE `te`
 * reads the row at `te - shift`, rounded down so a route never promises more than the artifacts earn.
 * Each build is restated from `te`'s canonical counts, the eggs it delivers itself carried over (they
 * come from earnings, not from the TE it started at), so `rebase`, the stops and every TE shown stay
 * the player's real TE. `shift` 0 is the table itself.
 */
export function shiftedLookup(table: Table, shift: number): BuildLookup {
  if (!(shift > 0)) return table.lookup;
  const cache = new LruCache<number, BuildParams[] | null>(DECODED_CELLS);
  const lookup: BuildLookup = (te, hour) => {
    const key = te * WEEK_HOURS + hour;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const row = Math.floor(te - shift);
    const raw = table.lookup(row, hour);
    const builds = raw && raw.map(b => rebase(b, row, canonicalDelivered(te)));
    cache.set(key, builds);
    return builds;
  };
  lookup.shift = shift;
  return lookup;
}

/**
 * A gear table below a start TE and the maxed table from it, as one table (ported from AutoAutoAP's
 * src/search/precomputedTable.ts): a board gear combination's table covers the TEs where gear shows,
 * below GEAR_TABLE_TO; from there the maxed table at the player's delivery rate is exact.
 */
export function compositeTable(low: Table, high: Table, split: number, scale: number): Table {
  const scaled = new LruCache<number, BuildParams[]>(DECODED_CELLS);
  const top = Math.max(split - 1, low.header.to);
  return {
    header: {
      ...low.header,
      to: Math.max(high.header.to, low.header.to),
      k3: high.header.k3,
      gearTo: top,
      // The older half's: what the simulator changed since then may be missing from part of the answer.
      builtAt: Date.parse(high.header.builtAt) < Date.parse(low.header.builtAt) ? high.header.builtAt : low.header.builtAt,
      simVersion:
        low.header.simVersion && low.header.simVersion === high.header.simVersion ? low.header.simVersion : undefined,
    },
    lookup(te, hour) {
      if (te <= top) return low.lookup(te, hour);
      const raw = high.lookup(te, hour);
      if (!raw || scale === 1) return raw;
      const key = te * WEEK_HOURS + hour;
      let hit = scaled.get(key);
      if (!hit) {
        hit = raw.map(b => ({ ...b, peakELR: b.peakELR * scale }));
        scaled.set(key, hit);
      }
      return hit;
    },
  };
}
