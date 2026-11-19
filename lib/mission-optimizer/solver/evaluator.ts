// The judge: the value in nats (natural-log units, so 0.69 nats is a factor of two) of an
// integer allocation over option groups. The arena grades the same allocations with an
// evaluator of its own (`tests/oracle/evaluate.ts`).

import type { Model } from './model';
import { gPrime, goldenSectionArgmax, logHit } from '../objective';
import { simplexMax, type SimplexSolution } from './simplex';

// The craft counts behind `scores`, and the figures `optimizer-core.ts` reports. Both come off the
// one point Frank-Wolfe settled on, so the plan the user is shown is the plan that was graded.
export interface CraftSplit {
  byCraftable: number[]; // pooled, parallel to `model.craftables`
  byTarget: number[]; // parallel to `model.sortedTargets`; 0 where a target has no craft column
}

export interface EvalResult {
  logJoint: number; // nats; -Infinity when any score is <= 0
  scores: number[]; // per target; +Infinity for a prob-1 craft
  crafts: CraftSplit;
}

// The craft LP the judge scores must be the one the MILP solved, budget row included
// (`milp.ts` adds the same row). Judging over the unbudgeted polytope scores craft splits the
// plan cannot afford, which shows up as an inflated `reported.jointProbability`.
interface CraftLp {
  rows: readonly (readonly number[])[];
  rhs: number[]; // inventory per item, then the budget capacity when the row is present
}

function craftLpOf(model: Model, inventoryByItem: number[]): CraftLp {
  if (!Number.isFinite(model.craftBudgetCapacity)) return { rows: model.consRows, rhs: inventoryByItem };
  return {
    rows: [...model.consRows, model.craftPrices],
    rhs: [...inventoryByItem, model.craftBudgetCapacity],
  };
}

// Every craft LP here is read as a maximum: a score, the Frank-Wolfe vertex whose gap certifies the
// stop, and the away-step decomposition that needs its members to be extreme points. A 'stalled'
// basis is none of those — it is feasible, and its objective is only a lower bound — so it ends the
// evaluation rather than being mistaken for one. There is nothing to retry with: the stall is a
// property of the tableau at that basis, and the only lever that could reach a different entering
// column is the pricing rule, which is what `simplexMax`'s finite-termination argument rests on.
// `solve.ts` catches this on both its paths, dropping the report or falling back to the empty plan.
// Measured at zero occurrences over the arena's four instances and 72 generated oracle ones.
function solveCraft(lp: CraftLp, c: number[]): SimplexSolution {
  const solution = simplexMax(lp.rows, lp.rhs, c);
  if (solution.status !== 'optimal') {
    throw new Error(`simplex: craft LP ${solution.status} with no optimality certificate`);
  }
  return solution;
}

function maxWeightedCraft(lp: CraftLp, nCraftables: number, idx: number, c0: number): SimplexSolution {
  const c = new Array<number>(nCraftables).fill(0);
  c[idx] = c0;
  return solveCraft(lp, c);
}

// Decided combinatorially rather than by the LP: the float LP answers "0 or
// positive?" with ~1e-30 crafts, which score as -70 nats where the oracle evaluator says -Infinity.
function craftAvailable(model: Model, inventoryByItem: readonly number[], root: number): boolean {
  const memo = new Array<number>(model.craftables.length).fill(-1);
  const visit = (p: number): boolean => {
    if (memo[p] >= 0) return memo[p] === 1;
    // Cycle guard. Game recipe data is acyclic; this makes a cycle read as "not craftable"
    // rather than recurse.
    memo[p] = 0;
    let ok = true;
    for (const child of model.craftChildren[p]) {
      if (!(inventoryByItem[child.itemIdx] > 0) && !(child.childCraft >= 0 && visit(child.childCraft))) {
        ok = false;
        break;
      }
    }
    memo[p] = ok ? 1 : 0;
    return ok;
  };
  return visit(root);
}

