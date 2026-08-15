// Arena invariant checks: properties a candidate must satisfy without knowing the optimum.
// Every comparison is a difference of logs, in nats; probability 0 is -Infinity.

import { ei, spaceshipList } from 'lib';
import { EFFORT_LAUNCH_PERIOD_SECONDS, EFFORT_LEVELS } from '@/store/schema';
import type { RecipeDAG } from '../../lib/types';
import type { Planner } from './contract';
import {
  budgetsOf,
  craftUnitPrices,
  feasible,
  fuelWithinCapacity,
  oracleInstanceOf,
  run,
  signature,
  type SolveOverrides,
  type Solved,
} from './harness';
import type { ArenaInstance } from './instances';
import { evaluateAllocationJoint, evaluateAllocationJointFloat } from '../evaluate';
import { mulberry32 } from '../generate';

const EXACT_NATS = 1e-9;
const REBUILT_NATS = 1e-6;
const ORDER_NATS = 1e-6;

const SHUFFLE_SEEDS = 3;
const DETERMINISM_REPEATS = 3;

const KOPT4_MAX_CANDIDATES = 32;
const KOPT_MAX_DELTA = 2;

const lg = (p: number): number => (p > 0 ? Math.log(p) : -Infinity);

function dropped(from: number, to: number, tol = ORDER_NATS): boolean {
  return lg(to) < lg(from) - tol;
}

function improved(base: number, candidate: number, tol = ORDER_NATS): boolean {
  return lg(candidate) > lg(base) + tol;
}

function differs(a: number, b: number, tol: number): boolean {
  const la = lg(a);
  const lb = lg(b);
  if (la === -Infinity && lb === -Infinity) return false;
  return Math.abs(la - lb) > tol;
}

// The arena's public vocabulary: these ids are written into `results/*.json` and
// ARENA.md, so the set is added to rather than renumbered. There is no B4.
export type InvariantId =
  | 'A1-fuel'
  | 'A2-time'
  | 'A3-menu'
  | 'A4-inventory'
  | 'A5-effort'
  | 'A6-zerog'
  | 'A7-crafting'
  | 'A8-targets'
  | 'A9-golden-eggs'
  | 'B1-option-order'
  | 'B2-target-order'
  | 'B3-fuel-scale'
  | 'B5-determinism'
  | 'B6-duplicate'
  | 'C0-contract'
  | 'C1-feasibility'
  | 'C1-inconclusive'
  | 'C2-honesty'
  | 'C3-joint-product'
  | 'M1-solo-product'
  | 'M2-projection'
  | 'M3-union'
  | LocalOptimalityId
  // `kOpt` reports these when it runs out of evaluation budget without finding an
  // improving move: not a verdict that the plan is locally optimal, just no answer.
  | `${LocalOptimalityId}-inconclusive`;

// The only ids `kOpt` is called with, narrowed so its `-inconclusive` suffix stays
// inside the declared vocabulary instead of widening it to any string.
export type LocalOptimalityId = 'D1-2opt' | 'D2-4opt';

// A check that throws is reported under its own function name rather than an id
// (`runChecks` below), and `invariants.spec.ts` hard-fails on the suffix, so the
// id space has to admit those too.
export type ViolationId = InvariantId | `${string}-threw`;

export interface Violation {
  invariant: ViolationId;
  instance: string;
  detail: string;
  nats?: number;
}

// In probability, not percentage: `toFixed(6)` on a percentage bottoms out at 1e-8 probability.
const PCT_FIXED_FLOOR = 1e-8;
const pct = (x: number) => (x < PCT_FIXED_FLOOR ? `${(x * 100).toExponential(3)}%` : `${(x * 100).toFixed(6)}%`);
const gap = (from: number, to: number) => `${(lg(to) - lg(from)).toFixed(4)} nats`;

export interface CheckContext {
  planner: Planner;
  inst: ArenaInstance;
  out: Violation[];
}

const solve = (c: CheckContext, over: SolveOverrides = {}): Solved => run(c.planner, c.inst, over);

function report(c: CheckContext, invariant: InvariantId, from: number, to: number, detail: string) {
  c.out.push({ invariant, instance: c.inst.label, detail, nats: lg(to) - lg(from) });
}

