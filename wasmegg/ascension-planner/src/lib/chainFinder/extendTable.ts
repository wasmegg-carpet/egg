/**
 * Extending a table instead of building it again: the cells of a table already built (the store's,
 * or a file the player has) are kept, and only the start TEs it lacks are simulated. A cell depends
 * only on its start TE and hour, so the joined table is the one a full build would make, as long as
 * both halves were simulated by the same simulator with the same gear: anything else is refused, and
 * the table has to be built again from scratch.
 */
import { REFERENCE_WEEK } from '@/buildTable/cell';
import { labels, tableGear } from '@/buildTable/header';
import { maxedContext } from '@/buildTable/maxedAccount';
import { unpackTable, type Cell } from '@/buildTable/pack';
import { cteBonusOf } from '@/buildTable/task';
import { colleggtibleChanges } from '@/lib/instantSearch/colleggtibleChanges';
import { simChangesSince } from '@/lib/instantSearch/simChanges';
import type { TableHeader } from '@/lib/instantSearch/table';
import { gunzipBytes } from 'lib/planners/utils/gzip';

/** A table to extend: where it came from, and everything in it. */
export interface BaseTable {
  /** The store's catalog name, or the file's name. */
  name: string;
  source: 'store' | 'file';
  header: TableHeader;
  cells: Cell[];
}

/** A table file's header and cells, gzipped or not. */
export async function readTableFile(bytes: ArrayBuffer): Promise<{ header: TableHeader; cells: Cell[] }> {
  const { header, cells } = unpackTable(new Uint8Array(await gunzipBytes(bytes)));
  return { header: header as unknown as TableHeader, cells };
}

/**
 * Why a table can't be extended into one built now for `deliveryIds` (and silo mode or not), one
 * sentence each; empty when it can.
 */
export function extendProblems(header: TableHeader, deliveryIds: string[], silo: boolean): string[] {
  const context = maxedContext(deliveryIds, silo);
  const gear = tableGear(context);
  const problems: string[] = [];
  if (header.version !== 1) problems.push(`It's table version ${header.version}, not 1.`);
  if (header.fake) problems.push('Some of its rows are filled in from others, not simulated.');
  if (header.deliveryKey !== gear.deliveryKey)
    problems.push(
      Array.isArray(header.delivery)
        ? `It's for ${labels(header.delivery)}, not the delivery artifacts picked here.`
        : "Its header doesn't say which delivery artifacts it was built for."
    );
  if (!!header.deferForEarnings !== silo)
    problems.push(silo ? 'It was built with silo mode off.' : 'It was built in silo mode.');
  if (header.doubleEarnings !== context.assumeDoubleEarnings) problems.push('It was built with 2x earnings off.');
  if (header.referenceWeek !== REFERENCE_WEEK) problems.push('It was simulated from a different reference week.');
  if (header.cteBonus !== cteBonusOf(context) || !sameList(header.earnings, gear.earnings))
    problems.push("Its earnings artifacts aren't the maxed set.");
  if (JSON.stringify(sorted(header.stones)) !== JSON.stringify(sorted(gear.stones)))
    problems.push("Its stones aren't the maxed pool.");
  const behind = simChangesSince(header).length + colleggtibleChanges(header).length;
  if (behind)
    problems.push(
      `The simulator has ${behind} change${behind === 1 ? '' : 's'} since it was built, so its cells would differ from new ones.`
    );
  return problems;
}

function sameList(a: unknown, b: string[]): boolean {
  return Array.isArray(a) && JSON.stringify(a.map(String).sort()) === JSON.stringify([...b].sort());
}

function sorted(o: unknown): [string, unknown][] {
  return o && typeof o === 'object' ? Object.entries(o).sort(([x], [y]) => x.localeCompare(y)) : [];
}

/**
 * The start TEs to simulate for a table covering `from..to`, given a base table's range (or none):
 * those the base lacks. The base's own TEs below `from` are kept, never thrown away.
 */
export function tesToBuild(from: number, to: number, base?: { from: number; to: number }): number[] {
  const lo = Math.min(from, base?.from ?? from);
  const tes: number[] = [];
  for (let te = lo; te <= to; te++) if (!base || te < base.from || te > base.to) tes.push(te);
  return tes;
}

/**
 * The start TEs a cancelled build's file can hold: one unbroken run of finished and kept ones, so a
 * later build extends it with no gap left inside (extendTable.ts treats `from..to` as complete). The
 * run around the kept table when there is one, else around the highest finished TE (builds run top
 * down). Null when it would add nothing the kept table doesn't already have.
 */
export function partialTEs(done: number[], kept: number[]): { from: number; to: number } | null {
  const have = new Set([...done, ...kept]);
  const finished = new Set(done);
  if (!finished.size) return null;
  const anchor = kept.length ? kept[0] : Math.max(...finished);
  let from = anchor;
  let to = anchor;
  while (have.has(from - 1)) from--;
  while (have.has(to + 1)) to++;
  for (let te = from; te <= to; te++) if (finished.has(te)) return { from, to };
  return null;
}
