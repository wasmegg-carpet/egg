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
    // Per base, the cell is the solve's latency and judged log10(joint); with a sleep window it is followed by
    // the candidate's own account of laying the plan out: log10 of what it promised before layout, and the
    // launches trimmed and demoted on the way. The last lines are each base's means over the instances.
    console.log(`\n  seed   window   opts${BASES.map(b => pad(`maxNodes=${b}`, 24)).join('')}`);
    const sums = BASES.map(() => ({ delivered: 0, planned: 0, scored: 0, laidOut: 0, trimmed: 0, demoted: 0 }));
    for (let i = 0; i < COUNT; i++) {
      const inst = generateInstance(SEED_BASE + i);
      const cells: string[] = [];
      let options = 0;
      BASES.forEach((maxNodes, b) => {
        const planner: Planner = problem =>
          solveWith(problem, solve, { ...DEFAULT_TUNING, maxNodes }, { report: true });
        const s = run(planner, inst, { fresh: true });
        options = s.problem.options.length;
        const log10 = s.joint > 0 ? Math.log10(s.joint).toFixed(3) : '-inf';
        const stats = s.result.layoutStats;
        const planned = stats?.plannedLogJoint;
        const sum = sums[b];
        if (s.joint > 0) {
          sum.delivered += Math.log10(s.joint);
          sum.scored++;
          if (planned !== undefined && Number.isFinite(planned)) {
            sum.planned += planned / Math.LN10;
            sum.laidOut++;
          }
        }
        sum.trimmed += stats?.launchesTrimmed ?? 0;
        sum.demoted += stats?.launchesDemoted ?? 0;
        const laid =
          stats === undefined
            ? ''
            : ` (${planned === undefined ? '-' : (planned / Math.LN10).toFixed(3)} t${stats.launchesTrimmed}` +
              ` d${stats.launchesDemoted ?? 0})`;
        cells.push(pad(`${s.elapsedMs.toFixed(0)}ms ${log10}${laid}`, laid ? 44 : 24));
      });
      const window = inst.eventWindowSeconds > 0 ? `${(inst.eventWindowSeconds / 3600).toFixed(0)}h` : '-';
      console.log(`  ${pad(SEED_BASE + i, 5)}  ${pad(window, 6)}  ${pad(options, 5)}${cells.join('')}`);
    }
    BASES.forEach((maxNodes, b) => {
      const sum = sums[b];
      console.log(
        `  maxNodes=${maxNodes}: mean delivered log10 ${(sum.delivered / Math.max(1, sum.scored)).toFixed(4)} over ` +
          `${sum.scored} scoring instance(s)` +
          (sum.laidOut > 0 ? `, mean planned ${(sum.planned / sum.laidOut).toFixed(4)} over ${sum.laidOut}` : '') +
          `, ${sum.trimmed} trimmed, ${sum.demoted} demoted`
      );
    });
  }, 3_600_000);
});
