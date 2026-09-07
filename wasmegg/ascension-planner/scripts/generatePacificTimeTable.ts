/**
 * Regenerates `src/lib/pacificTimeTable.json` — the precomputed table of every Monday/Tuesday/
 * Friday/Saturday 9am Pacific Time occurrence (earnings-boost and research-sale start/end) between
 * 2015 and 2100, baked into the app bundle so `getNextPacificTime` (src/lib/events.ts) never has to
 * run the DST-aware `Intl.DateTimeFormat` computation at runtime for these 4 real keys — it just
 * loads this file and binary-searches it. That's a meaningful win on low-powered devices, where
 * even the ~85ms-per-key one-time computation (fast on a desktop) can be noticeably slower.
 *
 * WHEN TO REGENERATE: only if IANA's DST transition rules for America/Los_Angeles change (rare —
 * the US last changed its DST schedule in 2007). This table encodes today's rules for the whole
 * 2015-2100 span; if the rules ever change, this file goes stale for dates after the change and
 * needs regenerating using the JS runtime's UPDATED `Intl`/ICU timezone data (i.e. run this on a
 * system that's already received that update — check `node -p "Intl.DateTimeFormat().resolvedOptions().timeZone"`
 * or just a recent Node/browser version).
 *
 * HOW TO REGENERATE:
 *   cd wasmegg/ascension-planner
 *   pnpm generate:pacific-time-table
 *
 * That's it — this script does everything (computes the table via the exact same code path
 * `getNextPacificTime` uses live for any key not in this file, and overwrites the JSON). Commit the
 * resulting diff.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPacificTimeTable } from '../src/lib/events.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'src', 'lib', 'pacificTimeTable.json');

// The 4 keys the app actually queries: earnings-boost start/end (Mon/Tue 9am) and research-sale
// start/end (Fri/Sat 9am) — see getNextEarningsBoostStart/End and getNextSaleStart/End in events.ts.
const KEYS: Array<[day: number, hour: number, label: string]> = [
  [1, 9, 'earnings boost start (Monday 9am)'],
  [2, 9, 'earnings boost end (Tuesday 9am)'],
  [5, 9, 'research sale start (Friday 9am)'],
  [6, 9, 'research sale end (Saturday 9am)'],
];

const table: Record<string, number[]> = {};
for (const [day, hour, label] of KEYS) {
  const start = performance.now();
  const occurrences = buildPacificTimeTable(day, hour);
  const elapsed = performance.now() - start;
  table[`${day}:${hour}`] = occurrences;
  console.log(`${label}: ${occurrences.length} occurrences (${elapsed.toFixed(1)}ms)`);
}

writeFileSync(outPath, JSON.stringify(table));
console.log(`\nWrote ${outPath}`);