function reportFlat(c: CheckContext, invariant: InvariantId, detail: string) {
  c.out.push({ invariant, instance: c.inst.label, detail });
}

function monotone(id: InvariantId, c: CheckContext, axis: { label: string; over: SolveOverrides }[]) {
  let prev = -1;
  let prevLabel = '';
  for (const step of axis) {
    const p = solve(c, step.over).joint;
    if (prev >= 0 && dropped(prev, p)) {
      report(
        c,
        id,
        prev,
        p,
        `${step.label} gives ${pct(p)} but the more constrained ${prevLabel} gives ${pct(prev)} (${gap(prev, p)})`
      );
    }
    prev = p;
    prevLabel = step.label;
  }
}

export function checkA1Fuel(c: CheckContext) {
  monotone(
    'A1-fuel',
    c,
    [1, 1.05, 1.1, 1.25, 1.5, 2].map(m => ({
      label: `fuel x${m}`,
      over: { fuelCapacity: c.inst.fuelCapacity * m },
    }))
  );
}

export function checkA2Time(c: CheckContext) {
  monotone(
    'A2-time',
    c,
    [1, 1.05, 1.25, 1.5, 2].map(m => ({
      label: `time x${m}`,
      over: { timeCapacityPerSlot: Math.round(c.inst.timeCapacityPerSlot * m) },
    }))
  );
}

export function checkA9GoldenEggs(c: CheckContext) {
  const base = solve(c);
  const prices = craftUnitPrices(base.problem.dag, c.inst.previousCrafts);
  let anchor = 0;
  for (const t of base.judged.perTarget) {
    anchor += (prices.get(t.nodeId) ?? 0) * Math.max(0, t.expectedCrafts);
  }
  if (!(anchor > 0)) return;

  monotone('A9-golden-eggs', c, [
    ...[0.25, 0.5, 1, 2, 4].map(m => ({
      label: `golden eggs x${m}`,
      over: { craftBudget: { capacity: anchor * m, unitPrices: prices } } as SolveOverrides,
    })),
    { label: 'no golden egg cap', over: {} as SolveOverrides },
  ]);
}

export function checkA3Menu(c: CheckContext) {
  const full = solve(c).joint;
  for (const ship of spaceshipList) {
    if (!c.inst.config.shipVisibility[ship]) continue;
    const config = {
      ...c.inst.config,
      shipVisibility: { ...c.inst.config.shipVisibility, [ship]: false },
    };
    const sub = solve(c, { config }).joint;
    if (improved(full, sub)) {
      report(
        c,
        'A3-menu',
        full,
        sub,
        `hiding ${ei.MissionInfo.Spaceship[ship]} gives ${pct(sub)}, better than the full menu's ${pct(full)} (${gap(full, sub)})`
      );
    }
  }
}

function consumedNodeIds(dag: RecipeDAG): string[] {
  const consumed = new Set<string>();
  for (const node of dag.values()) {
    if (node.isLeaf) continue;
    for (const child of node.children) consumed.add(child.nodeId);
  }
  return [...consumed].sort();
}

export function checkA4Inventory(c: CheckContext) {
  const bare = solve(c);

  const consumed = consumedNodeIds(bare.problem.dag);

  const uniform = new Map<string, number>();
  for (const id of bare.problem.dag.keys()) {
    if (c.inst.targets.includes(id)) continue;
    uniform.set(id, 25);
  }

  const axis: { label: string; over: SolveOverrides }[] = [];
  if (consumed.length > 0) {
    const solo = consumed[c.inst.seed % consumed.length];
    axis.push({ label: `owning 25x ${solo} alone`, over: { baseYield: new Map([[solo, 25]]) } });
  }
  axis.push({ label: 'owning 25x of every ingredient', over: { baseYield: uniform } });

  for (const step of axis) {
    const p = solve(c, step.over).joint;
    if (dropped(bare.joint, p)) {
      report(
        c,
        'A4-inventory',
        bare.joint,
        p,
        `${step.label} gives ${pct(p)}, worse than owning nothing at ${pct(bare.joint)} (${gap(bare.joint, p)})`
      );
    }
  }
}

