/**
 * AutoAutoAP's `table.bin` layout, written and read back. Shared by scripts/buildTable.ts `--pack`
 * and the Table Builder's in-browser build; Node-free.
 */
import { EGG_ORDER, WEEK_HOURS, type BuildParams } from './cell';

/** Numbers per build slot in table.bin: [sales + 8 if tier 13 (0 = empty), waitStart, saleEnd, peakELR, delivered x 5]. */
const FIELDS = 9;

export interface Cell {
  te: number;
  h: number;
  builds: BuildParams[];
}

/**
 * AutoAutoAP's table file (their src/search/precomputedTable.ts `packTable`, byte for byte): a
 * little-endian uint32 header length, the header as UTF-8 JSON, padding to 8 bytes, then float64s
 * for each start TE `from..to`, each of the 168 hours, `slots` builds. Start TEs with no cells are
 * left as empty slots.
 */
export function packTable(header: Record<string, unknown> & { from: number; to: number }, cells: Cell[]): Uint8Array<ArrayBuffer> {
  const slots = Math.max(1, ...cells.map(c => c.builds.length));
  const json = new TextEncoder().encode(JSON.stringify({ ...header, slots }));
  const start = Math.ceil((4 + json.length) / 8) * 8;
  const count = (header.to - header.from + 1) * WEEK_HOURS * slots * FIELDS;
  const bytes = new Uint8Array(start + count * 8);
  new DataView(bytes.buffer).setUint32(0, json.length, true);
  bytes.set(json, 4);
  const body = new Float64Array(bytes.buffer, start, count);
  for (const c of cells) {
    c.builds.forEach((b, i) => {
      const at = (((c.te - header.from) * WEEK_HOURS + c.h) * slots + i) * FIELDS;
      body[at] = b.sales + (b.tier13 ? 8 : 0);
      body[at + 1] = b.waitStart;
      body[at + 2] = b.saleEnd;
      body[at + 3] = b.peakELR;
      for (let e = 0; e < EGG_ORDER.length; e++) body[at + 4 + e] = b.delivered[e];
    });
  }
  return bytes;
}

/** A packed file's header and every cell in it, as `packTable` was given them (empty slots dropped). */
export function unpackTable(bytes: Uint8Array): { header: Record<string, unknown> & { from: number; to: number; slots: number }; cells: Cell[] } {
  if (bytes.byteLength < 4) throw new Error('that file is not a precomputed table');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = view.getUint32(0, true);
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + len)));
  } catch {
    throw new Error('that file is not a precomputed table');
  }
  if (!header || !Number.isInteger(header.from) || !Number.isInteger(header.to) || !Number.isInteger(header.slots))
    throw new Error('that file is not a precomputed table');
  const start = Math.ceil((4 + len) / 8) * 8;
  const expected = start + (header.to - header.from + 1) * WEEK_HOURS * header.slots * FIELDS * 8;
  if (bytes.byteLength !== expected) throw new Error(`the table is incomplete: ${bytes.byteLength} bytes, its header says ${expected}`);
  const body = new Float64Array(bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + bytes.byteLength));
  const cells: Cell[] = [];
  for (let te = header.from; te <= header.to; te++)
    for (let h = 0; h < WEEK_HOURS; h++) {
      const key = (te - header.from) * WEEK_HOURS + h;
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
      cells.push({ te, h, builds });
    }
  return { header, cells };
}

/** The packed file read back the way their `readTable` reads it: every cell must come back exact. */
export function checkPacked(bytes: Uint8Array, cells: Cell[]): void {
  const back = new Map(unpackTable(bytes).cells.map(c => [c.te * WEEK_HOURS + c.h, c.builds]));
  for (const c of cells)
    if (JSON.stringify(back.get(c.te * WEEK_HOURS + c.h)) !== JSON.stringify(c.builds))
      throw new Error(`cell TE ${c.te} hour ${c.h} did not read back`);
}
