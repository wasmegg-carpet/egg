// Node-budget bench, opt-in via `BENCH`. Not a test: it asserts nothing and prints a table of solve latency and
// judged log10(joint) per instance per `maxNodes`. See ARENA.md, "Running it".
//
//   BENCH=1 ARENA_WINDOW=inside BENCH_BASES=600,1200,2400 pnpm exec vitest run tests/arena/tuning-bench.spec.ts

import { describe, it } from 'vitest';
import { loadHighs } from 'lib/mission-optimizer/solver/highs';
import { DEFAULT_TUNING, solveWith } from 'lib/mission-optimizer/solver/solve';
import type { Planner } from './contract';
import { run } from './harness';
import { generateInstance } from './instances';

const REQUESTED = process.env.BENCH !== undefined;
const BASES = (
  process.env.BENCH_BASES ?? `${DEFAULT_TUNING.maxNodes / 2},${DEFAULT_TUNING.maxNodes},${DEFAULT_TUNING.maxNodes * 2}`
)
  .split(',')
  .map(Number);
const COUNT = Number(process.env.BENCH_INSTANCES ?? 8);
const SEED_BASE = Number(process.env.BENCH_SEED_BASE ?? 2000);

const pad = (s: string | number, n: number) => String(s).padStart(n);

describe.skipIf(!REQUESTED)(`node budget bench (2x window: ${process.env.ARENA_WINDOW || 'none'})`, () => {
  it('measures latency and quality against maxNodes', async () => {
    const solve = await loadHighs();
    console.log(`\n  seed   window   opts${BASES.map(b => pad(`maxNodes=${b}`, 24)).join('')}`);
    for (let i = 0; i < COUNT; i++) {
      const inst = generateInstance(SEED_BASE + i);
      const cells: string[] = [];
      let options = 0;
      for (const maxNodes of BASES) {
        const planner: Planner = problem =>
          solveWith(problem, solve, { ...DEFAULT_TUNING, maxNodes }, { report: true });
        const s = run(planner, inst, { fresh: true });
        options = s.problem.options.length;
        const log10 = s.joint > 0 ? Math.log10(s.joint).toFixed(3) : '-inf';
        cells.push(pad(`${s.elapsedMs.toFixed(0)}ms ${log10}`, 24));
      }
      const window = inst.eventWindowSeconds > 0 ? `${(inst.eventWindowSeconds / 3600).toFixed(0)}h` : '-';
      console.log(`  ${pad(SEED_BASE + i, 5)}  ${pad(window, 6)}  ${pad(options, 5)}${cells.join('')}`);
    }
  }, 3_600_000);
});