// The pooled craft vector is the convex combination the active set already describes, kept whole
// rather than projected onto the target columns: `optimizer-core.ts` prints the shared intermediates
// too, and a point assembled from the same weights is a point of the polytope, so what it reports of
// a shared node is what the plan it was graded on actually crafts.
function optimizeJointCrafts(
  model: Model,
  lp: CraftLp,
  idxs: number[],
  Qs: number[],
  legendaryDropsByTarget: number[],
  gapTol: number,
  maxIters: number
): { scores: number[]; pooled: number[] } {
  const n = idxs.length;
  const nCraftables = model.craftables.length;

  interface ActiveVertex {
    crafts: number[]; // over craftables
    weight: number;
  }
  const solveWeighted = (weights: number[]): number[] => {
    const c = new Array<number>(nCraftables).fill(0);
    for (let i = 0; i < n; i++) c[idxs[i]] = weights[i] * Qs[i];
    return solveCraft(lp, c).primal;
  };

  const active: ActiveVertex[] = [];
  for (let i = 0; i < n; i++) {
    const weights = new Array<number>(n).fill(0);
    weights[i] = 1;
    active.push({ crafts: solveWeighted(weights), weight: 1 / n });
  }
  const pooled = new Array<number>(nCraftables).fill(0);
  const recomputeCrafts = () => {
    pooled.fill(0);
    for (const av of active) {
      for (let j = 0; j < nCraftables; j++) pooled[j] += av.weight * av.crafts[j];
    }
  };
  recomputeCrafts();
  const at = (i: number) => pooled[idxs[i]];

  const VERTEX_TOL = 1e-9;
  // On the target columns alone, which is what the iterate's objective is a function of. Two vertices
  // agreeing there differ only in how they route shared ingredients, and merging them holds every
  // score fixed while leaving the combination a point of the polytope.
  const sameVertex = (a: number[], v: number[]) => idxs.every(idx => Math.abs(a[idx] - v[idx]) < VERTEX_TOL);
  // grad is indexed by target, the vectors it meets by craftable.
  const dot = (u: number[], v: number[]) => u.reduce((s, x, i) => s + x * v[idxs[i]], 0);

  // Away-step Frank-Wolfe over the craft LP's feasible set, whose vertices `solveCraft` returns
  // (SPEC.md's introduction for the method). The away step is not optional here: plain Frank-Wolfe
  // zig-zags when the optimum sits inside a face of the polytope, which is exactly what happens
  // when one target is another's ingredient.
  //
  // `active` is the price of that step: the iterate written as a convex combination of vertices, so
  // there is a worst one to retreat from, and `pooled` is that combination evaluated. Retreating
  // raises every other vertex's weight, which is why the away step is capped at `gammaMax` — past it
  // the vertex being left would go negative. With a single active vertex that cap is meaningless, so
  // a lone vertex must take the plain step; the loop asserts rather than branches on it below.
  for (let iter = 0; iter < maxIters; iter++) {
    const scores = idxs.map((_, i) => Qs[i] * at(i) + legendaryDropsByTarget[i]);
    const grad = scores.map((s, i) => gPrime(s) * Qs[i]);
    const c = new Array<number>(nCraftables).fill(0);
    for (let i = 0; i < n; i++) c[idxs[i]] = grad[i];
    const fwVertex = solveCraft(lp, c).primal;

    const gDotX = grad.reduce((s, g, i) => s + g * at(i), 0);
    const gap = dot(grad, fwVertex) - gDotX;
    if (gap < gapTol) break;

    let awayIdx = 0;
    let awayDotVal = Infinity;
    for (let k = 0; k < active.length; k++) {
      const v = dot(grad, active[k].crafts);
      if (v < awayDotVal) {
        awayDotVal = v;
        awayIdx = k;
      }
    }

    const fwDot = gap;
    const awayDot = gDotX - awayDotVal;
    const away = active[awayIdx];
    // The first clause is an assertion, not a branch: with one active vertex `gammaMax` below would be
    // w/(1 - w) on that vertex's own weight and every craft would come back NaN. It cannot be reached,
    // because the iterate is then w * v with w <= 1 and both `grad` and `v` non-negative, which makes
    // awayDot = (w - 1) * grad.v <= 0 < gap.
    const useFw = active.length === 1 || fwDot >= awayDot;
    // Over the target columns only: the line search reads nothing else, and the active set's weights
    // carry the rest of the move.
    const dir = idxs.map((idx, i) => (useFw ? fwVertex[idx] - at(i) : at(i) - away.crafts[idx]));
    const gammaMax = useFw ? 1 : away.weight / (1 - away.weight);

    const phi = (u: number) => {
      const gamma = u * gammaMax;
      let total = 0;
      for (let i = 0; i < n; i++) {
        total += logHit(Qs[i] * (at(i) + gamma * dir[i]) + legendaryDropsByTarget[i]);
      }
      return total;
    };
    const u = goldenSectionArgmax(phi, 100);
    // The stop that needs no scale, comparing the objective to itself where `gap` is an absolute number
    // of nats. Both are kept: `gap` is the certificate and ends a well-scaled solve in a few iterations,
    // but it cannot end one where `gPrime` is capped for every target (`../objective.ts`, SPEC.md section
    // 4) — the gradient is a constant there, so the vertex it points at never moves and the gap floors
    // above any tolerance while the line search already has nothing left to find.
    if (!(phi(u) > phi(0))) break;
    const gamma = u * gammaMax;

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

  return { scores: idxs.map((_, i) => Qs[i] * at(i) + legendaryDropsByTarget[i]), pooled };
}

export interface EvalPrecision {
  gapTol: number; // in nats
  maxIters: number;
}

// The judge's constants; the default so parity and the reported numbers hold.
export const EXACT_PRECISION: EvalPrecision = { gapTol: 1e-12, maxIters: 2000 };

export const STEERING_PRECISION: EvalPrecision = { gapTol: 1e-7, maxIters: 600 };

interface Inventory {
  inventoryByItem: number[];
  legendaryDropsByTarget: number[];
}

function inventoryOf(model: Model, counts: readonly number[]): Inventory {
  const nTargets = model.sortedTargets.length;
  const inventoryByItem = model.baseInventoryByItem.slice();
  const legendaryDropsByTarget = new Array<number>(nTargets).fill(0);
  for (let g = 0; g < model.groups.length; g++) {
    const n = counts[g];
    if (!(n > 0)) continue;
    const grp = model.groups[g];
    for (let i = 0; i < inventoryByItem.length; i++) inventoryByItem[i] += n * grp.yieldByItem[i];
    for (let t = 0; t < nTargets; t++) legendaryDropsByTarget[t] += n * grp.legendaryByTarget[t];
  }
  return { inventoryByItem, legendaryDropsByTarget };
}

export function evaluateCounts(
  model: Model,
  counts: readonly number[],
  precision: EvalPrecision = EXACT_PRECISION
): EvalResult {
  const { inventoryByItem, legendaryDropsByTarget } = inventoryOf(model, counts);
  return evaluateAt(model, inventoryByItem, legendaryDropsByTarget, precision);
}

function evaluateAt(
  model: Model,
  inventoryByItem: number[],
  legendaryDropsByTarget: readonly number[],
  precision: EvalPrecision
): EvalResult {
  const Qs = model.Qs;
  const nTargets = model.sortedTargets.length;
  const lp = craftLpOf(model, inventoryByItem);
  const nCraftables = model.craftables.length;
  const scores = new Array<number>(nTargets).fill(0);
  const byCraftable = new Array<number>(nCraftables).fill(0);
  const byTarget = new Array<number>(nTargets).fill(0);
  const fwIdx: number[] = [];
  const certain: number[] = [];
  for (let t = 0; t < nTargets; t++) {
    const idx = model.targetCraftIdx[t];
    if (idx < 0 || !craftAvailable(model, inventoryByItem, idx)) {
      scores[t] = legendaryDropsByTarget[t];
    } else if (Qs[t] === Infinity) {
      // Any craft_T > 0 gives p_T = 1; an infinitesimal craft consumes an infinitesimal inventory,
      // so it never competes with other targets. A budget of exactly 0 is the one case where
      // "infinitesimal" is still too much, so the claim is checked against the LP rather than
      // asserted — and the same solve is what gives the count this target reports.
      const solution = maxWeightedCraft(lp, nCraftables, idx, 1);
      if (solution.objective > 0) {
        scores[t] = Infinity;
        byTarget[t] = solution.primal[idx];
        certain.push(t);
      } else {
        scores[t] = legendaryDropsByTarget[t];
      }
    } else {
      fwIdx.push(t);
    }
  }

  if (fwIdx.length === 1) {
    const t = fwIdx[0];
    const idx = model.targetCraftIdx[t];
    const solution = maxWeightedCraft(lp, nCraftables, idx, Qs[t]);
    scores[t] = solution.objective + legendaryDropsByTarget[t];
    byTarget[t] = solution.primal[idx];
    for (let j = 0; j < nCraftables; j++) byCraftable[j] = solution.primal[j];
  } else if (fwIdx.length > 1) {
    const joint = optimizeJointCrafts(
      model,
      lp,
      fwIdx.map(t => model.targetCraftIdx[t]),
      fwIdx.map(t => Qs[t]),
      fwIdx.map(t => legendaryDropsByTarget[t]),
      precision.gapTol,
      precision.maxIters
    );
    fwIdx.forEach((t, i) => {
      scores[t] = joint.scores[i];
      byTarget[t] = joint.pooled[model.targetCraftIdx[t]];
    });
    for (let j = 0; j < nCraftables; j++) byCraftable[j] = joint.pooled[j];
  } else if (certain.length > 0) {
    // Nothing else draws on the polytope, so one solve over the certain targets together is the
    // pooled point, and the counts it gives them are a point of that polytope rather than each
    // target's own maximum. Where both kinds are present the pooled vector stays the finite
    // targets': a certain target is scored on a craft the model calls infinitesimal, and pooling
    // that number would bill the plan for inventory it was never charged. Only reachable through a
    // synthetic recipe — game data caps a craft's legendary odds at 10%.
    const c = new Array<number>(nCraftables).fill(0);
    for (const t of certain) c[model.targetCraftIdx[t]] = 1;
    const { primal } = solveCraft(lp, c);
    for (const t of certain) byTarget[t] = primal[model.targetCraftIdx[t]];
    for (let j = 0; j < nCraftables; j++) byCraftable[j] = primal[j];
  }

  let logJoint = 0;
  for (const s of scores) logJoint += logHit(s);
  return { logJoint, scores, crafts: { byCraftable, byTarget } };
}
