import { describe, expect, test } from 'vitest';

import { optimizeFull } from '@/lib/optimizer-core';
import type { OptimizerSolution, RecipeDAG } from '@/lib/types';
import { makeNode, makeOpt } from '../unit/spec-helpers';
import { bruteForceBestJoint, RANKING_SLOP_JOINT } from './enumerate';
import { evaluateAllocation, evaluateAllocationJoint, OracleInstance, targetQ } from './evaluate';
import { FAMILIES, Family, generateInstance } from './generate';

const GAP_TOL = Number(process.env.ORACLE_GAP_TOL ?? 1e-3);
const SMOKE_GAP_TOL = Math.max(GAP_TOL, 0.05);
// The bar in the other direction, and deliberately not GAP_TOL. GAP_TOL is slack bought for the solver,
// which is allowed to be a heuristic; the enumeration is exhaustive over maximal allocations and scores the
// plan's own allocation with the same exact evaluator, so it has no comparable licence to lose. The one way
// the plan can legitimately come out ahead is the float pre-ranking mis-ordering a genuine near-tie, and
// that band is RANKING_SLOP_JOINT wide. Sharing the constant keeps the two from drifting apart.
const REVERSE_GAP_TOL = RANKING_SLOP_JOINT;
const DEEP = process.env.RUN_ORACLE === '1';
const BUDGET_MS = Number(process.env.ORACLE_TIME_BUDGET_MS ?? 25 * 60_000);
const SEED_BASE = Number(process.env.ORACLE_SEED_BASE ?? 1000);

interface InstanceFailure {
  family: string;
  seed: number;
  kind: 'reconstruction' | 'optimality' | 'oracle' | 'harness';
  detail: string;
}

interface InstanceOutcome {
  family: string;
  seed: number;
  gap: number; // oracle best probability minus plan probability (>= 0)
  failures: InstanceFailure[];
}

async function runOptimizer(inst: OracleInstance): Promise<OptimizerSolution> {
  return await optimizeFull({
    options: inst.options,
    recipeDag: inst.dag,
    desiredArtifactNodeIds: inst.targets,
    fuelCapacity: inst.fuelCapacity,
    timeCapacityPerSlot: inst.timeCapacityPerSlot,
    baseYield: inst.baseYield,
    craftBudget: inst.craftBudget,
    maximumCost: Infinity,
  });
}

// choiceHistory entries don't carry the option id, but the generator
// guarantees each option a unique (fuel, time, target) triple.
function reconstructAllocation(inst: OracleInstance, solution: OptimizerSolution): number[] {
  const allocation = new Array<number>(inst.options.length).fill(0);
  for (const launch of solution.choiceHistory) {
    if (launch.numShipsLaunched === 0) {
      continue;
    }
    const idx = inst.options.findIndex(
      opt =>
        opt.actualFuel === launch.actualFuel &&
        opt.actualTime === launch.actualTime &&
        opt.targetAfxId === launch.targetAfxId
    );
    if (idx === -1) {
      throw new Error(
        `choiceHistory entry (fuel=${launch.actualFuel}, time=${launch.actualTime}, target=${launch.targetAfxId}) matches no input option`
      );
    }
    allocation[idx] += launch.numShipsLaunched;
  }
  return allocation;
}

async function solverPricesAllocation(inst: OracleInstance, allocation: number[]): Promise<number> {
  const yields = new Map<string, number>();
  const legendary = new Map<string, number>();
  inst.options.forEach((opt, i) => {
    for (const [item, qty] of opt.yieldVector) {
      yields.set(item, (yields.get(item) ?? 0) + allocation[i] * qty);
    }
    for (const [item, qty] of opt.legendaryYieldVector) {
      legendary.set(item, (legendary.get(item) ?? 0) + allocation[i] * qty);
    }
  });
  const solution = await optimizeFull({
    options: [makeOpt(1, 1, [...yields], [...legendary])],
    recipeDag: inst.dag,
    desiredArtifactNodeIds: inst.targets,
    fuelCapacity: 1,
    timeCapacityPerSlot: 1,
    baseYield: inst.baseYield,
    craftBudget: inst.craftBudget,
    maximumCost: Infinity,
  });
  return solution.jointProbability;
}

