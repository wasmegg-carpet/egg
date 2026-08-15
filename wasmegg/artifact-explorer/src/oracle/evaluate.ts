// Independent evaluator: the legendary probability of an integer launch allocation, re-derived from the
// documented objective. A float simplex ranks candidates; an exact BigInt-rational simplex produces the asserted numbers.

import type { CraftBudget, LaunchOption, RecipeDAG } from '../lib/types';
import { Frac } from './rational';
import { simplexMaximize, simplexMaximizeFloat, simplexMaximizeFloatFull } from './simplex';

export interface OracleInstance {
  label: string;
  seed: number;
  options: LaunchOption[];
  dag: RecipeDAG;
  targets: string[];
  fuelCapacity: number;
  timeCapacityPerSlot: number;
  baseYield: Map<string, number>;
  craftBudget?: CraftBudget;
}

export interface OracleEvaluation {
  score: number; // Q-weighted crafts + direct legendary drops
  lpScore: number; // Q-weighted crafts only
  drops: number;
  probability: number; // 1 - exp(-score)
  expectedCrafts: number | null; // single-target instances only
}

export function targetQ(inst: OracleInstance, target: string): number {
  const node = inst.dag.get(target);
  if (!node) {
    throw new Error(`target ${target} missing from DAG`);
  }
  return -Math.log(1 - node.legendaryCraftProbability);
}

interface LpTemplate {
  craftables: string[];
  items: string[];
  // The budget row is last, so `items` still indexes the conservation rows one-for-one.
  constraintMatrix: number[][];
  objectiveCoefficients: number[];
  budgetCapacity: number | null; // RHS of that row; null when uncapped
  // The same two in exact arithmetic, built on first use.
  constraintMatrixFrac: Frac[][] | null;
  objectiveCoefficientsFrac: Frac[] | null;
}

const templateCache = new WeakMap<OracleInstance, LpTemplate>();

function lpTemplate(inst: OracleInstance): LpTemplate {
  let template = templateCache.get(inst);
  if (template) {
    return template;
  }

  const craftables: string[] = [];
  for (const [id, node] of inst.dag) {
    if (!node.isLeaf) {
      craftables.push(id);
    }
  }
  const varIndex = new Map(craftables.map((id, i) => [id, i]));

  const ingredients = new Set<string>();
  for (const node of inst.dag.values()) {
    for (const child of node.children) {
      ingredients.add(child.nodeId);
    }
  }
  const items = [...ingredients];

  const constraintMatrix = items.map(item => {
    const row = new Array<number>(craftables.length).fill(0);
    for (const node of inst.dag.values()) {
      if (node.isLeaf) {
        continue;
      }
      const j = varIndex.get(node.id)!;
      for (const child of node.children) {
        if (child.nodeId === item) {
          row[j] += child.quantity;
        }
      }
    }
    const producer = varIndex.get(item);
    if (producer !== undefined) {
      row[producer] -= 1;
    }
    return row;
  });

  const objectiveCoefficients = new Array<number>(craftables.length).fill(0);
  for (const target of inst.targets) {
    const j = varIndex.get(target);
    if (j === undefined) {
      throw new Error(`target ${target} is not craftable`);
    }
    objectiveCoefficients[j] += targetQ(inst, target);
  }

  let budgetCapacity: number | null = null;
  const budget = inst.craftBudget;
  if (budget) {
    if (!Number.isFinite(budget.capacity) || budget.capacity < 0) {
      throw new Error(`craft budget capacity must be finite and non-negative, got ${budget.capacity}`);
    }
    const row = craftables.map(id => {
      const price = budget.unitPrices.get(id) ?? 0;
      return Number.isFinite(price) && price > 0 ? price : 0;
    });
    // No priced column is not a cap of zero: nothing here is known to cost anything, so nothing can consume the purse.
    if (row.some(p => p > 0)) {
      constraintMatrix.push(row);
      budgetCapacity = budget.capacity;
    }
  }

  template = {
    craftables,
    items,
    constraintMatrix,
    objectiveCoefficients,
    budgetCapacity,
    constraintMatrixFrac: null,
    objectiveCoefficientsFrac: null,
  };
  templateCache.set(inst, template);
  return template;
}