export function checkA5Effort(c: CheckContext) {
  const byPeriod = [...EFFORT_LEVELS].sort((a, b) => EFFORT_LAUNCH_PERIOD_SECONDS[b] - EFFORT_LAUNCH_PERIOD_SECONDS[a]);
  monotone(
    'A5-effort',
    c,
    byPeriod.map(e => ({ label: `effort=${e}`, over: { effort: e } }))
  );
}

export function checkA6Capacity(c: CheckContext) {
  monotone(
    'A6-zerog',
    c,
    [0, 3, 6, 10].map(lvl => ({
      label: `zero-g=${lvl}`,
      over: { config: { ...c.inst.config, epicResearchZerogLevel: lvl } },
    }))
  );
}

// Doubling from the floor to the game's max of 30, with 29 spliced in so the top pair is one level apart.
const A7_CRAFTING_LEVELS = [1, 2, 4, 8, 16, 29, 30];

export function checkA7CraftingLevel(c: CheckContext) {
  monotone(
    'A7-crafting',
    c,
    A7_CRAFTING_LEVELS.map(lvl => ({ label: `crafting=${lvl}`, over: { craftingLevel: lvl } }))
  );
}

export function checkA8Targets(c: CheckContext) {
  if (c.inst.targets.length < 2) return;
  const full = solve(c).joint;
  for (let i = 0; i < c.inst.targets.length; i++) {
    const fewer = c.inst.targets.filter((_, k) => k !== i);
    const p = solve(c, { targets: fewer }).joint;
    if (dropped(full, p)) {
      report(
        c,
        'A8-targets',
        full,
        p,
        `dropping ${c.inst.targets[i]} gives ${pct(p)}, worse than keeping it at ${pct(full)} (${gap(full, p)})`
      );
    }
  }
}

export function checkB1OptionOrder(c: CheckContext) {
  const base = solve(c).joint;
  for (let s = 1; s <= SHUFFLE_SEEDS; s++) {
    const rng = mulberry32(c.inst.seed * 31 + s);
    const p = solve(c, {
      transformOptions: options => {
        const sh = options.slice();
        for (let i = sh.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [sh[i], sh[j]] = [sh[j], sh[i]];
        }
        return sh;
      },
    }).joint;
    if (differs(base, p, EXACT_NATS)) {
      report(
        c,
        'B1-option-order',
        base,
        p,
        `shuffle ${s} gives ${pct(p)} vs ${pct(base)} in the enumerated order (${gap(base, p)})`
      );
    }
  }
}

export function checkB2TargetOrder(c: CheckContext) {
  if (c.inst.targets.length < 2) return;
  const base = solve(c).joint;
  const reversed = solve(c, { targets: [...c.inst.targets].reverse() }).joint;
  if (differs(base, reversed, EXACT_NATS)) {
    report(
      c,
      'B2-target-order',
      base,
      reversed,
      `reversing the target list gives ${pct(reversed)} vs ${pct(base)} (${gap(base, reversed)})`
    );
  }
}

export function checkB3FuelScale(c: CheckContext) {
  const base = solve(c).joint;
  // Powers of two, so the rescale is exact in binary floating point and a failure means conditioning, not rounding.
  for (const k of [0.25, 4]) {
    const p = solve(c, {
      fuelCapacity: c.inst.fuelCapacity * k,
      transformOptions: options =>
        options.map(o => ({
          ...o,
          actualFuel: o.actualFuel * k,
          fuelByEgg: new Map([...o.fuelByEgg].map(([e, v]) => [e, v * k])),
        })),
    }).joint;
    if (differs(base, p, REBUILT_NATS)) {
      report(
        c,
        'B3-fuel-scale',
        base,
        p,
        `scaling every fuel cost and the tank by ${k} gives ${pct(p)} vs ${pct(base)} (${gap(base, p)})`
      );
    }
  }
}

