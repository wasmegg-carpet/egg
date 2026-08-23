// Dense primal simplex for the evaluator's craft LP. Maximize c.x subject to
// A x <= b, x >= 0, with every b_i >= 0 so the slack basis is feasible from the start.
//
// Not routed through HiGHS because the swap drifts `emit`'s `reported` value by
// 1.06e-6 to 3.56e-6 nats, tripping C2-honesty on 11 of 18 instances; the plans
// themselves are unchanged. Issue #52 carries the remaining work.
//
// Pricing is Dantzig, falling back permanently to Bland's rule after a degenerate
// streak. Pure Bland is finite but blew the iteration guard on the bound-polytope LPs.
//
// Every row is equilibrated to max |coefficient| = 1 and the objective to max
// |c| = 1: an absolute pivot tolerance on the raw tableau accepts rounding noise as
// a pivot, which destroys the basis and voids Bland's finite-termination proof.

export interface SimplexSolution {
  primal: number[];
  objective: number;
}

const TOL = 1e-9;
// A pivot element this far below the largest candidate in its column is noise.
const PIVOT_REL = 1e-7;
// Rounding leaves the rhs a hair negative on degenerate pivots; within this it is clamped.
const FEAS_TOL = 1e-7;

export function simplexMax(
  A: readonly (readonly number[])[],
  b: readonly number[],
  c: readonly number[]
): SimplexSolution {
  const m = A.length;
  const n = c.length;
  const width = n + m + 1;

  let cScale = 0;
  for (let j = 0; j < n; j++) cScale = Math.max(cScale, Math.abs(c[j]));
  if (!(cScale > 0) || !Number.isFinite(cScale)) cScale = 1;

  const T: Float64Array[] = [];
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(width);
    let s = 0;
    for (let j = 0; j < n; j++) s = Math.max(s, Math.abs(A[i][j]));
    s = Math.max(s, Math.abs(b[i]));
    if (!(s > 0) || !Number.isFinite(s)) s = 1;
    for (let j = 0; j < n; j++) row[j] = A[i][j] / s;
    row[n + i] = 1;
    row[width - 1] = b[i] / s;
    T.push(row);
  }
  const obj = new Float64Array(width);
  for (let j = 0; j < n; j++) obj[j] = -c[j] / cScale;
  T.push(obj);

  const basis: number[] = [];
  for (let i = 0; i < m; i++) basis.push(n + i);

  // A guard against a genuine defect, not a tuning knob: a well-scaled solve is
  // O(m + n) pivots.
  const maxIters = 200 * (m + n) + 1000;
  const degenLimit = 2 * (m + n) + 100; // non-improving pivots before Bland kicks in
  let degenStreak = 0;
  let bland = false;
  let lastObjective = 0;

  for (let iter = 0; iter < maxIters; iter++) {
    let enter = -1;
    if (bland) {
      for (let j = 0; j < n + m; j++) {
        if (T[m][j] < -TOL) {
          enter = j;
          break;
        }
      }
    } else {
      let best = -TOL;
      for (let j = 0; j < n + m; j++) {
        if (T[m][j] < best) {
          best = T[m][j];
          enter = j;
        }
      }
    }
    const currentSolution = () => {
      const primal = new Array<number>(n).fill(0);
      for (let i = 0; i < m; i++) {
        if (basis[i] < n) primal[basis[i]] = Math.max(0, T[i][width - 1]);
      }
      return { objective: T[m][width - 1] * cScale, primal };
    };

    if (enter === -1) return currentSolution();

    let colMax = 0;
    for (let i = 0; i < m; i++) colMax = Math.max(colMax, Math.abs(T[i][enter]));
    const pivotFloor = Math.max(TOL, colMax * PIVOT_REL);

    // Ties within tolerance go to the largest pivot element, then to the lowest basis
    // index — the latter is what Bland's anti-cycling argument needs.
    let leave = -1;
    let bestRatio = Infinity;
    let bestPivot = 0;
    let anyPositive = false;
    for (let i = 0; i < m; i++) {
      const a = T[i][enter];
      if (a > 0) anyPositive = true;
      if (a <= pivotFloor) continue;
      const ratio = Math.max(0, T[i][width - 1]) / a;
      if (leave === -1 || ratio < bestRatio - TOL) {
        bestRatio = ratio;
        bestPivot = a;
        leave = i;
      } else if (ratio <= bestRatio + TOL) {
        const better = bland
          ? basis[i] < basis[leave]
          : a > bestPivot + TOL || (Math.abs(a - bestPivot) <= TOL && basis[i] < basis[leave]);
        if (better) {
          bestPivot = a;
          leave = i;
        }
        if (ratio < bestRatio) bestRatio = ratio;
      }
    }
    if (leave === -1) {
      // A column with positive entries all under `pivotFloor` is a numerical dead end
      // on a bounded LP, not an unbounded ray: `pivotFloor` scales off the largest
      // *magnitude*, so one large negative entry floats it above every positive one.
      if (!anyPositive) throw new Error('simplex: LP is unbounded');
      return currentSolution();
    }

    const pivot = T[leave][enter];
    const leaveRow = T[leave];
    for (let j = 0; j < width; j++) leaveRow[j] /= pivot;
    leaveRow[enter] = 1; // exact, rather than 1 plus a rounding error
    for (let i = 0; i <= m; i++) {
      if (i === leave) continue;
      const row = T[i];
      const factor = row[enter];
      if (factor === 0) continue;
      for (let j = 0; j < width; j++) row[j] -= factor * leaveRow[j];
      row[enter] = 0;
      if (i < m && row[width - 1] < 0) {
        if (row[width - 1] < -FEAS_TOL) {
          throw new Error(`simplex: basis lost feasibility (rhs=${row[width - 1].toExponential(3)})`);
        }
        row[width - 1] = 0;
      }
    }
    basis[leave] = enter;

    if (!bland) {
      const objective = T[m][width - 1];
      if (objective > lastObjective + 1e-12) {
        degenStreak = 0;
        lastObjective = objective;
      } else if (++degenStreak >= degenLimit) {
        bland = true;
      }
    }
  }
  throw new Error(
    `simplex: iteration cap exceeded (m=${m} n=${n} bland=${bland} ` +
      `obj=${(T[m][width - 1] * cScale).toExponential(6)})`
  );
}
