// Inner crafting LPs over the recipe-conservation polytope. Every node consumed by some parent gets a
// conservation row; a final target has none, so dropped copies of it do not count as crafts.

import type { RecipeDAG } from './types';
import { gPrime, goldenSectionArgmax, logHit } from './concave';
import { solveLp } from './lp';
export interface AlphaResult {
  alpha: number; // craftable count of targets[0]; 0 when it's a leaf
  craftByTarget: Map<string, number>;
  primalByNode: Map<string, number>; // crafted count per non-leaf node
}

export interface InnerLp {
  readonly nonLeafNodes: readonly string[]; // decision variable order
  readonly constraintNodes: readonly string[]; // constraint row order
  readonly varIndex: ReadonlyMap<string, number>;
  readonly root: string;
  readonly targets: readonly string[];
  readonly weightByTarget: ReadonlyMap<string, number>;

  solve(inventory: Map<string, number>): AlphaResult;
}

// Targets absent from `weights` get weight 1.
export function compileInnerLp(
  recipeDag: RecipeDAG,
  desiredArtifactNodeIds: string[],
  weights?: Map<string, number>
): InnerLp {
  if (desiredArtifactNodeIds.length === 0) {
    return makeTrivialLp('', [], new Map());
  }
  const targets = desiredArtifactNodeIds;
  const primary = targets[0];

  const nonLeafNodes: string[] = [];
  const varIndex = new Map<string, number>();
  for (const [id, node] of recipeDag) {
    if (!node.isLeaf) {
      varIndex.set(id, nonLeafNodes.length);
      nonLeafNodes.push(id);
    }
  }

  // A leaf target contributes no objective term; its legendary chance is
  // drops-only.
  const weightByTarget = new Map<string, number>();
  for (const t of targets) {
    if (varIndex.has(t)) weightByTarget.set(t, weights?.get(t) ?? 1);
  }
  if (weightByTarget.size === 0) {
    // nothing craftable; fall back to holdings of the primary target
    return makeTrivialLp(primary, targets, weightByTarget);
  }

  const parentsOf = new Map<string, { parent: string; q: number }[]>();
  for (const [parentId, parentNode] of recipeDag) {
    if (parentNode.isLeaf) continue;
    for (const child of parentNode.children) {
      let parents = parentsOf.get(child.nodeId);
      if (!parents) {
        parents = [];
        parentsOf.set(child.nodeId, parents);
      }
      parents.push({ parent: parentId, q: child.quantity });
    }
  }

  const constraintNodes: string[] = [];
  for (const id of recipeDag.keys()) {
    const parents = parentsOf.get(id);
    if (!parents || parents.length === 0) continue;
    constraintNodes.push(id);
  }

  const nVars = nonLeafNodes.length;
  const nCons = constraintNodes.length;

  const c = new Float64Array(nVars);
  for (const [t, w] of weightByTarget) c[varIndex.get(t)!] = w;

  const A: Float64Array[] = new Array(nCons);
  for (let i = 0; i < nCons; i++) {
    const id = constraintNodes[i];
    const row = new Float64Array(nVars);
    const parents = parentsOf.get(id) ?? [];
    for (const { parent, q } of parents) {
      const idx = varIndex.get(parent);
      if (idx !== undefined) row[idx] += q;
    }
    if (varIndex.has(id)) row[varIndex.get(id)!] -= 1;
    A[i] = row;
  }

  const bScratch = new Float64Array(nCons);

  return {
    nonLeafNodes,
    constraintNodes,
    varIndex,
    root: primary,
    targets,
    weightByTarget,

    solve(inventory: Map<string, number>): AlphaResult {
      for (let i = 0; i < nCons; i++) {
        const v = inventory.get(constraintNodes[i]);
        bScratch[i] = v !== undefined && v > 0 ? v : 0;
      }
      const r = solveLp(c, A, bScratch);
      if (r.status !== 'optimal') {
        return { alpha: 0, craftByTarget: new Map(), primalByNode: new Map() };
      }
      const craftByTarget = new Map<string, number>();
      for (const t of weightByTarget.keys()) {
        craftByTarget.set(t, r.primal[varIndex.get(t)!]);
      }
      const primalByNode = new Map<string, number>();
      for (let i = 0; i < nonLeafNodes.length; i++) {
        if (r.primal[i] > 1e-9) {
          primalByNode.set(nonLeafNodes[i], r.primal[i]);
        }
      }
      return { alpha: craftByTarget.get(primary) ?? 0, craftByTarget, primalByNode };
    },
  };
}

