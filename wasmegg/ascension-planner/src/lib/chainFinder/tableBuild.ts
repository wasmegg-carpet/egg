/**
 * Builds a build table for a chosen delivery set in the browser and packs it into the `table.bin`
 * AutoAutoAP loads: the same cells, prefix reuse and file as scripts/buildTable.ts `--generate`
 * then `--pack`, scheduled the same way (seeds first, then the hours that reuse them; the next start
 * TE begins only when nothing else is queued), on a pool of Web Workers.
 *
 * Nothing is kept between runs: a closed tab or a cancel loses the build.
 */
import { REFERENCE_WEEK, WEEK_HOURS } from '@/buildTable/cell';
import { tableGear } from '@/buildTable/header';
import { maxedContext } from '@/buildTable/maxedAccount';
import { checkPacked, packTable, type Cell } from '@/buildTable/pack';
import { allHours, prefixSourceFor, SEED_HOURS, type EventClass } from '@/buildTable/prefixReuse';
import { cteBonusOf, type K3Record, type TaskResult } from '@/buildTable/task';
import type { SimulationContext } from '@/auto/types';
import { gzipBytes } from 'lib/planners/utils/gzip';
import { BuildEta } from './eta';
import { ChainFinderWorkerPool } from './workerPool';

export interface TableBuildOptions {
  /** The fixed delivery structure (four artifact ids). */
  deliveryIds: string[];
  /** Silo mode: the auto-planner's defer-for-earnings. */
  deferForEarnings?: boolean;
  /** Start TEs to build. The file spans their min..max; TEs in between are left empty. */
  tes: number[];
  workers: number;
  /** Receives a function that changes the worker count while the build runs. */
  onResizable?: (setWorkers: (workers: number) => void) => void;
  onProgress?: (progress: TableBuildProgress) => void;
  signal?: AbortSignal;
}

export interface TeProgress {
  te: number;
  cellsDone: number;
  reused: number;
  fresh: number;
}

export interface TableBuildProgress {
  cellsDone: number;
  cellsTotal: number;
  /** Share of the build's estimated time that's done, 0-1 (cells weighted by start TE; see eta.ts). */
  fractionDone: number;
  k3Done: boolean;
  elapsedMs: number;
  /** Rough: weights cells by start TE (low TEs cost more) at the recent rate; see eta.ts. */
  etaMs: number | null;
  workers: number;
  busyWorkers: number;
  tesDone: number;
  tesTotal: number;
  /** Start TEs begun but not finished, highest first. */
  tes: TeProgress[];
}

export interface TableBuildResult {
  bytes: Uint8Array<ArrayBuffer>;
  /** `bytes` gzipped, the file to download (the CLI's `table.bin.gz`). */
  gzipped: Uint8Array<ArrayBuffer>;
  from: number;
  to: number;
  cells: number;
  simVersion: string;
  elapsedMs: number;
}

/** A start TE in flight: its three seeds, then the other hours. */
interface TeJob {
  te: number;
  seeds: Partial<Record<EventClass, TaskResult>>;
  cells: Map<number, Cell>;
  reused: number;
  fresh: number;
}

