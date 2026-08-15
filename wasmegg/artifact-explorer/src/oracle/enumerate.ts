// Brute-force side of the oracle. The objective is monotone and the feasible
// region downward-closed, so enumerating only MAXIMAL allocations is exact.
// The packing check is re-derived here, independent of the production packer.

import {
  evaluateAllocation,
  evaluateAllocationFloat,
  evaluateAllocationJoint,
  evaluateAllocationJointFloat,
  OracleInstance,
  OracleJointTargetResult,
} from './evaluate';

export interface BruteForceResult {
  bestScore: number;
  bestProbability: number;
  bestAllocation: number[];
  feasibleCount: number; // all feasible integer vectors
  evaluatedCount: number; // maximal vectors actually run through the LP
}

const NUM_SLOTS = 3;
const EPS = 1e-9;

// Packing feasibility depends only on per-duration mission counts, so options
// are indexed by their distinct durations.
interface DurationModel {
  durations: number[];
  durIdxByOption: number[];
}

function durationModel(inst: OracleInstance): DurationModel {
  const durations: number[] = [];
  const keyToIdx = new Map<number, number>();
  const durIdxByOption = inst.options.map(o => {
    const d = o.actualTime;
    const key = Math.round(d);
    let idx = keyToIdx.get(key);
    if (idx === undefined) {
      idx = durations.length;
      durations.push(d);
      keyToIdx.set(key, idx);
    }
    return idx;
  });
  return { durations, durIdxByOption };
}