function makeTrivialLp(primary: string, targets: readonly string[], weightByTarget: Map<string, number>): InnerLp {
  return {
    nonLeafNodes: [],
    constraintNodes: [],
    varIndex: new Map(),
    root: primary,
    targets,
    weightByTarget,
    solve(inventory: Map<string, number>): AlphaResult {
      const v = inventory.get(primary) ?? 0;
      return { alpha: v > 0 ? v : 0, craftByTarget: new Map(), primalByNode: new Map() };
    },
  };
}

export interface ProbabilityFields {
  bestProbability: number;
  craftProbability: number;
  dropProbability: number;
}

export function alphaToProb(
  alpha: number,
  legendaryYield: Map<string, number>,
  desiredArtifactNodeIds: string[],
  recipeDag: RecipeDAG
): ProbabilityFields {
  if (desiredArtifactNodeIds.length === 0) {
    return { bestProbability: 0, craftProbability: 0, dropProbability: 0 };
  }
  const root = desiredArtifactNodeIds[0];
  const node = recipeDag.get(root);
  const pCraft = node?.legendaryCraftProbability ?? 0;

  const a = alpha > 0 ? alpha : 0;
  let craftProbability = 0;
  if (pCraft > 0 && a > 0) {
    if (pCraft >= 1) craftProbability = 1;
    else craftProbability = 1 - Math.exp(a * Math.log(1 - pCraft));
  }

  const lambda = legendaryYield.get(root) ?? 0;
  const dropProbability = lambda > 0 ? 1 - Math.exp(-lambda) : 0;

  const bestProbability = 1 - (1 - craftProbability) * (1 - dropProbability);

  return { bestProbability, craftProbability: craftProbability, dropProbability };
}

// Tangent points for the outer approximation of g(s). The envelope OVER-estimates g: safe for search
// ranking only, never for reporting. Transcribed rather than generated, so the seed LP's matrix does not move.
const JOINT_TANGENT_BREAKPOINTS: readonly number[] = [
  1e-5, 1.8271e-5, 3.3383e-5, 6.09941e-5, 0.000111443, 0.000203617, 0.000372029, 0.000679734, 0.00124194, 0.00226916,
  0.00414598, 0.00757513, 0.0138405, 0.0252881, 0.0462038, 0.0844191, 0.154242, 0.281816, 0.514907, 0.940788, 1.71892,
  3.14063, 5.73826, 10.4844, 19.156, 35,
];

interface Tangent {
  alpha: number;
  beta: number;
}

const JOINT_TANGENTS: readonly Tangent[] = JOINT_TANGENT_BREAKPOINTS.map(s => {
  const beta = 1 / Math.expm1(s);
  return { alpha: logHit(s) - beta * s, beta };
});

// z_T is negative (g(s) < 0 everywhere) but lp.ts assumes x >= 0, so every z_T is shifted up by
// this much. Only the LP's primal is read and the shift does not move the argmax, so nothing undoes it.
const ENVELOPE_SHIFT = 50;

export interface JointAlphaResult {
  craftByTarget: Map<string, number>; // absent for a leaf target, mirroring compileInnerLp
  primalByNode: Map<string, number>;
}

export interface JointInnerLp {
  readonly nonLeafNodes: readonly string[];
  readonly constraintNodes: readonly string[]; // conservation rows only, in b's row order
  readonly varIndex: ReadonlyMap<string, number>;
  readonly targets: readonly string[];

  solve(inventory: Map<string, number>, lambda: Map<string, number>): JointAlphaResult;
}

