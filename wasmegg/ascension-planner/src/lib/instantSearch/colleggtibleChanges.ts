/**
 * Colleggtibles a table wasn't built with. A table's cells assume every colleggtible at its top tier,
 * so a new or retuned egg in customeggs.json changes what they would hold. That file updates by itself
 * and says nothing about when, so a table records what it was built with and the page compares.
 */
import { colleggtibleDefs, type ColleggtibleDef } from 'lib/collegtibles';
import type { TableHeader } from './table';

/** Each colleggtible's top-tier multiplier, by egg id. */
export type TableColleggtibles = Record<string, number>;

/** What a table without a stamp was built with: customeggs.json from before Copper (28b2ee77). */
export const UNSTAMPED_COLLEGGTIBLES: TableColleggtibles = {
  'carbon-fiber': 1.05,
  chocolate: 3,
  easter: 1.05,
  firework: 1.05,
  'flame-retardant': 0.75,
  gatoregg: 1.05,
  ice: 0.95,
  lithium: 0.9,
  pegg: 1.05,
  pumpkin: 1.05,
  silicon: 1.05,
  waterballoon: 0.95,
  wood: 2,
};

export interface ColleggtibleChange {
  id: string;
  /** What changed, for someone deciding whether to trust a table. */
  note: string;
}

/** The colleggtibles a table built now has: its header's `colleggtibles` stamp. */
export function currentColleggtibles(defs: ColleggtibleDef[] = colleggtibleDefs): TableColleggtibles {
  return Object.fromEntries(defs.map(d => [d.id, d.tierValues[3]]));
}

const percent = (multiplier: number) =>
  `${multiplier < 1 ? '-' : '+'}${Math.round(Math.abs(multiplier - 1) * 1000) / 10}%`;

/** The game's names are in capitals. */
const displayName = (name: string) => name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

/** How this page's colleggtibles differ from those the table was built with. */
export function colleggtibleChanges(
  header: Pick<TableHeader, 'colleggtibles'>,
  defs: ColleggtibleDef[] = colleggtibleDefs
): ColleggtibleChange[] {
  const built = header.colleggtibles ?? UNSTAMPED_COLLEGGTIBLES;
  const changes: ColleggtibleChange[] = [];
  for (const d of defs) {
    const name = displayName(d.name);
    const now = d.tierValues[3];
    const then = built[d.id];
    if (then === undefined)
      changes.push({ id: d.id, note: `New colleggtible: ${name} (${d.effect} ${percent(now)} at max). This table doesn't include it.` });
    else if (then !== now)
      changes.push({ id: d.id, note: `Colleggtible changed: ${name} (${d.effect} at max, ${percent(then)} is now ${percent(now)}).` });
  }
  const current = new Set(defs.map(d => d.id));
  for (const id of Object.keys(built))
    if (!current.has(id)) changes.push({ id, note: `Colleggtible removed: ${id}. This table still includes it.` });
  return changes;
}