// There is no B4 and there never was. The ids are the arena's public vocabulary, so the slot stays
// vacant rather than renumbering every check `results/*.json` and ARENA.md are written against.
export function checkB5Determinism(c: CheckContext) {
  // `fresh` on every call: a cached plan compared against itself reports any planner deterministic.
  const first = solve(c, { fresh: true });
  const sig = signature(first);
  for (let k = 1; k < DETERMINISM_REPEATS; k++) {
    const again = solve(c, { fresh: true });
    if (signature(again) !== sig || again.joint !== first.joint) {
      report(
        c,
        'B5-determinism',
        first.joint,
        again.joint,
        `repeat ${k} returned a different plan (${pct(again.joint)} vs ${pct(first.joint)})`
      );
      return;
    }
  }
}

export function checkB6DuplicateOption(c: CheckContext) {
  const base = solve(c);
  if (base.problem.options.length === 0) return;
  const target = base.problem.options[Math.floor(base.problem.options.length / 2)];
  const duplicated = solve(c, {
    transformOptions: options => [...options, { ...target, id: `${target.id}::dup` }],
  });
  if (differs(base.joint, duplicated.joint, REBUILT_NATS)) {
    report(
      c,
      'B6-duplicate',
      base.joint,
      duplicated.joint,
      `duplicating ${target.ship.name} -> ${target.target ?? 'untargeted'} gives ${pct(duplicated.joint)} vs ${pct(base.joint)} (${gap(base.joint, duplicated.joint)})`
    );
  }
}

export function checkC0Contract(c: CheckContext) {
  const s = solve(c);
  for (const b of s.breaches) {
    reportFlat(c, 'C0-contract', b);
  }
}

export function checkC1Feasibility(c: CheckContext) {
  const s = solve(c);
  const b = budgetsOf(s.problem, s.allocation);
  if (!fuelWithinCapacity(b.fuel, s.problem.fuelCapacity)) {
    reportFlat(
      c,
      'C1-feasibility',
      `plan burns ${b.fuel.toExponential(4)} fuel against a ${s.problem.fuelCapacity.toExponential(4)} tank`
    );
  }
  if (b.pack === 'undecided') {
    reportFlat(
      c,
      'C1-inconclusive',
      `packing undecided within the node budget (${b.totalTime.toFixed(0)}s over ${s.problem.slots} slots of ${s.problem.timeCapacityPerSlot}s)`
    );
  } else if (b.pack !== 'packs') {
    reportFlat(
      c,
      'C1-feasibility',
      `plan does not pack into ${s.problem.slots} slots of ${s.problem.timeCapacityPerSlot}s (${b.totalTime.toFixed(0)}s total)`
    );
  }
}

export function checkC2Honesty(c: CheckContext) {
  const s = solve(c);
  if (!s.result.reported) return;
  const claimed = s.result.reported.jointProbability;
  const expected = s.joint;
  if (differs(claimed, expected, REBUILT_NATS)) {
    report(
      c,
      'C2-honesty',
      expected,
      claimed,
      `reported ${pct(claimed)} but an independent re-evaluation of the same allocation gives ${pct(expected)} (${gap(expected, claimed)})`
    );
  }
}

export function checkC3JointIsProduct(c: CheckContext) {
  const s = solve(c);
  if (!s.result.reported) return;
  const r = s.result.reported;
  if (r.perTarget.length !== s.problem.targets.length) return;
  const product = r.perTarget.reduce((a, p) => a * p, 1);
  if (differs(product, r.jointProbability, EXACT_NATS)) {
    report(
      c,
      'C3-joint-product',
      r.jointProbability,
      product,
      `reported jointProbability ${pct(r.jointProbability)} but the reported per-target factors multiply to ${pct(product)}`
    );
  }
}

export function checkM1M2SoloDominance(c: CheckContext) {
  if (c.inst.targets.length < 2) return;
  const joint = solve(c);
  if (joint.judged.perTarget.length !== c.inst.targets.length) {
    throw new Error(
      `arena: judged perTarget has ${joint.judged.perTarget.length} entries for ${c.inst.targets.length} target(s)`
    );
  }
  let product = 1;
  for (let i = 0; i < c.inst.targets.length; i++) {
    const t = c.inst.targets[i];
    const solo = solve(c, { targets: [t] }).joint;
    product *= solo;
    const fromJoint = joint.judged.perTarget[i].bestProbability;
    if (dropped(fromJoint, solo)) {
      report(
        c,
        'M2-projection',
        fromJoint,
        solo,
        `solo solve for ${t} reaches ${pct(solo)}, but the joint plan already reaches ${pct(fromJoint)} on it (${gap(fromJoint, solo)})`
      );
    }
  }
  if (improved(product, joint.joint)) {
    report(
      c,
      'M1-solo-product',
      product,
      joint.joint,
      `joint ${pct(joint.joint)} exceeds the product of solo optima ${pct(product)} (${gap(product, joint.joint)})`
    );
  }
}