// The craft-conservation LP with one envelope variable z_T per target. lambda
// enters inside each tangent expression, never as one pooled scalar outside.
export function compileJointInnerLp(
  recipeDag: RecipeDAG,
  desiredArtifactNodeIds: string[],
  QByTarget: ReadonlyMap<string, number>
): JointInnerLp {
  const targets = desiredArtifactNodeIds;
  const nt = targets.length;

  const nonLeafNodes: string[] = [];
  const varIndex = new Map<string, number>();
  for (const [id, node] of recipeDag) {
    if (!node.isLeaf) {
      varIndex.set(id, nonLeafNodes.length);
      nonLeafNodes.push(id);
    }
  }

  const parentsOf = new Map<string, { parent: string; q: number }[]>();
  for (const [parentId, parentNode] of recipeDag) {
    if (parentNode.isLeaf) continue;
    for (const child of parentNode.children) {
      let parents = parentsOf.get(child.nodeId);
      if (!parents) {
        parents = [];
        parentsOf.set(child.nodeId, parents);
      }
      parents.push({ parent: parentId, q: child.quantity });
    }
  }

  const constraintNodes: string[] = [];
  for (const id of recipeDag.keys()) {
    const parents = parentsOf.get(id);
    if (!parents || parents.length === 0) continue;
    constraintNodes.push(id);
  }

  const nVars = nonLeafNodes.length;
  const nCons = constraintNodes.length;
  const totalVars = nVars + nt;
  const zBase = nVars;

  const c = new Float64Array(totalVars);
  for (let i = 0; i < nt; i++) c[zBase + i] = 1;

  const A: Float64Array[] = [];
  for (let i = 0; i < nCons; i++) {
    const id = constraintNodes[i];
    const row = new Float64Array(totalVars);
    const parents = parentsOf.get(id) ?? [];
    for (const { parent, q } of parents) {
      const idx = varIndex.get(parent);
      if (idx !== undefined) row[idx] += q;
    }
    if (varIndex.has(id)) row[varIndex.get(id)!] -= 1;
    A.push(row);
  }

  const rowTargetIdx: number[] = [];
  const rowTangentIdx: number[] = [];
  for (let ti = 0; ti < nt; ti++) {
    const t = targets[ti];
    const q = QByTarget.get(t) ?? 0;
    const pIdx = varIndex.get(t);
    for (let k = 0; k < JOINT_TANGENTS.length; k++) {
      const row = new Float64Array(totalVars);
      row[zBase + ti] = 1;
      if (pIdx !== undefined && q !== 0) row[pIdx] = -JOINT_TANGENTS[k].beta * q;
      A.push(row);
      rowTargetIdx.push(ti);
      rowTangentIdx.push(k);
    }
  }

  const nRows = A.length;
  const bScratch = new Float64Array(nRows);

  function fillEnvelopeB(lambda: Float64Array) {
    for (let r = 0; r < rowTargetIdx.length; r++) {
      const ti = rowTargetIdx[r];
      const k = rowTangentIdx[r];
      bScratch[nCons + r] = JOINT_TANGENTS[k].alpha + ENVELOPE_SHIFT + JOINT_TANGENTS[k].beta * lambda[ti];
    }
  }

  return {
    nonLeafNodes,
    constraintNodes,
    varIndex,
    targets,

    solve(inventory: Map<string, number>, lambdaMap: Map<string, number>): JointAlphaResult {
      for (let i = 0; i < nCons; i++) {
        const v = inventory.get(constraintNodes[i]);
        bScratch[i] = v !== undefined && v > 0 ? v : 0;
      }
      const lambda = new Float64Array(nt);
      for (let i = 0; i < nt; i++) lambda[i] = lambdaMap.get(targets[i]) ?? 0;
      fillEnvelopeB(lambda);
      const r = solveLp(c, A, bScratch);
      const craftByTarget = new Map<string, number>();
      const primalByNode = new Map<string, number>();
      if (r.status === 'optimal') {
        for (let ti = 0; ti < nt; ti++) {
          const idx = varIndex.get(targets[ti]);
          if (idx !== undefined) craftByTarget.set(targets[ti], r.primal[idx]);
        }
        for (let i = 0; i < nVars; i++) {
          if (r.primal[i] > 1e-9) primalByNode.set(nonLeafNodes[i], r.primal[i]);
        }
      }
      return { craftByTarget, primalByNode };
    },
  };
}