async function checkInstance(inst: OracleInstance, gapTol = GAP_TOL): Promise<InstanceOutcome> {
  const failures: InstanceFailure[] = [];
  const fail = (kind: InstanceFailure['kind'], detail: string) =>
    failures.push({ family: inst.label, seed: inst.seed, kind, detail });

  const solution = await runOptimizer(inst);

  let allocation: number[];
  try {
    allocation = reconstructAllocation(inst, solution);
  } catch (err) {
    fail('reconstruction', String(err));
    return { family: inst.label, seed: inst.seed, gap: NaN, failures };
  }

  const planEval = evaluateAllocationJoint(inst, allocation);
  const oracle = bruteForceBestJoint(inst);
  const signedGap = oracle.bestJointProbability - planEval.jointProbability;
  // Clamping to zero here and asserting only the positive side is what let the enumerator regress unseen:
  // an oracle that returns nothing at all reports a gap of zero on every instance and the campaign stays
  // green. A plan that beats the exhaustive enumeration is a statement about the oracle, not the solver, so
  // it gets its own failure kind.
  if (-signedGap > REVERSE_GAP_TOL) {
    fail(
      'oracle',
      `plan [${allocation}] jointP=${planEval.jointProbability.toFixed(12)} beats the exhaustive best ` +
        `[${oracle.bestAllocation}] jointP=${oracle.bestJointProbability.toFixed(12)} by ` +
        `${(-signedGap).toExponential(3)} (${oracle.evaluatedCount} of ${oracle.feasibleCount} allocations ` +
        `were maximal and evaluated)`
    );
  }
  const gap = Math.max(0, signedGap);
  if (gap > gapTol) {
    const solverView = await solverPricesAllocation(inst, oracle.bestAllocation);
    const confirmed = solverView - planEval.jointProbability > GAP_TOL / 2;
    fail(
      'optimality',
      `plan [${allocation}] jointP=${planEval.jointProbability.toFixed(6)} but oracle found ` +
        `[${oracle.bestAllocation}] jointP=${oracle.bestJointProbability.toFixed(6)} ` +
        `(gap ${gap.toExponential(3)}, solver's own pricing of that allocation: ${solverView.toFixed(6)} — ` +
        `${confirmed ? 'CONFIRMED by solver value function' : 'NOT confirmed; possible oracle model divergence'}, ` +
        `${oracle.evaluatedCount} allocations checked)`
    );
  }

  return { family: inst.label, seed: inst.seed, gap, failures };
}

function summarize(outcomes: InstanceOutcome[]): string {
  const lines: string[] = [];
  let gapCount = 0;
  let nonZero = 0;
  let maxGap = 0;
  let gapSum = 0;
  for (const o of outcomes) {
    if (Number.isNaN(o.gap)) {
      continue;
    }
    gapCount++;
    gapSum += o.gap;
    if (o.gap > maxGap) {
      maxGap = o.gap;
    }
    if (o.gap > 1e-12) {
      nonZero++;
    }
  }
  lines.push(
    `oracle: ${outcomes.length} instances, ${nonZero} with a nonzero optimality gap, ` +
      `max gap ${gapCount ? maxGap.toExponential(3) : 'n/a'}, ` +
      `mean gap ${gapCount ? (gapSum / gapCount).toExponential(3) : 'n/a'}`
  );
  const byFamily = new Map<string, number>();
  for (const o of outcomes) {
    byFamily.set(o.family, (byFamily.get(o.family) ?? 0) + 1);
  }
  lines.push(`per family: ${[...byFamily].map(([f, n]) => `${f}=${n}`).join(', ')}`);
  const worst = outcomes
    .filter(o => !Number.isNaN(o.gap) && o.gap > 1e-12)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5);
  for (const o of worst) {
    lines.push(`  worst: family=${o.family} seed=${o.seed} gap=${o.gap.toExponential(3)}`);
  }
  return lines.join('\n');
}

