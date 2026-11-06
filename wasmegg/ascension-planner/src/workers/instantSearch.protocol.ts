/**
 * Messages between the Chain Finder store (stores/instantSearch.ts) and its Web Worker
 * (instantSearch.worker.ts). The worker holds the one table loaded; a search names nothing else.
 */
import type { SpaceFilter } from '@/lib/instantSearch/chainSpace';
import type { FindOptions, FoundRoutes, Route } from '@/lib/instantSearch/routeFinder';
import type { TableHeader } from '@/lib/instantSearch/table';

/** A chain space as the page sees it (lib/instantSearch/chainSpace.ts `ChainSpace`): the chains stay
 *  in the worker. */
export interface SpaceSummary {
  count: number;
  /** More chains than the worker keeps: `count` is a floor. */
  capped: boolean;
  /** What was searched for: a filter that lets more through needs a search of its own. */
  searched: SpaceFilter;
  /** The explored route priced as the space is, no prestige waiting by choice. */
  base: Route | null;
  ms: number;
}

export type InstantSearchRequest =
  /** A table file's bytes, gzipped or not (transferred), with the maxed table's bytes to join it
   *  to above `split` (a gear table below, the maxed one from there, its delivery rate scaled). */
  | { kind: 'load'; requestId: number; bytes: ArrayBuffer; high?: { bytes: ArrayBuffer; split: number; scale: number } }
  | { kind: 'search'; requestId: number; options: Omit<FindOptions, 'onProgress'> }
  /** Every chain like `route` that `filter` lets through (`enumerateChains`), kept for 'filter'. */
  | {
      kind: 'space';
      requestId: number;
      options: Omit<FindOptions, 'onProgress'>;
      route: Route;
      filter: SpaceFilter;
    }
  /** The kept space's chains `filter` lets through: up to `show` of them as routes, and their waits
   *  when there is time. Replaces any filter still working out waits. */
  | { kind: 'filter'; requestId: number; filter: SpaceFilter; show: number };

export type InstantSearchResponse =
  | { type: 'loaded'; requestId: number; header: TableHeader }
  /** `stage` 'waits': the routes found, their prestiges' waits being worked out (`waitForEggs`).
   *  'bound': the table's quickest legs being worked out (once per table); 'chains': chains found so
   *  far (`done`, no `of`). */
  | { type: 'progress'; requestId: number; done: number; of: number; stage?: 'waits' | 'bound' | 'chains' }
  | { type: 'result'; requestId: number; found: FoundRoutes; ms: number }
  | { type: 'space'; requestId: number; summary: SpaceSummary }
  /** `routes`: the matches without waits, when no more than `show`; `waits`: their waits follow
   *  ('waited'). `perWait`: the worker's guess of milliseconds per chain's waits. */
  | { type: 'filtered'; requestId: number; matches: number; routes: Route[] | null; waits: boolean; perWait: number }
  | { type: 'waited'; requestId: number; routes: Route[] }
  | { type: 'error'; requestId: number; message: string };
