// Seeded instance generator for the oracle harness. Instances are built from real game data; the
// generator chooses only the targets, the option subset, the budgets and the owned inventory.

import { perfectShipsConfig } from 'lib';
import type { LaunchOption, RecipeDAG } from '@/lib/types';
import { buildRecipeDag } from '@/lib';
import { enumerateLaunchOptions } from '@/lib/phases';
import { artifactTiers } from '@/lib/artifacts';
import { countFeasible } from './enumerate';
import type { OracleInstance } from './evaluate';

export const FAMILIES = [
  'random-single',
  'random-multi',
  'cheap-filler',
  'near-tie',
  'chunky-knapsack',
  'edge',
] as const;
export type Family = (typeof FAMILIES)[number];

const FEASIBLE_CAP = 60_000;
const CRAFTING_LEVELS = [10, 20, 30];
const NUM_SLOTS = 3;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

export function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function dyadic(rng: Rng, lo: number, hi: number, denom = 4): number {
  return randInt(rng, Math.round(lo * denom), Math.round(hi * denom)) / denom;
}

export function pick<T>(rng: Rng, items: T[]): T {
  // An empty pool would draw `undefined` and hand it on as a `T`, surfacing far
  // from the caller that emptied it.
  if (items.length === 0) throw new RangeError('pick from an empty collection');
  return items[randInt(rng, 0, items.length - 1)];
}

function sample<T>(rng: Rng, items: T[], count: number): T[] {
  const pool = items.slice();
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    out.push(pool.splice(randInt(rng, 0, pool.length - 1), 1)[0]);
  }
  return out;
}

// Real artifacts that can actually come out legendary from a craft.
let candidateTargetsMemo: string[] | null = null;
export function candidateTargets(): string[] {
  if (candidateTargetsMemo === null) {
    candidateTargetsMemo = artifactTiers
      .filter(tier => tier.craftable)
      .map(tier => tier.id)
      .filter(id => {
        try {
          // craftChance throws for tiers that cannot be legendary at all
          const dag = buildRecipeDag([id], 30, null, 0);
          return dag.get(id)!.legendaryCraftProbability > 0;
        } catch {
          return false;
        }
      });
    if (candidateTargetsMemo.length === 0) {
      throw new Error('no real craftable-legendary targets found in game data');
    }
  }
  return candidateTargetsMemo;
}

interface RealPool {
  dag: RecipeDAG;
  targets: string[];
  options: LaunchOption[]; // all real options, as production would offer them
  contributingOptions: LaunchOption[]; // options that can contribute anything at all
}

const poolCache = new Map<string, RealPool>();
function getPool(targets: string[], craftingLevel: number): RealPool {
  const key = `${targets.join('+')}#${craftingLevel}`;
  let pool = poolCache.get(key);
  if (!pool) {
    const dag = buildRecipeDag(targets, craftingLevel, null, 0);
    // keep one option per (fuel, time, target) triple: the solver's output
    // carries nothing else to tell colliding missions apart
    const seen = new Set<string>();
    const options = enumerateLaunchOptions(perfectShipsConfig, dag).filter(o => {
      const tripleKey = `${o.actualFuel}:${o.actualTime}:${o.targetAfxId}`;
      if (seen.has(tripleKey)) {
        return false;
      }
      seen.add(tripleKey);
      return true;
    });
    pool = {
      dag,
      targets,
      options,
      contributingOptions: options.filter(o => o.yieldVector.size > 0 || o.legendaryYieldVector.size > 0),
    };
    poolCache.set(key, pool);
  }
  return pool;
}

function pickLevel(rng: Rng, targets: string[]): number {
  // low crafting levels can zero out the legendary chance for some targets;
  // fall back to max level rather than emit a degenerate instance
  for (const level of sample(rng, CRAFTING_LEVELS, CRAFTING_LEVELS.length)) {
    const dag = buildRecipeDag(targets, level, null, 0);
    if (targets.every(t => dag.get(t)!.legendaryCraftProbability > 0)) {
      return level;
    }
  }
  return 30;
}

function maybeBaseYield(rng: Rng, dag: RecipeDAG, targets: string[]): Map<string, number> {
  const base = new Map<string, number>();
  if (rng() < 0.5) {
    const roots = new Set(targets);
    const items = [...dag.keys()].filter(id => !roots.has(id));
    for (const item of sample(rng, items, randInt(rng, 1, Math.min(3, items.length)))) {
      base.set(item, randInt(rng, 1, 40));
    }
  }
  return base;
}

function minPositiveFuel(options: LaunchOption[]): number {
  const fuels = options.map(o => o.actualFuel).filter(f => f > 0);
  return fuels.length > 0 ? Math.min(...fuels) : 1;
}

function minTime(options: LaunchOption[]): number {
  return Math.min(...options.map(o => o.actualTime));
}