function assertNoFailures(outcomes: InstanceOutcome[]): void {
  const failures = outcomes.flatMap(o => o.failures);
  if (failures.length > 0) {
    const byBucket = new Map<string, number>();
    for (const f of failures) {
      const key = `${f.family}/${f.kind}`;
      byBucket.set(key, (byBucket.get(key) ?? 0) + 1);
    }
    console.log(`failure breakdown: ${[...byBucket].map(([k, n]) => `${k}=${n}`).join(', ')}`);
    // sample a few failures of every kind so a flood of one kind can't hide
    // the others
    const byKind = new Map<string, InstanceFailure[]>();
    for (const f of failures) {
      const list = byKind.get(f.kind) ?? [];
      if (list.length < 8) {
        list.push(f);
      }
      byKind.set(f.kind, list);
    }
    for (const [, list] of byKind) {
      for (const f of list) {
        console.log(`  ${f.family} seed=${f.seed} [${f.kind}] ${f.detail}`);
      }
    }
  }
  expect(failures.slice(0, 10)).toEqual([]);
  expect(failures.length).toBe(0);
}

describe('oracle calibration', () => {
  test('inventory-only crafting matches closed form', async () => {
    const p = 0.5;
    const inst: OracleInstance = {
      label: 'probe',
      seed: 0,
      options: [],
      dag: new Map(
        [
          makeNode('a', true),
          makeNode('b', true),
          makeNode(
            't',
            false,
            [
              ['a', 2],
              ['b', 1],
            ],
            p
          ),
        ].map(n => [n.id, n])
      ),
      targets: ['t'],
      fuelCapacity: 0,
      timeCapacityPerSlot: 0,
      baseYield: new Map([
        ['a', 5],
        ['b', 1.5],
      ]),
    };
    // crafts limited by b: min(5/2, 1.5) = 1.5
    const crafts = 1.5;
    const expected = 1 - Math.exp(-crafts * targetQ(inst, 't'));

    const mine = evaluateAllocation(inst, []);
    expect(mine.expectedCrafts).toBeCloseTo(crafts, 9);
    expect(mine.probability).toBeCloseTo(expected, 9);

    const theirs = await runOptimizer(inst);
    expect(theirs.expectedCrafts).toBeCloseTo(crafts, 6);
    expect(theirs.craftProbability).toBeCloseTo(expected, 6);
    expect(theirs.bestProbability).toBeCloseTo(expected, 6);
  });

  test('direct legendary drops match closed form', async () => {
    const inst: OracleInstance = {
      label: 'probe',
      seed: 0,
      options: [makeOpt(2, 1, [], [['t', 0.125]])],
      dag: new Map([makeNode('a', true), makeNode('t', false, [['a', 1]], 0.4)].map(n => [n.id, n])),
      targets: ['t'],
      fuelCapacity: 6,
      timeCapacityPerSlot: 100,
      baseYield: new Map(),
    };
    // no craftable supply at all, so the only play is 3 launches of drops
    const expected = 1 - Math.exp(-3 * 0.125);
    const theirs = await runOptimizer(inst);
    expect(theirs.craftProbability).toBeCloseTo(0, 6);
    expect(theirs.dropProbability).toBeCloseTo(expected, 6);
    expect(theirs.bestProbability).toBeCloseTo(expected, 6);
    expect(evaluateAllocation(inst, [3]).probability).toBeCloseTo(expected, 9);
  });

  test('multi-level recipe matches closed form', async () => {
    const inst: OracleInstance = {
      label: 'probe',
      seed: 0,
      options: [],
      dag: new Map(
        [
          makeNode('a', true),
          makeNode('mid', false, [['a', 2]]),
          makeNode(
            't',
            false,
            [
              ['mid', 1],
              ['a', 1],
            ],
            0.3
          ),
        ].map(n => [n.id, n])
      ),
      targets: ['t'],
      fuelCapacity: 0,
      timeCapacityPerSlot: 0,
      baseYield: new Map([['a', 4]]),
    };
    // each craft consumes 1 mid (2a) + 1a = 3a, so crafts = 4/3
    const crafts = 4 / 3;
    const mine = evaluateAllocation(inst, []);
    expect(mine.expectedCrafts).toBeCloseTo(crafts, 9);
    const theirs = await runOptimizer(inst);
    expect(theirs.expectedCrafts).toBeCloseTo(crafts, 6);
    expect(theirs.bestProbability).toBeCloseTo(1 - Math.exp(-crafts * targetQ(inst, 't')), 6);
  });

  test('launch yields feed crafting', async () => {
    const inst: OracleInstance = {
      label: 'probe',
      seed: 0,
      options: [makeOpt(3, 1, [['a', 1.5]])],
      dag: new Map([makeNode('a', true), makeNode('t', false, [['a', 2]], 0.6)].map(n => [n.id, n])),
      targets: ['t'],
      fuelCapacity: 7,
      timeCapacityPerSlot: 100,
      baseYield: new Map([['a', 1]]),
    };
    // 2 launches -> inventory a = 1 + 3 = 4 -> crafts = 2
    const expected = 1 - Math.exp(-2 * targetQ(inst, 't'));
    const theirs = await runOptimizer(inst);
    expect(theirs.bestProbability).toBeCloseTo(expected, 6);
    expect(evaluateAllocation(inst, [2]).probability).toBeCloseTo(expected, 9);
  });

  test('multi-target allocation balances instead of favoring the higher-value target (joint/AND objective)', async () => {
    const inst: OracleInstance = {
      label: 'probe',
      seed: 0,
      options: [],
      dag: new Map(
        [makeNode('a', true), makeNode('t0', false, [['a', 1]], 0.5), makeNode('t1', false, [['a', 1]], 0.8)].map(n => [
          n.id,
          n,
        ])
      ),
      targets: ['t0', 't1'],
      fuelCapacity: 0,
      timeCapacityPerSlot: 0,
      baseYield: new Map([['a', 2]]),
    };
    const theirs = await runOptimizer(inst);
    const crafts = theirs.perTarget.map(p => p.expectedCrafts);
    expect(Math.min(...crafts)).toBeGreaterThan(0.5); // balanced, not all-or-nothing
    expect(theirs.jointProbability).toBeCloseTo(0.409536, 2);
  });

  test('three-target joint plan matches the independent oracle (n=3, exercises N-general Frank-Wolfe)', async () => {
    const inst: OracleInstance = {
      label: 'probe-n3',
      seed: 0,
      options: [makeOpt(2, 1, [['a', 2]]), makeOpt(3, 1, [['a', 3]])],
      dag: new Map(
        [
          makeNode('a', true),
          makeNode('t0', false, [['a', 1]], 0.5),
          makeNode('t1', false, [['a', 1]], 0.7),
          makeNode('t2', false, [['a', 1]], 0.3),
        ].map(n => [n.id, n])
      ),
      targets: ['t0', 't1', 't2'],
      fuelCapacity: 6,
      timeCapacityPerSlot: 3,
      baseYield: new Map([['a', 1]]),
    };
    assertNoFailures([await checkInstance(inst)]);
    const theirs = await runOptimizer(inst);
    const crafts = theirs.perTarget.map(p => p.expectedCrafts);
    expect(theirs.perTarget).toHaveLength(3);
    expect(Math.min(...crafts)).toBeGreaterThan(0); // every target gets a share
  });

  test('three-target joint plan where targets consume each other (n=3 dependency chain)', async () => {
    // Dependency chain: t0 feeds t1 feeds t2, so crafting up the chain
    // consumes the lower targets even though each craft is its own legendary
    // roll. A naive "split the shared ingredient" shortcut mishandles this.
    const inst: OracleInstance = {
      label: 'probe-chain',
      seed: 0,
      options: [makeOpt(2, 1, [['a', 3]]), makeOpt(3, 1, [['a', 5]])],
      dag: new Map(
        [
          makeNode('a', true),
          makeNode('t0', false, [['a', 1]], 0.4),
          makeNode(
            't1',
            false,
            [
              ['t0', 1],
              ['a', 1],
            ],
            0.5
          ),
          makeNode('t2', false, [['t1', 1]], 0.6),
        ].map(n => [n.id, n])
      ),
      targets: ['t0', 't1', 't2'],
      fuelCapacity: 6,
      timeCapacityPerSlot: 3,
      baseYield: new Map([['a', 2]]),
    };
    assertNoFailures([await checkInstance(inst)]);
    expect((await runOptimizer(inst)).perTarget).toHaveLength(3);
  });
});