export function buildChainFinderTable(options: TableBuildOptions): Promise<TableBuildResult> {
  const tes = [...new Set(options.tes)].sort((a, b) => b - a);
  const bad = tes.filter(te => !Number.isInteger(te) || te < 1 || te > 489);
  if (!tes.length || bad.length) return Promise.reject(new Error(`start TEs must be whole numbers 1-489, got ${bad.join(', ')}`));

  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const builtAt = new Date().toISOString();
    const deferForEarnings = options.deferForEarnings ?? false;
    const pool = new ChainFinderWorkerPool(options.workers, options.deliveryIds, deferForEarnings);
    const pending = [...tes];
    const jobs: TeJob[] = [];
    const active = new Set<TeJob>();
    const cellsTotal = tes.length * WEEK_HOURS;
    let cellsDone = 0;
    const eta = new BuildEta(tes, WEEK_HOURS, t0);
    let k3: K3Record | null = null;
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      pool.terminate();
      reject(err);
    };
    pool.onError = fail;
    if (options.signal?.aborted) return fail(new DOMException('Table build cancelled', 'AbortError'));
    options.signal?.addEventListener('abort', () => fail(new DOMException('Table build cancelled', 'AbortError')), {
      once: true,
    });

    const report = () => {
      const now = performance.now();
      const elapsedMs = now - t0;
      options.onProgress?.({
        cellsDone,
        cellsTotal,
        fractionDone: eta.fractionDone,
        k3Done: !!k3,
        elapsedMs,
        etaMs: eta.remainingMs(now),
        workers: pool.size,
        busyWorkers: pool.busyCount,
        tesDone: jobs.length - active.size,
        tesTotal: tes.length,
        tes: [...active].map(j => ({ te: j.te, cellsDone: j.cells.size, reused: j.reused, fresh: j.fresh })),
      });
    };

    const finishIfDone = () => {
      if (settled || !k3 || cellsDone < cellsTotal) return;
      settled = true;
      pool.terminate();
      const toError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)));
      try {
        const packed = pack(jobs, k3, maxedContext(options.deliveryIds, deferForEarnings), builtAt);
        gzipBytes(packed.bytes).then(
          gzipped => resolve({ ...packed, gzipped, elapsedMs: performance.now() - t0 }),
          err => reject(toError(err))
        );
      } catch (err) {
        reject(toError(err));
      }
    };

    const record = (job: TeJob, h: number, reused: boolean, r: TaskResult) => {
      job.cells.set(h, { te: job.te, h, builds: r.builds });
      if (reused) job.reused++;
      else job.fresh++;
      cellsDone++;
      eta.cellDone(job.te, performance.now());
      if (job.cells.size === WEEK_HOURS) active.delete(job);
      report();
      finishIfDone();
    };

    const startTE = (te: number) => {
      const job: TeJob = { te, seeds: {}, cells: new Map(), reused: 0, fresh: 0 };
      jobs.push(job);
      active.add(job);
      const classes = Object.keys(SEED_HOURS) as EventClass[];
      for (const cls of classes) {
        const h = SEED_HOURS[cls];
        pool.cell({ te, h, keepPrefix: true }, r => {
          job.seeds[cls] = r;
          record(job, h, false, { ...r, prefix: undefined });
          if (!classes.every(c => job.seeds[c])) return;
          const seedSeconds = Object.fromEntries(classes.map(c => [c, job.seeds[c]!.prefixSeconds])) as Record<
            EventClass,
            number
          >;
          for (const hh of allHours()) {
            const source = prefixSourceFor(hh, seedSeconds);
            if (source.kind === 'seed') continue;
            const prefix =
              source.kind === 'reuse'
                ? job.seeds[classes.find(c => SEED_HOURS[c] === source.seedHour)!]!.prefix
                : undefined;
            pool.cell({ te, h: hh, prefix }, rr => record(job, hh, source.kind === 'reuse', rr));
          }
          // The queued tasks hold their prefixes; drop ours so 370 TEs' seed states don't pile up.
          job.seeds = {};
        });
      }
    };

    pool.k3(r => {
      k3 = r;
      report();
      finishIfDone();
    });
    pool.onDrain = () => {
      if (pending.length) startTE(pending.shift()!);
    };
    pool.start();
    options.onResizable?.(workers => {
      if (settled) return;
      pool.resize(workers);
      report();
    });
    report();
  });
}

/** The header scripts/buildTable.ts `--pack` writes, over this build's cells. */
function pack(
  jobs: TeJob[],
  k3: K3Record,
  context: SimulationContext,
  builtAt: string
): Omit<TableBuildResult, 'gzipped' | 'elapsedMs'> {
  const cells = jobs.flatMap(j => [...j.cells.values()]).sort((a, b) => a.te - b.te || a.h - b.h);
  const from = Math.min(...jobs.map(j => j.te));
  const to = Math.max(...jobs.map(j => j.te));
  const bytes = packTable(
    {
      version: 1,
      referenceWeek: REFERENCE_WEEK,
      cteBonus: cteBonusOf(context),
      doubleEarnings: context.assumeDoubleEarnings,
      ...tableGear(context),
      deliveryScore: 1,
      from,
      to,
      builtAt,
      simVersion: __SIM_VERSION__,
      k3,
    },
    cells
  );
  checkPacked(bytes, cells);
  return { bytes, from, to, cells: cells.length, simVersion: __SIM_VERSION__ };
}
