/**
 * When one cell's C1..R1 prefix can stand in for another hour's.
 *
 * The prefix is the same at two start hours (same start TE) when it starts under the same event
 * flags (research sale, earnings boost) and no sale or boost starts or ends while it runs: every
 * shift then sees the same flags at every instant. Three seeds cover the week:
 *   - Tuesday 9:00 Pacific, the end of the boost: neither event active (the default build);
 *   - Friday 9:00, the start of the sale: sale active;
 *   - Monday 9:00, the start of the boost: boost active.
 * Every other hour reuses its class's seed when [start, start + seed's prefix seconds +
 * LOOKAHEAD_SECONDS] crosses no boundary, and is built fresh otherwise.
 *
 * The research ranking in C1/C2 also looks further ahead (ROI deadlines at the next sale start,
 * future boost dates), so this is a measured rule, not a proof: scripts/buildTable.ts --verify
 * builds every reused hour fresh as well and reports any difference.
 */
import {
  BOUNDARY_EPSILON_SECONDS,
  getNextEarningsBoostEnd,
  getNextEarningsBoostStart,
  getNextSaleEnd,
  getNextSaleStart,
  isEarningsBoostActive,
  isResearchSaleActive,
} from 'lib/planners/events';
import { REFERENCE_WEEK, WEEK_HOURS } from './cell';

export type EventClass = 'none' | 'sale' | 'boost';

/** Seed hour per class, as hours of the reference week (0 = Monday 00:00 Pacific). */
export const SEED_HOURS: Record<EventClass, number> = {
  none: 24 + 9, // Tuesday 9:00
  sale: 4 * 24 + 9, // Friday 9:00
  boost: 9, // Monday 9:00
};

export function hourStart(h: number): number {
  return REFERENCE_WEEK + h * 3600;
}

export function eventClassAt(t: number): EventClass {
  const sale = isResearchSaleActive(t);
  const boost = isEarningsBoostActive(t);
  if (sale && boost) throw new Error(`sale and boost both active at ${t}`);
  return sale ? 'sale' : boost ? 'boost' : 'none';
}

/** The next sale or boost start or end strictly after `t`. */
export function nextBoundaryAfter(t: number): number {
  return Math.min(getNextSaleStart(t), getNextSaleEnd(t), getNextEarningsBoostStart(t), getNextEarningsBoostEnd(t));
}

/** Whether a run from `start` lasting `seconds` reaches a sale or boost boundary. */
export function crossesBoundary(start: number, seconds: number): boolean {
  return nextBoundaryAfter(start) <= start + seconds + BOUNDARY_EPSILON_SECONDS;
}

/**
 * How far past a prefix's own end a shift in it can see a sale coming. A research purchase that
 * should wait for the sale is deferred to it when the sale starts within the shift's own budget
 * (`buyResearch` in shifts/helpers/milestones.ts), and the longest budgets in C1..R1 are C2's and
 * I1's 4 hours. Measured at TE 150: starts 2-4 h before Friday 9:00 waited into the sale (a 3.5-4 h
 * prefix instead of 1.06 h); 5 h before matched the seed exactly.
 */
export const LOOKAHEAD_SECONDS = 4 * 3600;

export type PrefixSource ={ kind: 'seed' } | { kind: 'reuse'; seedHour: number } | { kind: 'fresh'; reason: 'crosses' | 'seedCrosses' };

/**
 * Where hour `h`'s prefix comes from, given each seed's prefix length in seconds. A seed whose own
 * prefix crosses a boundary can't stand in for anything: its class's hours are all built fresh.
 */
export function prefixSourceFor(h: number, seedSeconds: Record<EventClass, number>): PrefixSource {
  const start = hourStart(h);
  const cls = eventClassAt(start);
  const seedHour = SEED_HOURS[cls];
  if (h === seedHour) return { kind: 'seed' };
  const horizon = seedSeconds[cls] + LOOKAHEAD_SECONDS;
  if (crossesBoundary(hourStart(seedHour), horizon)) return { kind: 'fresh', reason: 'seedCrosses' };
  if (crossesBoundary(start, horizon)) return { kind: 'fresh', reason: 'crosses' };
  return { kind: 'reuse', seedHour };
}

export function allHours(): number[] {
  return Array.from({ length: WEEK_HOURS }, (_, h) => h);
}
