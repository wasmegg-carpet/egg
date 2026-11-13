/**
 * The simulator changes a table may be missing, written by hand: a commit only belongs here when it
 * changes what a table's cells would hold, so UI commits never make a table look behind.
 */
import type { TableHeader } from './table';

export interface SimChange {
  /** Short hash, as `simVersion` stamps it (`git rev-parse --short=8 <commit>`). Also this entry's id
   *  in a table's `simChange` stamp: only compared as text, so it can be a pre-squash branch commit. */
  commit: string;
  /** When it was committed, with the time: `git log -1 --format=%cI <commit>`. */
  date: string;
  /** What changed, for someone deciding whether to trust a table. */
  note: string;
}

/** Oldest first: add new changes at the bottom. */
export const SIM_CHANGES: SimChange[] = [
  {
    commit: 'b694b2d0',
    date: '2026-11-01T20:35:29-06:00',
    note: 'Corrected a bug where vehicles cost too much. Mostly affected 200 TE and below.',
  },
  {
    commit: '4a9b110e',
    date: '2026-11-02T13:54:14-06:00',
    note: 'Delivery research that needs several levels to help now ranks by its real hr/%, and is only bought if all those levels fit before the sale ends.',
  },
  {
    commit: '799a6502',
    date: '2026-11-04T12:07:21-06:00',
    note: 'Buy Until Sale Ends and Auto now choose delivery research as a whole set, weighing delivery rate against a later start, and hr/% uses the price actually charged. Against the last table: about 0.24% less total time at +20 to +50 TE.',
  },
  {
    commit: 'c983b800',
    date: '2026-11-11T11:13:07-06:00',
    note: "Fixed Auto's Multi-Layering milestones buying earnings research by the wrong payback rule. Mostly affects around 200 TE: total times change by less than 0.25% either way.",
  },
];

/** The newest change in the code doing the building: what a new table's `simChange` stamp says. */
export const LATEST_SIM_CHANGE = SIM_CHANGES.at(-1)?.commit;

/** The older of two `simChange` stamps, or undefined when either can't be placed in the list. */
export function olderSimChange(
  a: string | undefined,
  b: string | undefined,
  changes: SimChange[] = SIM_CHANGES
): string | undefined {
  const i = changes.findIndex(c => c.commit === a);
  const j = changes.findIndex(c => c.commit === b);
  return i < 0 || j < 0 ? undefined : changes[Math.min(i, j)].commit;
}

/** The colleggtibles both halves of a composite table have, or undefined when either has no stamp. */
export function commonColleggtibles(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined
): Record<string, number> | undefined {
  if (!a || !b) return undefined;
  return Object.fromEntries(Object.entries(a).filter(([id, value]) => b[id] === value));
}

/**
 * The changes a table doesn't have, oldest first: those after its `simChange` stamp, which says
 * exactly what its code had whatever the merge history. A table from before the stamp goes by its
 * own commit when that is listed, otherwise by those committed after it was built.
 */
export function simChangesSince(
  header: Pick<TableHeader, 'simChange' | 'simVersion' | 'builtAt'>,
  changes: SimChange[] = SIM_CHANGES
): SimChange[] {
  const stamped = changes.findIndex(c => c.commit === header.simChange);
  if (stamped >= 0) return changes.slice(stamped + 1);
  const commit = header.simVersion?.replace(/-dirty$/, '');
  const own = changes.findIndex(c => c.commit === commit);
  if (own >= 0) return changes.slice(own + 1);
  const builtAt = Date.parse(header.builtAt);
  // No usable build time: nothing says the table has any of them.
  return Number.isNaN(builtAt) ? changes : changes.filter(c => Date.parse(c.date) > builtAt);
}