export function checkM3UnionLowerBound(c: CheckContext) {
  const n = c.inst.targets.length;
  if (n < 2) return;
  const joint = solve(c);
  const oracleInst = oracleInstanceOf(joint.problem);

  const splits: number[][] = [new Array(n).fill(1 / n)];
  const skew = new Array(n).fill(0.5 / (n - 1));
  skew[c.inst.seed % n] = 0.5;
  splits.push(skew);

  for (const w of splits) {
    const union = new Array<number>(joint.problem.options.length).fill(0);
    for (let i = 0; i < n; i++) {
      const part = solve(c, {
        targets: [c.inst.targets[i]],
        fuelCapacity: c.inst.fuelCapacity * w[i],
        timeCapacityPerSlot: Math.floor(c.inst.timeCapacityPerSlot * w[i]),
      });
      part.allocation.forEach((count, idx) => {
        if (!(count > 0)) return;
        const o = part.problem.options[idx];
        const k = joint.problem.options.findIndex(
          q => q.ship.missionTypeId === o.ship.missionTypeId && q.targetAfxId === o.targetAfxId
        );
        if (k >= 0) union[k] += count;
      });
    }
    if (!feasible(joint.problem, union)) continue;
    const p = evaluateAllocationJoint(oracleInst, union).jointProbability;
    if (improved(joint.joint, p)) {
      report(
        c,
        'M3-union',
        joint.joint,
        p,
        `union of per-target plans at split [${w.map(x => x.toFixed(2)).join(',')}] reaches ${pct(p)}, ` +
          `beating the joint solve's ${pct(joint.joint)} (${gap(joint.joint, p)})`
      );
    }
  }
}