// Recovers the per-target craft split maximizing the EXACT objective at a fixed inventory.
// Runs once per returned solution, never in the search loop.
export function refineJointCraftSplit(
  recipeDag: RecipeDAG,
  targets: readonly string[],
  QByTarget: ReadonlyMap<string, number>,
  inventory: Map<string, number>,
  lambda: ReadonlyMap<string, number>,
  seed: JointAlphaResult
): JointAlphaResult {
  // A leaf or Q=0 target's score does not depend on the craft allocation, so
  // it sits out the split and its seed value is reported unchanged.
  const craftTargets = targets.filter(t => !(recipeDag.get(t)?.isLeaf ?? true) && (QByTarget.get(t) ?? 0) > 0);
  if (craftTargets.length === 0) {
    return { craftByTarget: new Map(seed.craftByTarget), primalByNode: new Map(seed.primalByNode) };
  }

  const Q = (t: string) => QByTarget.get(t) ?? 0;
  const lam = (t: string) => lambda.get(t) ?? 0;

  let currentPrimal = new Map(seed.primalByNode);
  let currentCraft = new Map<string, number>();
  for (const t of craftTargets) {
    currentCraft.set(t, seed.craftByTarget.get(t) ?? currentPrimal.get(t) ?? 0);
  }

  const TIGHT = 1e-11; // convergence when no target's score moves more than this
  const MAX_ITERS = 100;

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    // weight_T = g'(score_T)*Q_T; the Q_T factor is the chain rule and dropping
    // it linearizes against the wrong gradient when targets differ in Q.
    const weights = new Map<string, number>();
    for (const t of craftTargets) {
      const s = Q(t) * (currentCraft.get(t) ?? 0) + lam(t);
      weights.set(t, gPrime(s) * Q(t));
    }
    const lp = compileInnerLp(recipeDag, [...craftTargets], weights);
    const nonLeafNodes = lp.nonLeafNodes;
    const vertex = lp.solve(inventory);

    const s0 = craftTargets.map(t => Q(t) * (currentCraft.get(t) ?? 0) + lam(t));
    const s1 = craftTargets.map(t => Q(t) * (vertex.craftByTarget.get(t) ?? 0) + lam(t));
    const phi = (t: number) => {
      let sum = 0;
      for (let i = 0; i < craftTargets.length; i++) {
        const gv = logHit(s0[i] + t * (s1[i] - s0[i]));
        if (gv === -Infinity) return -Infinity;
        sum += gv;
      }
      return sum;
    };
    // Golden section only converges *toward* an endpoint, stopping a few ULPs
    // short, and endpoints are the common case. Probe them and prefer on ties.
    const tInterior = goldenSectionArgmax(phi);
    const fInterior = phi(tInterior);
    let tStar = tInterior;
    if (phi(1) >= fInterior) tStar = 1;
    else if (phi(0) >= fInterior) tStar = 0;

    // At an endpoint take that endpoint verbatim: a + 1*(b - a) is not exactly
    // b in floating point.
    const lerp = (a: number, b: number) => (tStar === 1 ? b : tStar === 0 ? a : a + tStar * (b - a));
    let maxMove = 0;
    const newCraft = new Map<string, number>();
    for (let i = 0; i < craftTargets.length; i++) {
      const t = craftTargets[i];
      const c0 = currentCraft.get(t) ?? 0;
      const cNew = lerp(c0, vertex.craftByTarget.get(t) ?? 0);
      newCraft.set(t, cNew);
      maxMove = Math.max(maxMove, Math.abs(Q(t) * (cNew - c0)));
    }
    const newPrimal = new Map<string, number>();
    for (const node of nonLeafNodes) {
      const p0 = currentPrimal.get(node) ?? 0;
      const pNew = lerp(p0, vertex.primalByNode.get(node) ?? 0);
      if (pNew > 1e-9) newPrimal.set(node, pNew);
    }
    currentCraft = newCraft;
    currentPrimal = newPrimal;
    if (maxMove < TIGHT || tStar < 1e-12) break;
  }

  const craftByTarget = new Map(seed.craftByTarget);
  for (const t of craftTargets) craftByTarget.set(t, currentCraft.get(t) ?? 0);
  return { craftByTarget, primalByNode: currentPrimal };
}