function rhsFloat(template: LpTemplate, inv: ReadonlyMap<string, number>): number[] {
  const b = template.items.map(item => inv.get(item) ?? 0);
  if (template.budgetCapacity !== null) b.push(template.budgetCapacity);
  return b;
}

function rhsFrac(template: LpTemplate, inv: ReadonlyMap<string, Frac>): Frac[] {
  const b = template.items.map(item => inv.get(item) ?? Frac.ZERO);
  // Prices and capacities are whole golden eggs, so the exact path stays exact.
  if (template.budgetCapacity !== null) b.push(Frac.fromNumber(template.budgetCapacity));
  return b;
}

function inventoryFor(inst: OracleInstance, allocation: number[]): Map<string, Frac> {
  const inv = new Map<string, Frac>();
  const bump = (item: string, amount: Frac) => {
    inv.set(item, (inv.get(item) ?? Frac.ZERO).add(amount));
  };
  for (const [item, qty] of inst.baseYield) {
    bump(item, Frac.fromNumber(qty));
  }
  inst.options.forEach((opt, i) => {
    if (allocation[i] === 0) {
      return;
    }
    const count = new Frac(BigInt(allocation[i]));
    for (const [item, qty] of opt.yieldVector) {
      bump(item, count.mul(Frac.fromNumber(qty)));
    }
  });
  return inv;
}

function directDrops(inst: OracleInstance, allocation: number[]): number {
  let drops = 0;
  inst.options.forEach((opt, i) => {
    for (const target of inst.targets) {
      drops += allocation[i] * (opt.legendaryYieldVector.get(target) ?? 0);
    }
  });
  return drops;
}

export function evaluateAllocationFloat(inst: OracleInstance, allocation: number[]): number {
  const template = lpTemplate(inst);
  const inv = new Map<string, number>();
  for (const [item, qty] of inst.baseYield) {
    inv.set(item, (inv.get(item) ?? 0) + qty);
  }
  inst.options.forEach((opt, i) => {
    if (allocation[i] === 0) {
      return;
    }
    for (const [item, qty] of opt.yieldVector) {
      inv.set(item, (inv.get(item) ?? 0) + allocation[i] * qty);
    }
  });
  return (
    simplexMaximizeFloat(template.constraintMatrix, rhsFloat(template, inv), template.objectiveCoefficients) +
    directDrops(inst, allocation)
  );
}

export function evaluateAllocation(inst: OracleInstance, allocation: number[]): OracleEvaluation {
  const template = lpTemplate(inst);
  if (!template.constraintMatrixFrac || !template.objectiveCoefficientsFrac) {
    template.constraintMatrixFrac = template.constraintMatrix.map(row => row.map(x => Frac.fromNumber(x)));
    template.objectiveCoefficientsFrac = template.objectiveCoefficients.map(x => Frac.fromNumber(x));
  }
  const inv = inventoryFor(inst, allocation);
  const b = rhsFrac(template, inv);

  const lpScore = simplexMaximize(template.constraintMatrixFrac, b, template.objectiveCoefficientsFrac).toNumber();
  const drops = directDrops(inst, allocation);
  const score = lpScore + drops;
  return {
    score,
    lpScore,
    drops,
    probability: 1 - Math.exp(-score),
    expectedCrafts: inst.targets.length === 1 ? lpScore / targetQ(inst, inst.targets[0]) : null,
  };
}

export interface OracleJointTargetResult {
  nodeId: string;
  score: number; // Q_T * craftCount_T + direct-drop lambda_T
  bestProbability: number; // 1 - exp(-score)
  expectedCrafts: number;
}

export interface OracleJointEvaluation {
  jointProbability: number;
  perTarget: OracleJointTargetResult[];
}

function directDropsFor(inst: OracleInstance, allocation: number[], target: string): number {
  let drops = 0;
  inst.options.forEach((opt, i) => {
    drops += allocation[i] * (opt.legendaryYieldVector.get(target) ?? 0);
  });
  return drops;
}

function logHitProbability(s: number): number {
  return s > 0 ? Math.log(-Math.expm1(-s)) : -Infinity;
}

