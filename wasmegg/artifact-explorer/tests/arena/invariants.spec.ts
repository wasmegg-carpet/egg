// Arena runner. See ARENA.md for the tiers, the environment variables and what gates.
// Opt-in via `ARENA`: the smoke tier alone is 12 minutes, so `pnpm test` never selects this file.

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { CHEAP_CHECKS, DEEP_CHECKS, type Check } from './invariants';
import { selectedSolvers } from './registry';
import { describeInstance, generateInstance } from './instances';
import { formatComparison, formatScorecard, sweep, writeResults, type SweepResult } from './scorecard';

const REQUESTED = process.env.ARENA !== undefined;
const MODE = process.env.ARENA || 'smoke';
const DEEP = MODE === 'deep';
const intEnv = (name: string, fallback: number, min: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`${name} must be an integer >= ${min}, got ${JSON.stringify(raw)}`);
  }
  return n;
};

const COUNT = intEnv('ARENA_INSTANCES', MODE === 'smoke' ? 4 : 40, 1);
const SEED_BASE = intEnv('ARENA_SEED_BASE', 2000, 0);
const GATE_ALL = process.env.ARENA_GATE === 'all';
const RESULT_DIR = resolve(__dirname, 'results');

const HARD_FAIL = new Set(['C0-contract', 'C1-feasibility', 'C1-inconclusive']);

const seeds = Array.from({ length: COUNT }, (_, i) => SEED_BASE + i);
const checks: Check[] = DEEP ? [...CHEAP_CHECKS, ...DEEP_CHECKS] : CHEAP_CHECKS;

describe.skipIf(!REQUESTED)(`arena (${MODE}, ${COUNT} instances)`, () => {
  const solvers = selectedSolvers();
  const results: SweepResult[] = [];

  for (const solver of solvers) {
    it(`${solver.id} holds the invariants`, () => {
      const r = sweep(solver, seeds, checks, inst => {
        if (inst.violations.length > 0) {
          console.log(`  ${describeInstance(generateInstance(inst.seed))} -> ${inst.violations.length} violation(s)`);
          for (const v of inst.violations.slice(0, 6)) {
            console.log(`      ${v.invariant}  ${v.detail}`);
          }
          if (inst.violations.length > 6) {
            console.log(`      ... and ${inst.violations.length - 6} more`);
          }
        }
      });
      results.push(r);
      console.log(formatScorecard(r));
      console.log(`    results written to ${writeResults(RESULT_DIR, r)}`);

      const failing = r.instances
        .flatMap(i => i.violations)
        .filter(v => GATE_ALL || HARD_FAIL.has(v.invariant) || v.invariant.endsWith('-threw'));
      expect(failing.map(v => `${v.invariant} ${v.instance}: ${v.detail}`)).toEqual([]);
    }, 3_600_000);
  }

  it('reports head-to-head plan quality', () => {
    if (results.length < 2) {
      console.log('\n(only one solver ran; nothing to compare)');
      return;
    }
    for (let i = 1; i < results.length; i++) {
      console.log(formatComparison(results[0], results[i]));
    }
  });
});