function kOpt(id: LocalOptimalityId, c: CheckContext, arity: 2 | 4, thresholdNats: number, maxEvals: number) {
  const s = solve(c);
  const alloc = s.allocation;
  const oracleInst = oracleInstanceOf(s.problem);
  const base = s.joint;
  if (!(base > 0)) return;

  const options = s.problem.options;
  const held: number[] = [];
  alloc.forEach((n, i) => n > 0 && held.push(i));
  if (held.length === 0) return;

  const heldShips = new Set(held.map(i => options[i].ship.shipType));
  const heldTargets = new Set(held.map(i => options[i].targetAfxId));
  const adjacency = (i: number) =>
    (heldShips.has(options[i].ship.shipType) ? 1 : 0) + (heldTargets.has(options[i].targetAfxId) ? 1 : 0);
  let addable: number[];
  if (arity === 2) {
    addable = options
      .map((_, i) => i)
      .filter(i => alloc[i] > 0 || options[i].targetAfxId !== ei.ArtifactSpec.Name.UNKNOWN);
  } else {
    addable = options
      .map((_, i) => i)
      .filter(i => alloc[i] > 0 || adjacency(i) > 0)
      .sort((a, b) => (alloc[b] > 0 ? 1 : 0) - (alloc[a] > 0 ? 1 : 0) || adjacency(b) - adjacency(a))
      .slice(0, KOPT4_MAX_CANDIDATES);
  }

  let evals = 0;
  let exhausted = false;
  let best = { p: evaluateAllocationJointFloat(oracleInst, alloc), alloc, detail: '' };
  const describe = (moves: [number, number][]) =>
    moves
      .map(([i, d]) => `${d > 0 ? '+' : ''}${d} ${options[i].ship.name}->${options[i].target ?? 'untargeted'}`)
      .join(', ');

  const tryAlloc = (a: number[], moves: [number, number][]) => {
    if (evals >= maxEvals) {
      exhausted = true;
      return;
    }
    // Charged before the feasibility test, not after: `feasible` runs the full packing search, so
    // charging only the candidates that pass leaves `maxEvals` bounding nothing.
    evals++;
    if (!feasible(s.problem, a)) return;
    const p = evaluateAllocationJointFloat(oracleInst, a);
    if (improved(best.p, p, thresholdNats)) best = { p, alloc: a, detail: describe(moves) };
  };

  // `exhausted` has to unwind every level; `tryAlloc` setting it is not enough on its own.
  pairs: for (const i of held) {
    for (let k = 1; k <= Math.min(alloc[i], KOPT_MAX_DELTA); k++) {
      for (const j of addable) {
        if (i === j) continue;
        for (let m = 1; m <= KOPT_MAX_DELTA; m++) {
          const a = alloc.slice();
          a[i] -= k;
          a[j] += m;
          tryAlloc(a, [
            [i, -k],
            [j, m],
          ]);
          if (exhausted) break pairs;
        }
      }
    }
  }

  if (arity === 4 && !exhausted) {
    quads: for (let x = 0; x < held.length; x++) {
      for (let y = x + 1; y < held.length; y++) {
        const i1 = held[x];
        const i2 = held[y];
        for (const j1 of addable) {
          for (const j2 of addable) {
            if (j1 === j2) continue;
            for (let k1 = 1; k1 <= Math.min(alloc[i1], KOPT_MAX_DELTA); k1++) {
              for (let k2 = 1; k2 <= Math.min(alloc[i2], KOPT_MAX_DELTA); k2++) {
                // (j1, j2) and (j2, j1) build the same allocation when the two exchanges move the same count.
                if (k1 === k2 && j2 < j1) continue;
                const a = alloc.slice();
                a[i1] -= k1;
                a[i2] -= k2;
                a[j1] += k1;
                a[j2] += k2;
                if (a[i1] < 0 || a[i2] < 0) continue;
                tryAlloc(a, [
                  [i1, -k1],
                  [j1, k1],
                  [i2, -k2],
                  [j2, k2],
                ]);
                if (exhausted) break quads;
              }
            }
          }
        }
      }
    }
  }

  if (best.detail) {
    const exact = evaluateAllocationJoint(oracleInst, best.alloc).jointProbability;
    report(c, id, base, exact, `${best.detail} improves ${pct(base)} to ${pct(exact)} (${gap(base, exact)})`);
  } else if (exhausted) {
    reportFlat(
      c,
      `${id}-inconclusive`,
      `search hit its ${maxEvals}-evaluation budget with ${held.length} held lines and ${addable.length} candidates; no improving move found, but the neighbourhood was not exhausted`
    );
  }
}

export function checkD1LocalOptimality(c: CheckContext) {
  // 1e-3 nats ~ 0.1% relative.
  kOpt('D1-2opt', c, 2, 1e-3, 20_000);
}

export function checkD2DeepLocalOptimality(c: CheckContext) {
  kOpt('D2-4opt', c, 4, 5e-3, 25_000);
}

export type Check = (c: CheckContext) => void;

export const CHEAP_CHECKS: Check[] = [
  checkC0Contract,
  checkC1Feasibility,
  checkC2Honesty,
  checkC3JointIsProduct,
  checkB5Determinism,
  checkB1OptionOrder,
  checkB2TargetOrder,
  checkB3FuelScale,
  checkB6DuplicateOption,
  checkA1Fuel,
  checkA2Time,
  checkA3Menu,
  checkA4Inventory,
  checkA5Effort,
  checkA6Capacity,
  checkA7CraftingLevel,
  checkA8Targets,
  checkA9GoldenEggs,
  checkM1M2SoloDominance,
  checkM3UnionLowerBound,
];

export const DEEP_CHECKS: Check[] = [checkD1LocalOptimality, checkD2DeepLocalOptimality];

export function runChecks(planner: Planner, inst: ArenaInstance, checks: Check[]): Violation[] {
  const out: Violation[] = [];
  for (const check of checks) {
    try {
      check({ planner, inst, out });
    } catch (err) {
      out.push({
        invariant: `${check.name}-threw`,
        instance: inst.label,
        detail: `threw: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return out;
}