// Exact: can `durCounts[j]` missions of duration `durations[j]` be partitioned
// into NUM_SLOTS bins of capacity `capacity`?
export function packableInto3Bins(
  durCounts: number[],
  durations: number[],
  capacity: number,
  nodeBudget = 500_000
): boolean {
  const m = durCounts.length;
  let total = 0;
  let big = 0;
  for (let j = 0; j < m; j++) {
    const c = durCounts[j];
    if (c <= 0) continue;
    const d = durations[j];
    if (d <= 0) continue; // zero-duration: no slot load
    if (d > capacity + EPS) return false;
    total += c * d;
    if (d > capacity / 2 + EPS) big += c;
  }
  if (total > NUM_SLOTS * capacity + EPS) return false;
  if (big > NUM_SLOTS) return false;

  const memo = new Map<string, boolean>();
  let nodes = 0;

  const feasible = (start: number, loads: number[]): boolean => {
    let j = start;
    while (j < m && (durCounts[j] <= 0 || durations[j] <= 0)) j++;
    if (j === m) return true;
    if (++nodes > nodeBudget) {
      // Answering "infeasible" on budget exhaustion would silently break the
      // enumeration's exactness; fail loudly instead.
      throw new Error(`packableInto3Bins exceeded ${nodeBudget} nodes; instance too large for the exact packing check`);
    }
    const s = [loads[0], loads[1], loads[2]].sort((a, b) => a - b);
    const key = `${j}#${Math.round(s[0])},${Math.round(s[1])},${Math.round(s[2])}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const c = durCounts[j];
    const d = durations[j];
    const room = (l: number) => Math.floor((capacity - l + EPS) / d);
    let res = false;
    const r0 = Math.min(c, room(loads[0]));
    for (let x0 = 0; x0 <= r0 && !res; x0++) {
      const rem1 = c - x0;
      const r1 = Math.min(rem1, room(loads[1]));
      for (let x1 = 0; x1 <= r1; x1++) {
        const x2 = rem1 - x1;
        const l2 = loads[2] + x2 * d;
        if (l2 > capacity + EPS) continue;
        if (feasible(j + 1, [loads[0] + x0 * d, loads[1] + x1 * d, l2])) {
          res = true;
          break;
        }
      }
    }
    memo.set(key, res);
    return res;
  };

  return feasible(0, [0, 0, 0]);
}

// Cheap upper bound: floor(S/d) per slot across NUM_SLOTS slots. Zero- or
// negative-duration missions are unlaunchable, matching the solver.
function maxByPacking(duration: number, capacity: number): number {
  if (duration <= 0) return 0;
  return NUM_SLOTS * Math.floor(capacity / duration);
}

export function countFeasible(inst: OracleInstance, cap: number): number | null {
  const n = inst.options.length;
  const { durations, durIdxByOption } = durationModel(inst);
  const durCounts = new Array<number>(durations.length).fill(0);
  const S = inst.timeCapacityPerSlot;
  let count = 0;

  const walk = (i: number, fuelLeft: number): boolean => {
    if (i === n) {
      count++;
      return count <= cap;
    }
    const opt = inst.options[i];
    const dj = durIdxByOption[i];
    if (opt.actualFuel <= 0 && opt.actualTime <= 0) {
      throw new Error('option with zero fuel and time cost admits unbounded launches; instance is ill-posed');
    }
    // several options can share a duration; accumulate onto earlier ones
    const base = durCounts[dj];
    const maxK = Math.min(
      opt.actualFuel > 0 ? Math.floor(fuelLeft / opt.actualFuel) : Infinity,
      maxByPacking(opt.actualTime, S)
    );
    for (let k = 0; k <= maxK; k++) {
      durCounts[dj] = base + k;
      if (k > 0 && !packableInto3Bins(durCounts, durations, S)) {
        break; // more of this duration can only stay unpackable
      }
      if (!walk(i + 1, fuelLeft - k * opt.actualFuel)) {
        durCounts[dj] = base;
        return false;
      }
    }
    durCounts[dj] = base;
    return true;
  };

  return walk(0, inst.fuelCapacity) ? count : null;
}

// Candidates are ranked with the float evaluator; everything within
// RANKING_SLOP of the float best is re-evaluated exactly, so a float near-tie
// cannot cost the true optimum.
const RANKING_SLOP = 1e-7;
const MAX_FINALISTS = 8;

export function bruteForceBest(inst: OracleInstance): BruteForceResult {
  const n = inst.options.length;
  // With a zero-cost option no allocation is ever maximal and the result would
  // silently collapse to bestProbability = 0; fail loudly instead.
  for (const opt of inst.options) {
    if (opt.actualFuel <= 0 && opt.actualTime <= 0) {
      throw new Error('option with zero fuel and time cost admits unbounded launches; instance is ill-posed');
    }
  }

  const { durations, durIdxByOption } = durationModel(inst);
  const durCounts = new Array<number>(durations.length).fill(0);
  const S = inst.timeCapacityPerSlot;

  const allocation = new Array<number>(n).fill(0);
  let feasibleCount = 0;
  let evaluatedCount = 0;
  let bestFloat = -Infinity;
  let finalists: number[][] = [];

  // No option can be added without busting fuel or breaking the 3-slot packing.
  const isMaximal = (fuelLeft: number): boolean => {
    for (let i = 0; i < n; i++) {
      const opt = inst.options[i];
      if (opt.actualTime <= 0) continue; // consistent with maxByPacking

      if (opt.actualFuel > fuelLeft + EPS) continue;
      const dj = durIdxByOption[i];
      durCounts[dj] += 1;
      const canAdd = packableInto3Bins(durCounts, durations, S);
      durCounts[dj] -= 1;
      if (canAdd) return false;
    }
    return true;
  };

  const walk = (i: number, fuelLeft: number) => {
    if (i === n) {
      feasibleCount++;
      if (!isMaximal(fuelLeft)) {
        return;
      }
      const score = evaluateAllocationFloat(inst, allocation);
      evaluatedCount++;
      if (score > bestFloat + RANKING_SLOP) {
        bestFloat = score;
        finalists = [allocation.slice()];
      } else if (score > bestFloat - RANKING_SLOP) {
        bestFloat = Math.max(bestFloat, score);
        if (finalists.length < MAX_FINALISTS) {
          finalists.push(allocation.slice());
        }
      }
      return;
    }
    const opt = inst.options[i];
    const dj = durIdxByOption[i];
    const base = durCounts[dj];
    const maxK = Math.min(
      opt.actualFuel > 0 ? Math.floor(fuelLeft / opt.actualFuel) : Infinity,
      maxByPacking(opt.actualTime, S)
    );
    for (let k = 0; k <= maxK; k++) {
      durCounts[dj] = base + k;
      if (k > 0 && !packableInto3Bins(durCounts, durations, S)) {
        break;
      }
      allocation[i] = k;
      walk(i + 1, fuelLeft - k * opt.actualFuel);
    }
    durCounts[dj] = base;
    allocation[i] = 0;
  };

  walk(0, inst.fuelCapacity);

  const best: BruteForceResult = {
    bestScore: -Infinity,
    bestProbability: 0,
    bestAllocation: new Array<number>(n).fill(0),
    feasibleCount,
    evaluatedCount,
  };
  for (const candidate of finalists) {
    const exact = evaluateAllocation(inst, candidate);
    if (exact.score > best.bestScore) {
      best.bestScore = exact.score;
      best.bestProbability = exact.probability;
      best.bestAllocation = candidate;
    }
  }
  return best;
}

export interface BruteForceJointResult {
  bestJointProbability: number;
  bestAllocation: number[];
  bestPerTarget: OracleJointTargetResult[];
  feasibleCount: number;
  evaluatedCount: number;
}

// RANKING_SLOP's counterpart for the joint objective.
const RANKING_SLOP_JOINT = 1e-6;
const MAX_FINALISTS_JOINT = 8;

// Ranks maximal allocations by the JOINT probability, the objective the solver
// maximizes at every target count. bruteForceBest below runs the same
// enumeration against the union-style score; the duplication is deliberate, so
// the two ranking objectives cannot cross-contaminate each other's tuning.
export function bruteForceBestJoint(inst: OracleInstance): BruteForceJointResult {
  const n = inst.options.length;
  for (const opt of inst.options) {
    if (opt.actualFuel <= 0 && opt.actualTime <= 0) {
      throw new Error('option with zero fuel and time cost admits unbounded launches; instance is ill-posed');
    }
  }

  const { durations, durIdxByOption } = durationModel(inst);
  const durCounts = new Array<number>(durations.length).fill(0);
  const S = inst.timeCapacityPerSlot;

  const allocation = new Array<number>(n).fill(0);
  let feasibleCount = 0;
  let evaluatedCount = 0;
  let bestFloat = -Infinity;
  let finalists: number[][] = [];

  const isMaximal = (fuelLeft: number): boolean => {
    for (let i = 0; i < n; i++) {
      const opt = inst.options[i];
      if (opt.actualTime <= 0) continue;
      if (opt.actualFuel > fuelLeft + EPS) continue;
      const dj = durIdxByOption[i];
      durCounts[dj] += 1;
      const canAdd = packableInto3Bins(durCounts, durations, S);
      durCounts[dj] -= 1;
      if (canAdd) return false;
    }
    return true;
  };

  const walk = (i: number, fuelLeft: number) => {
    if (i === n) {
      feasibleCount++;
      if (!isMaximal(fuelLeft)) {
        return;
      }
      const jointProbability = evaluateAllocationJointFloat(inst, allocation);
      evaluatedCount++;
      if (jointProbability > bestFloat + RANKING_SLOP_JOINT) {
        bestFloat = jointProbability;
        finalists = [allocation.slice()];
      } else if (jointProbability > bestFloat - RANKING_SLOP_JOINT) {
        bestFloat = Math.max(bestFloat, jointProbability);
        if (finalists.length < MAX_FINALISTS_JOINT) {
          finalists.push(allocation.slice());
        }
      }
      return;
    }
    const opt = inst.options[i];
    const dj = durIdxByOption[i];
    const base = durCounts[dj];
    const maxK = Math.min(
      opt.actualFuel > 0 ? Math.floor(fuelLeft / opt.actualFuel) : Infinity,
      maxByPacking(opt.actualTime, S)
    );
    for (let k = 0; k <= maxK; k++) {
      durCounts[dj] = base + k;
      if (k > 0 && !packableInto3Bins(durCounts, durations, S)) {
        break;
      }
      allocation[i] = k;
      walk(i + 1, fuelLeft - k * opt.actualFuel);
    }
    durCounts[dj] = base;
    allocation[i] = 0;
  };

  walk(0, inst.fuelCapacity);

  const best: BruteForceJointResult = {
    bestJointProbability: 0,
    bestAllocation: new Array<number>(n).fill(0),
    bestPerTarget: [],
    feasibleCount,
    evaluatedCount,
  };
  for (const candidate of finalists) {
    const exact = evaluateAllocationJoint(inst, candidate);
    if (exact.jointProbability > best.bestJointProbability) {
      best.bestJointProbability = exact.jointProbability;
      best.bestAllocation = candidate;
      best.bestPerTarget = exact.perTarget;
    }
  }
  return best;
}