function inventoryFloat(inst: OracleInstance, allocation: number[]): Map<string, number> {
  const inv = new Map<string, number>();
  for (const [item, qty] of inst.baseYield) {
    inv.set(item, (inv.get(item) ?? 0) + qty);
  }
  inst.options.forEach((opt, i) => {
    if (!allocation[i]) return;
    for (const [item, qty] of opt.yieldVector) {
      inv.set(item, (inv.get(item) ?? 0) + allocation[i] * qty);
    }
  });
  return inv;
}

const GOLDEN = (Math.sqrt(5) - 1) / 2;

// argmax of a unimodal (here: concave) f over [0, 1].
function goldenSectionArgmax(f: (x: number) => number, iters = 80): number {
  let a = 0;
  let b = 1;
  let c = b - GOLDEN * (b - a);
  let d = a + GOLDEN * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < iters; i++) {
    if (fc >= fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - GOLDEN * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + GOLDEN * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

interface FrontierVertexFloat {
  scores: number[];
  primal: number[];
}

function solveWeightedFloat(
  template: LpTemplate,
  b: number[],
  idxs: number[],
  Qs: number[],
  weights: number[]
): FrontierVertexFloat {
  const c = new Array<number>(template.craftables.length).fill(0);
  for (let i = 0; i < idxs.length; i++) {
    c[idxs[i]] = weights[i] * Qs[i];
  }
  const { primal } = simplexMaximizeFloatFull(template.constraintMatrix, b, c);
  const scores = idxs.map((idx, i) => Qs[i] * primal[idx]);
  return { scores, primal };
}

function jointGPrime(s: number): number {
  const CAP = 1e12;
  return s <= 0 ? CAP : Math.min(1 / Math.expm1(s), CAP);
}

interface JointOptimum {
  scores: number[]; // s_i = Q_i * craft_i + lambda_i, per target
  crafts: number[];
  logProb: number; // sum_i logHitProbability(s_i)
}

function optimizeJointFloat(
  template: LpTemplate,
  b: number[],
  idxs: number[],
  Qs: number[],
  lambdas: number[]
): JointOptimum {
  const n = idxs.length;
  interface ActiveVertex {
    crafts: number[];
    weight: number;
  }
  const active: ActiveVertex[] = [];
  for (let i = 0; i < n; i++) {
    const weights = new Array<number>(n).fill(0);
    weights[i] = 1;
    const vertex = solveWeightedFloat(template, b, idxs, Qs, weights);
    active.push({ crafts: idxs.map(idx => vertex.primal[idx]), weight: 1 / n });
  }
  const crafts = new Array<number>(n).fill(0);
  const recomputeCrafts = () => {
    crafts.fill(0);
    for (const av of active) {
      for (let i = 0; i < n; i++) crafts[i] += av.weight * av.crafts[i];
    }
  };
  recomputeCrafts();

  const VERTEX_TOL = 1e-9; // treat two vertices closer than this as identical
  const sameVertex = (a: number[], v: number[]) => a.every((ai, i) => Math.abs(ai - v[i]) < VERTEX_TOL);
  const dot = (grad: number[], v: number[]) => grad.reduce((s, g, i) => s + g * v[i], 0);

  const GAP_TOL = 1e-12;
  for (let iter = 0; iter < 2000; iter++) {
    const scores = crafts.map((craft, i) => Qs[i] * craft + lambdas[i]);
    const grad = scores.map((s, i) => jointGPrime(s) * Qs[i]);
    const c = new Array<number>(template.craftables.length).fill(0);
    for (let i = 0; i < n; i++) c[idxs[i]] = grad[i];
    const { primal } = simplexMaximizeFloatFull(template.constraintMatrix, b, c);
    const fwVertex = idxs.map(idx => primal[idx]);

    // FW duality gap: an upper bound on distance to the optimum.
    const gDotX = dot(grad, crafts);
    const gap = dot(grad, fwVertex) - gDotX;
    if (gap < GAP_TOL) break;

    let awayIdx = 0;
    let awayDotVal = Infinity;
    for (let k = 0; k < active.length; k++) {
      const v = dot(grad, active[k].crafts);
      if (v < awayDotVal) {
        awayDotVal = v;
        awayIdx = k;
      }
    }

    const fwDot = dot(grad, fwVertex) - gDotX; // == gap
    const awayDot = gDotX - awayDotVal;
    const away = active[awayIdx];
    const useFw = fwDot >= awayDot;
    const dir = useFw ? fwVertex.map((v, i) => v - crafts[i]) : crafts.map((cx, i) => cx - away.crafts[i]);
    const gammaMax = useFw ? 1 : away.weight / (1 - away.weight);

    const phi = (u: number) => {
      const gamma = u * gammaMax;
      let total = 0;
      for (let i = 0; i < n; i++) {
        total += logHitProbability(Qs[i] * (crafts[i] + gamma * dir[i]) + lambdas[i]);
      }
      return total;
    };
    const gamma = goldenSectionArgmax(phi, 100) * gammaMax;

    if (useFw) {
      for (const av of active) av.weight *= 1 - gamma;
      const hit = active.find(av => sameVertex(av.crafts, fwVertex));
      if (hit) hit.weight += gamma;
      else active.push({ crafts: fwVertex, weight: gamma });
    } else {
      for (const av of active) av.weight *= 1 + gamma;
      away.weight -= gamma;
    }
    for (let k = active.length - 1; k >= 0; k--) {
      if (active[k].weight <= VERTEX_TOL) active.splice(k, 1);
    }
    recomputeCrafts();
  }

  const scores = crafts.map((craft, i) => Qs[i] * craft + lambdas[i]);
  let logProb = 0;
  for (const s of scores) {
    logProb += logHitProbability(s);
  }
  return { scores, crafts, logProb };
}

function jointContext(inst: OracleInstance): {
  template: LpTemplate;
  idxs: number[];
  Qs: number[];
  targets: string[];
} {
  // n=1 never reaches here: both entry points short-circuit to the union evaluator.
  if (inst.targets.length < 2) {
    throw new Error(
      `jointContext requires 2+ targets (got ${inst.targets.length}); n=1 short-circuits to the union evaluator`
    );
  }
  const template = lpTemplate(inst);
  const idxs = inst.targets.map(t => template.craftables.indexOf(t));
  const missing = idxs.findIndex(idx => idx === -1);
  if (missing !== -1) {
    throw new Error(`target ${inst.targets[missing]} is not craftable`);
  }
  const Qs = inst.targets.map(t => targetQ(inst, t));
  return { template, idxs, Qs, targets: inst.targets };
}

export function evaluateAllocationJointFloat(inst: OracleInstance, allocation: number[]): number {
  if (inst.targets.length === 1) {
    return 1 - Math.exp(-evaluateAllocationFloat(inst, allocation));
  }
  const { template, idxs, Qs, targets } = jointContext(inst);
  const inv = inventoryFloat(inst, allocation);
  const b = rhsFloat(template, inv);
  const lambdas = targets.map(t => directDropsFor(inst, allocation, t));
  const { logProb } = optimizeJointFloat(template, b, idxs, Qs, lambdas);
  return Math.exp(logProb);
}

export function evaluateAllocationJoint(inst: OracleInstance, allocation: number[]): OracleJointEvaluation {
  if (inst.targets.length === 1) {
    const single = evaluateAllocation(inst, allocation);
    return {
      jointProbability: single.probability,
      perTarget: [
        {
          nodeId: inst.targets[0],
          score: single.score,
          bestProbability: single.probability,
          expectedCrafts: single.expectedCrafts ?? 0,
        },
      ],
    };
  }

  const { template, idxs, Qs, targets } = jointContext(inst);
  const inv = inventoryFloat(inst, allocation);
  const b = rhsFloat(template, inv);
  const lambdas = targets.map(t => directDropsFor(inst, allocation, t));

  const opt = optimizeJointFloat(template, b, idxs, Qs, lambdas);
  let jointProbability = 1;
  const perTarget: OracleJointTargetResult[] = targets.map((nodeId, i) => {
    const score = opt.scores[i];
    const bestProbability = score > 0 ? 1 - Math.exp(-score) : 0;
    jointProbability *= bestProbability;
    return { nodeId, score, bestProbability, expectedCrafts: opt.crafts[i] };
  });

  return { jointProbability, perTarget };
}