// Everything above rests on the enumeration actually enumerating. Nothing else in the suite reads
// `feasibleCount` or `evaluatedCount`, so a `bruteForceBestJoint` that walked no further than the first leaf
// would return `bestJointProbability: 0` everywhere, hand every instance a gap of zero, and pass. These
// instances are sized so both counts follow from the constraints rather than from a recorded number.
describe('the enumeration behind the oracle', () => {
  const NUM_SLOTS = 3;
  // One craft per unit of 'a', so an allocation's value is just how much 'a' it buys.
  const oneForOne = (pCraft: number): RecipeDAG =>
    new Map([makeNode('a', true), makeNode('t', false, [['a', 1]], pCraft)].map(n => [n.id, n]));

  test('counts every feasible allocation and evaluates only the maximal ones', () => {
    const inst: OracleInstance = {
      label: 'enum-fuel',
      seed: 0,
      options: [makeOpt(2, 1, [['a', 1]]), makeOpt(1, 1, [['a', 1]])],
      dag: oneForOne(0.5),
      targets: ['t'],
      fuelCapacity: 4,
      // Three slots of two time units hold six one-unit missions and fuel pays for at most four, so packing
      // never binds: the feasible set is exactly the lattice under the fuel line.
      timeCapacityPerSlot: 2,
      baseYield: new Map(),
    };
    const feasible: number[][] = [];
    for (let a = 0; 2 * a <= inst.fuelCapacity; a++) {
      for (let b = 0; 2 * a + b <= inst.fuelCapacity; b++) {
        feasible.push([a, b]);
      }
    }
    const cheapestFuel = Math.min(...inst.options.map(o => o.actualFuel));
    const maximal = feasible.filter(([a, b]) => inst.fuelCapacity - (2 * a + b) < cheapestFuel);

    const res = bruteForceBestJoint(inst);
    expect(res.feasibleCount).toBe(feasible.length);
    expect(res.evaluatedCount).toBe(maximal.length);
    // Both options yield one 'a', so spending the fuel on the cheap one buys the most crafts.
    expect(res.bestAllocation).toEqual([0, 4]);
    expect(res.bestJointProbability).toBeCloseTo(1 - Math.exp(-4 * targetQ(inst, 't')), 12);
  });

  test('is stopped by the three-slot packing check, not by fuel', () => {
    const inst: OracleInstance = {
      label: 'enum-packing',
      seed: 0,
      // Two 3-unit missions never share a 4-unit slot, so the three slots hold three launches. Fuel would
      // pay for ten; if the enumeration ignored packing it would find them.
      options: [makeOpt(1, 3, [['a', 1]])],
      dag: oneForOne(0.5),
      targets: ['t'],
      fuelCapacity: 10,
      timeCapacityPerSlot: 4,
      baseYield: new Map(),
    };
    const res = bruteForceBestJoint(inst);
    expect(res.feasibleCount).toBe(NUM_SLOTS + 1); // 0..3 launches
    expect(res.evaluatedCount).toBe(1); // only the full three
    expect(res.bestAllocation).toEqual([NUM_SLOTS]);
    expect(res.bestJointProbability).toBeCloseTo(1 - Math.exp(-NUM_SLOTS * targetQ(inst, 't')), 12);
  });

  test('returns the ranking winner when every candidate is inside the absolute near-tie band', () => {
    const fuel = 12;
    const inst: OracleInstance = {
      label: 'enum-nearties',
      seed: 0,
      // Identical cost, and only the first option yields anything, so the enumeration walks from the worst
      // maximal allocation to the best and the winner is the very last one it sees.
      options: [makeOpt(1, 1, [['a', 1]]), makeOpt(1, 1, [])],
      // A craft probability this small puts every candidate's joint probability below RANKING_SLOP_JOINT,
      // which makes the whole field one near-tie. A finalist list bounded by arrival order then keeps the
      // eight worst and discards the winner.
      dag: oneForOne(1e-8),
      targets: ['t'],
      fuelCapacity: fuel,
      timeCapacityPerSlot: 4,
      baseYield: new Map(),
    };
    const res = bruteForceBestJoint(inst);
    // Every (x, y) with x + y <= fuel is feasible; the maximal ones are those that spend all of it.
    expect(res.feasibleCount).toBe(((fuel + 1) * (fuel + 2)) / 2);
    expect(res.evaluatedCount).toBe(fuel + 1);
    expect(res.bestJointProbability).toBeLessThan(RANKING_SLOP_JOINT);
    expect(res.bestAllocation).toEqual([fuel, 0]);
    expect(res.bestJointProbability).toBeCloseTo(1 - Math.exp(-fuel * targetQ(inst, 't')), 15);
  });
});