function finalize(
  label: Family,
  seed: number,
  pool: RealPool,
  options: LaunchOption[],
  fuelCapacity: number,
  timeCapacityPerSlot: number,
  baseYield: Map<string, number>,
  minFeasible = 24
): OracleInstance | null {
  // unique (fuel, time, target) triples are the precondition for mapping the
  // solver's choiceHistory back onto input options
  const keys = new Set(options.map(o => `${o.actualFuel}:${o.actualTime}:${o.targetAfxId}`));
  if (keys.size !== options.length) {
    throw new Error(`${label} seed ${seed}: duplicate option cost/target triple`);
  }
  // Never let the horizon fall below the longest chosen mission, which could
  // then never fit any slot.
  const maxDur = Math.max(...options.map(o => o.actualTime));
  let fuel = fuelCapacity;
  let time = Math.max(timeCapacityPerSlot, maxDur);
  for (let attempt = 0; attempt < 25; attempt++) {
    const inst: OracleInstance = {
      label,
      seed,
      options,
      dag: pool.dag,
      targets: pool.targets,
      fuelCapacity: fuel,
      timeCapacityPerSlot: time,
      baseYield,
    };
    const count = countFeasible(inst, FEASIBLE_CAP);
    if (count !== null) {
      // reject near-decision-free instances rather than dilute the campaign
      return count >= minFeasible ? inst : null;
    }
    fuel *= 0.7;
    time = Math.max(time * 0.7, maxDur);
  }
  return null;
}

// Price a random basket of the subset's own options and add a little slack,
// so mixed plans are affordable and the instance poses a real decision.
function basketBudgets(rng: Rng, options: LaunchOption[]): [number, number] {
  const counts = options.map(() => randInt(rng, 0, 3));
  const [a, b] = sample(
    rng,
    options.map((_, i) => i),
    2
  );
  counts[a] = Math.max(1, counts[a]);
  if (b !== undefined) {
    counts[b] = Math.max(1, counts[b]);
  }
  const fuel = counts.reduce((s, k, i) => s + k * options[i].actualFuel, 0);
  // per-slot horizon: a third of the basket's mission-seconds, but at least
  // the longest single mission
  const totalSeconds = counts.reduce((s, k, i) => s + k * options[i].actualTime, 0);
  const maxDur = Math.max(...options.map(o => o.actualTime));
  const time = Math.max(maxDur, totalSeconds / NUM_SLOTS);
  return [fuel * dyadic(rng, 1, 1.5, 8), time * dyadic(rng, 1, 1.5, 8)];
}

// Sample within a fuel-cost band of a random pivot: real missions span many
// orders of magnitude, and an unbanded sample leaves most of the subset
// unaffordable under any enumerable budget.
function bandSample(rng: Rng, contributingOptions: LaunchOption[], count: number): LaunchOption[] {
  const positive = contributingOptions.filter(o => o.actualFuel > 0);
  if (positive.length === 0) {
    return sample(rng, contributingOptions, count);
  }
  const pivot = pick(rng, positive);
  const band = contributingOptions.filter(
    o => o.actualFuel === 0 || (o.actualFuel >= pivot.actualFuel / 32 && o.actualFuel <= pivot.actualFuel * 32)
  );
  return sample(rng, band, count);
}

