// Node-budget bench, opt-in via `BENCH`. Not a test: it asserts nothing and prints a table.
//
//   BENCH=1 ARENA_WINDOW=inside BENCH_BASES=100,200,400 pnpm exec vitest run tests/arena/tuning-bench.spec.ts

import { describe, it } from 'vitest';
import { buildRecipeDag } from '@/lib';
import { enumerateLaunchOptions } from '@/lib/phases';
import { EFFORT_LAUNCH_PERIOD_SECONDS } from '@/store/schema';
import { loadHighs } from '@/lib/solver/highs';
import { DEFAULT_TUNING, solveWith } from '@/lib/solver/oa';
import { buildModel } from '@/lib/solver/model';
import type { PlanProblem } from '@/lib/solver/types';
import { EVENT_REGIMES, generateInstance, isEventRegime, withEventWindow } from './instances';
import { NUM_SLOTS } from './contract';

const REQUESTED = process.env.BENCH !== undefined;
const REGIME = process.env.ARENA_WINDOW ?? 'none';
const BASES = (process.env.BENCH_BASES ?? '100,200,400,800').split(',').map(Number);
const COUNT = Number(process.env.BENCH_INSTANCES ?? 8);
const SEED_BASE = Number(process.env.BENCH_SEED_BASE ?? 2000);

const pad = (s: string | number, n: number) => String(s).padStart(n);

describe.skipIf(!REQUESTED)(`node budget bench (window: ${REGIME})`, () => {
  it('measures latency and quality against the base', async () => {
    if (!isEventRegime(REGIME)) throw new Error(`ARENA_WINDOW must be one of ${Object.keys(EVENT_REGIMES).join(', ')}`);
    const solve = await loadHighs();

    console.log(`\n  seed        opts  groups  ${BASES.map(b => pad(`base=${b}`, 22)).join('')}`);
    for (let i = 0; i < COUNT; i++) {
      const inst = withEventWindow(generateInstance(SEED_BASE + i), REGIME);
      const dag = buildRecipeDag(inst.targets, inst.craftingLevel, null, inst.previousCrafts);
      const options = enumerateLaunchOptions(
        inst.config,
        dag,
        EFFORT_LAUNCH_PERIOD_SECONDS[inst.effort],
        inst.eventWindowSeconds
      );
      const problem: PlanProblem = {
        options,
        dag,
        targets: [...inst.targets],
        fuelCapacity: inst.fuelCapacity,
        timeCapacityPerSlot: inst.timeCapacityPerSlot,
        slots: NUM_SLOTS,
        baseYield: new Map(),
        eventWindowSeconds: inst.eventWindowSeconds,
      };
      const groups = buildModel(problem).groups.length;

      const cells: string[] = [];
      for (const maxNodes of BASES) {
        const started = performance.now();
        const result = solveWith(problem, solve, { ...DEFAULT_TUNING, maxNodes }, { report: true });
        const ms = performance.now() - started;
        const joint = result.reported!.jointProbability;
        const log10 = joint > 0 ? Math.log10(joint).toFixed(3) : '-inf';
        cells.push(pad(`${ms.toFixed(0)}ms ${log10}`, 22));
      }
      console.log(`  ${pad(SEED_BASE + i, 5)}  ${pad(options.length, 10)}  ${pad(groups, 6)}${cells.join('')}`);
    }
  }, 3_600_000);
});