describe('oracle smoke fuzz', () => {
  test('optimizer within tolerance on smoke instances', async () => {
    const outcomes: InstanceOutcome[] = [];
    for (const family of FAMILIES) {
      for (let seed = 1; seed <= 3; seed++) {
        const inst = generateInstance(family, seed);
        if (inst) {
          outcomes.push(await checkInstance(inst, SMOKE_GAP_TOL));
        }
      }
    }
    console.log(summarize(outcomes));
    expect(outcomes.length).toBeGreaterThan(10);
    assertNoFailures(outcomes);
  }, 120_000);
});

describe.skipIf(!DEEP)('oracle deep fuzz', () => {
  test(
    'optimizer within tolerance across the full campaign',
    async () => {
      const started = Date.now();
      const outcomes: InstanceOutcome[] = [];
      let seed = SEED_BASE;
      let skipped = 0;
      outer: for (;;) {
        for (const family of FAMILIES) {
          if (Date.now() - started > BUDGET_MS) {
            break outer;
          }
          try {
            const inst = generateInstance(family as Family, seed);
            if (!inst) {
              skipped++;
              continue;
            }
            outcomes.push(await checkInstance(inst));
          } catch (err) {
            outcomes.push({
              family,
              seed,
              gap: NaN,
              failures: [{ family, seed, kind: 'harness', detail: String(err) }],
            });
          }
        }
        seed++;
      }
      console.log(summarize(outcomes));
      console.log(
        `deep fuzz: seeds ${SEED_BASE}..${seed}, ${skipped} oversized instances skipped, ` +
          `${((Date.now() - started) / 60_000).toFixed(1)} minutes`
      );
      expect(outcomes.length).toBeGreaterThan(50);
      assertNoFailures(outcomes);
    },
    BUDGET_MS + 5 * 60_000
  );
});
