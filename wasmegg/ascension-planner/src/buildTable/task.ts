/**
 * The unit of work behind a table build, and the table-wide K3 record. Shared by
 * scripts/buildTable.ts's worker processes and the Table Builder's Web Workers; Node-free.
 */
import { cteFromArtifacts } from 'lib/virtue';
import { equippedArtifactsToLibArtifacts } from '@/lib/artifacts/utils';
import { socketEarningsStones } from '@/auto/loadout';
import type { SimulationContext } from '@/auto/types';
import { buildsFrom, contextAt, k3StateOf, paramsOf, prefixAt, REFERENCE_WEEK, startStateAt, variantsFrom } from './cell';
import type { BuildParams, Prefix } from './cell';
import { maxedBaseState } from './maxedAccount';
import { hourStart } from './prefixReuse';

export interface Task {
  id: number;
  te: number;
  h: number;
  /** The seed's prefix to reuse; absent = build the prefix fresh. */
  prefix?: Prefix;
  /** Send the fresh prefix back (seeds). */
  keepPrefix?: boolean;
  /** With `prefix`: also build fresh and compare. */
  verify?: boolean;
}

export interface TaskResult {
  id: number;
  builds: BuildParams[];
  prefixSeconds: number;
  prefix?: Prefix;
  msPrefix: number;
  msRest: number;
  verify?: { prefixSame: boolean; buildsSame: boolean; freshBuilds?: BuildParams[]; freshPrefixSeconds: number };
}

/** One cell, on the maxed base state, with `context`'s gear (`maxedContext`). */
export function runTask(task: Task, context: SimulationContext): TaskResult {
  const ctx = contextAt(context, hourStart(task.h));
  const state = startStateAt(maxedBaseState(), task.te);
  const t0 = performance.now();
  const prefix = task.prefix ?? prefixAt(state, ctx);
  const t1 = performance.now();
  const builds = buildsFrom(prefix, ctx, task.te);
  const t2 = performance.now();
  const result: TaskResult = {
    id: task.id,
    builds,
    prefixSeconds: prefix.elapsedSeconds,
    msPrefix: task.prefix ? 0 : t1 - t0,
    msRest: t2 - t1,
  };
  if (task.keepPrefix) result.prefix = prefix;
  if (task.prefix && task.verify) {
    const fresh = prefixAt(state, ctx);
    const prefixSame = JSON.stringify(fresh) === JSON.stringify(task.prefix);
    const freshBuilds = prefixSame ? builds : buildsFrom(fresh, ctx, task.te);
    const buildsSame = JSON.stringify(freshBuilds) === JSON.stringify(builds);
    result.verify = {
      prefixSame,
      buildsSame,
      freshPrefixSeconds: fresh.elapsedSeconds,
      ...(buildsSame ? {} : { freshBuilds }),
    };
  }
  return result;
}

/** Where AutoAutoAP measures a player's peak against the table's: TE 400 at the reference week's hour 0. */
const PEAK_TE = 400;

export type K3Record = ReturnType<typeof k3Record>;

/** The research a build waits with, its delivery set, and the table's peak delivery rate there. */
export function k3Record(context: SimulationContext) {
  const ctx = contextAt(context, REFERENCE_WEEK);
  const prefix = prefixAt(startStateAt(maxedBaseState(), PEAK_TE), ctx);
  const variants = variantsFrom(prefix, ctx, PEAK_TE);
  const { k3 } = k3StateOf(prefix, variants[0], ctx);
  const peak = Math.max(...variants.map(v => paramsOf(prefix, v, ctx).peakELR));
  return { research: k3.researchLevels, delivery: k3.artifactLoadout, peak };
}

/** Clothed TE of `context`'s socketed earnings set, as the table header records it. */
export function cteBonusOf(context: SimulationContext): number {
  const earnings = socketEarningsStones(context.loadoutInputs!.earnings, context.loadoutInputs!.stones);
  return Number(cteFromArtifacts(equippedArtifactsToLibArtifacts(earnings)).toFixed(2));
}