export function generateInstance(family: Family, seed: number): OracleInstance | null {
  const rng = mulberry32(seed * 6 + FAMILIES.indexOf(family) + 1);

  switch (family) {
    case 'random-single':
    case 'random-multi': {
      const targets = family === 'random-multi' ? sample(rng, candidateTargets(), 2) : [pick(rng, candidateTargets())];
      const pool = getPool(targets, pickLevel(rng, targets));
      if (pool.contributingOptions.length < 2) {
        return null;
      }
      const options = bandSample(
        rng,
        pool.contributingOptions,
        randInt(rng, 3, Math.min(5, pool.contributingOptions.length))
      );
      if (options.length < 2) {
        return null;
      }
      const [fuel, time] = basketBudgets(rng, options);
      return finalize(family, seed, pool, options, fuel, time, maybeBaseYield(rng, pool.dag, targets));
    }

    case 'cheap-filler': {
      // budget leaves a remainder only the cheap mission can use
      const targets = [pick(rng, candidateTargets())];
      const pool = getPool(targets, pickLevel(rng, targets));
      const byFuel = pool.contributingOptions.filter(o => o.actualFuel > 0).sort((a, b) => a.actualFuel - b.actualFuel);
      if (byFuel.length < 3) {
        return null;
      }
      const cheap = pick(rng, byFuel.slice(0, Math.max(1, Math.floor(byFuel.length / 4))));
      const expensive = pick(rng, byFuel.slice(-Math.max(1, Math.floor(byFuel.length / 4))));
      if (expensive.actualFuel <= cheap.actualFuel * 2) {
        return null;
      }
      const options = [expensive, cheap];
      if (rng() < 0.5) {
        const mid = pick(rng, byFuel);
        if (!options.includes(mid)) {
          options.push(mid);
        }
      }
      const fuel = expensive.actualFuel * (randInt(rng, 2, 4) + dyadic(rng, 0.1, 0.9, 16));
      const time = Math.max(...options.map(o => o.actualTime)) * dyadic(rng, 3, 10);
      return finalize(family, seed, pool, options, fuel, time, maybeBaseYield(rng, pool.dag, targets));
    }

    case 'near-tie': {
      // the two real missions with the closest fuel costs
      const targets = [pick(rng, candidateTargets())];
      const pool = getPool(targets, pickLevel(rng, targets));
      const byFuel = pool.contributingOptions.filter(o => o.actualFuel > 0).sort((a, b) => a.actualFuel - b.actualFuel);
      if (byFuel.length < 3) {
        return null;
      }
      let bestPair: [LaunchOption, LaunchOption] | null = null;
      let bestRatio = Infinity;
      const start = randInt(rng, 0, Math.max(0, byFuel.length - 6));
      for (let i = start; i < byFuel.length - 1 && i < start + 8; i++) {
        const ratio = byFuel[i + 1].actualFuel / byFuel[i].actualFuel;
        if (ratio < bestRatio && ratio > 1 - 1e-12) {
          bestRatio = ratio;
          bestPair = [byFuel[i], byFuel[i + 1]];
        }
      }
      if (!bestPair) {
        return null;
      }
      const third = pick(rng, byFuel);
      const options = bestPair[0] === third || bestPair[1] === third ? [...bestPair] : [...bestPair, third];
      const [fuel, time] = basketBudgets(rng, options);
      return finalize(family, seed, pool, options, fuel, time, maybeBaseYield(rng, pool.dag, targets));
    }

    case 'chunky-knapsack': {
      // only expensive missions under a tight budget: stepped payoffs stress
      // searches that assume approximate concavity
      const targets = [pick(rng, candidateTargets())];
      const pool = getPool(targets, pickLevel(rng, targets));
      const byFuel = pool.contributingOptions.filter(o => o.actualFuel > 0).sort((a, b) => a.actualFuel - b.actualFuel);
      if (byFuel.length < 4) {
        return null;
      }
      const upperHalf = byFuel.slice(Math.floor(byFuel.length / 2));
      const options = sample(rng, upperHalf, Math.min(randInt(rng, 3, 4), upperHalf.length));
      const [fuel, time] = basketBudgets(rng, options);
      return finalize(family, seed, pool, options, fuel * 0.75, time * 0.75, maybeBaseYield(rng, pool.dag, targets));
    }

    case 'edge': {
      const targets = [pick(rng, candidateTargets())];
      const pool = getPool(targets, pickLevel(rng, targets));
      if (pool.contributingOptions.length < 2) {
        return null;
      }
      const variant = seed % 5;
      if (variant === 0) {
        // nothing can launch: answer comes purely from owned inventory
        const base = new Map<string, number>();
        const roots = new Set(targets);
        for (const item of [...pool.dag.keys()].filter(id => !roots.has(id))) {
          if (rng() < 0.7) {
            base.set(item, randInt(rng, 1, 30));
          }
        }
        return finalize(
          family,
          seed,
          pool,
          sample(rng, pool.contributingOptions, 1),
          0,
          minTime(pool.contributingOptions) * 4,
          base,
          0
        );
      }
      if (variant === 1) {
        // budgets positive but below every option's cost
        const options = sample(rng, pool.contributingOptions, 2);
        return finalize(
          family,
          seed,
          pool,
          options,
          minPositiveFuel(options) * 0.5,
          minTime(options) * 0.5,
          maybeBaseYield(rng, pool.dag, targets),
          0
        );
      }
      if (variant === 2) {
        // single mission, fuel budget an exact multiple of its cost
        const opt = pick(
          rng,
          pool.contributingOptions.filter(o => o.actualFuel > 0)
        );
        return finalize(
          family,
          seed,
          pool,
          [opt],
          opt.actualFuel * randInt(rng, 1, 8),
          opt.actualTime * 20,
          maybeBaseYield(rng, pool.dag, targets),
          0
        );
      }
      if (variant === 3) {
        // prefer a mission with observed direct legendary drops
        const droppy = pool.contributingOptions.filter(o => o.legendaryYieldVector.size > 0);
        const first = droppy.length > 0 ? pick(rng, droppy) : pick(rng, pool.contributingOptions);
        const second = pick(rng, pool.contributingOptions);
        const options = first === second ? [first] : [first, second];
        const [fuel, time] = basketBudgets(rng, options);
        return finalize(family, seed, pool, options, fuel, time, maybeBaseYield(rng, pool.dag, targets), 0);
      }
      // time budget binding, fuel effectively unconstrained
      const options = bandSample(rng, pool.contributingOptions, Math.min(3, pool.contributingOptions.length));
      const fuel = options.reduce((total, o) => total + o.actualFuel, 0) * 100;
      const time = minTime(options) * dyadic(rng, 1, 6);
      return finalize(family, seed, pool, options, fuel, time, maybeBaseYield(rng, pool.dag, targets), 0);
    }
  }
}
