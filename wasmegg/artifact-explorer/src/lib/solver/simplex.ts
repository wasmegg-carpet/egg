// Dense primal simplex for the evaluator's craft LP. Maximize c.x subject to
// A x <= b, x >= 0. The inputs are checked rather than assumed: b_i >= 0, which is what
// makes the slack basis feasible from the start, and no NaN in A, b or c.
//
// Not routed through HiGHS because the swap drifts `emit`'s `reported` value by
// 1.06e-6 to 3.56e-6 nats, tripping C2-honesty on 11 of 18 instances; the plans
// themselves are unchanged. https://github.com/ColossalTuna/egg/issues/52 carries the
// remaining work.
//
// Pricing is Dantzig's rule, falling back permanently to the anti-cycling Bland's rule
// after a streak of degenerate pivots. Pure Bland is finite but blew the iteration guard
// on the bound-polytope LPs.
//
// Every row is equilibrated — divided through by its own largest coefficient — so that
// max_j |A[i][j]| = 1, and the objective so that max_j |c[j]| = 1: an absolute pivot
// tolerance on the raw tableau accepts rounding noise as a pivot, which destroys the basis
// and voids Bland's finite-termination proof. Scaling the objective answers the mirror
// failure — against an absolute price tolerance an unscaled objective row prices a
// genuinely improving column as noise, and the solve returns 'optimal' from a point a
// better one is reachable from, with nothing in the result saying so. b_i is divided by its
// row's factor but does not enter it — folding |b_i| in shrinks a row whose rhs dominates
// its coefficients until those coefficients fall under the pivot floor, at which point the
// ratio test (which picks the leaving row, the first constraint the entering column runs
// into) skips the row and the constraint is silently gone. So the rhs carries the row's
// whole dynamic range, and every tolerance it can reach (ratio ties, the feasibility clamp,
// the degenerate-pivot test) is relative to the numbers at hand.

// `stalled` is returned when the entering column has no pivot above the floor: the point is
// feasible and its objective is a valid lower bound, but nothing here proves it optimal.
export type SimplexStatus = 'optimal' | 'stalled';

export interface SimplexSolution {
  primal: number[];
  objective: number;
  status: SimplexStatus;
}

// A reduced cost above -this, on an objective row scaled to max |c| = 1, is rounding noise
// rather than an improving column.
const PRICE_TOL = 1e-9;
// A pivot element this far below the largest candidate in its column is noise.
const PIVOT_REL = 1e-7;
// Floor under PIVOT_REL, for a column that is entirely tiny.
const PIVOT_ABS = 1e-9;
// Ratios this close to the smallest one, relative to it, are the same vertex.
const RATIO_TIE = 1e-9;
// Rounding leaves the rhs a hair negative on degenerate pivots; within this fraction of
// `rhsScale` it is clamped, beyond it the basis is genuinely infeasible.
const FEAS_REL = 1e-7;
// Objective gain below this fraction of the objective's own size is a degenerate pivot.
const IMPROVE_REL = 1e-12;

export function simplexMax(
  A: readonly (readonly number[])[],
  b: readonly number[],
  c: readonly number[]
): SimplexSolution {
  const m = A.length;
  const n = c.length;
  const width = n + m + 1;

  let cScale = 0;
  for (let j = 0; j < n; j++) {
    if (Number.isNaN(c[j])) throw new Error(`simplex: c[${j}] is NaN`);
    cScale = Math.max(cScale, Math.abs(c[j]));
  }
  if (!(cScale > 0) || !Number.isFinite(cScale)) cScale = 1;

  // The largest right-hand side the tableau has held. Cancelling two entries of size R
  // leaves error of order R * eps behind, and that error rides along in the row through
  // every later pivot, so this and not the current step's operands is what separates a
  // rounding artefact from a real loss of feasibility.
  let rhsScale = 1;

  const T: Float64Array[] = [];
  for (let i = 0; i < m; i++) {
    if (!(b[i] >= 0)) throw new Error(`simplex: b[${i}] must be >= 0, got ${b[i]}`);
    const row = new Float64Array(width);
    let s = 0;
    for (let j = 0; j < n; j++) {
      if (Number.isNaN(A[i][j])) throw new Error(`simplex: A[${i}][${j}] is NaN`);
      s = Math.max(s, Math.abs(A[i][j]));
    }
    if (!(s > 0) || !Number.isFinite(s)) s = 1;
    for (let j = 0; j < n; j++) row[j] = A[i][j] / s;
    row[n + i] = 1;
    row[width - 1] = b[i] / s;
    if (Number.isFinite(row[width - 1])) rhsScale = Math.max(rhsScale, row[width - 1]);
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
        if (T[m][j] < -PRICE_TOL) {
          enter = j;
          break;
        }
      }
    } else {
      let best = -PRICE_TOL;
      for (let j = 0; j < n + m; j++) {
        if (T[m][j] < best) {
          best = T[m][j];
          enter = j;
        }
      }
    }
    const readBasis = (status: SimplexStatus) => {
      const primal = new Array<number>(n).fill(0);
      for (let i = 0; i < m; i++) {
        if (basis[i] < n) primal[basis[i]] = Math.max(0, T[i][width - 1]);
      }
      return { objective: T[m][width - 1] * cScale, primal, status };
    };

    if (enter === -1) return readBasis('optimal');

    let colMax = 0;
    for (let i = 0; i < m; i++) colMax = Math.max(colMax, Math.abs(T[i][enter]));
    const pivotFloor = Math.max(PIVOT_ABS, colMax * PIVOT_REL);

    const ratioOf = (i: number) => Math.max(0, T[i][width - 1]) / T[i][enter];
    let minRatio = Infinity;
    let candidate = false;
    let anyPositive = false;
    for (let i = 0; i < m; i++) {
      const a = T[i][enter];
      if (a > 0) anyPositive = true;
      if (a <= pivotFloor) continue;
      candidate = true;
      minRatio = Math.min(minRatio, ratioOf(i));
    }
    if (!candidate) {
      // A column with positive entries all under `pivotFloor` is a numerical dead end
      // on a bounded LP, not an unbounded ray: `pivotFloor` scales off the largest
      // *magnitude*, so one large negative entry floats it above every positive one.
      if (!anyPositive) throw new Error('simplex: LP is unbounded');
      return readBasis('stalled');
    }

    // The smallest ratio is found before any row is chosen, so that "within tolerance of
    // the minimum" is a property of a row rather than of the order rows were visited in:
    // a pairwise epsilon comparison is not transitive, and the lowest-basis-index rule
    // Bland's anti-cycling argument needs has to run on a set that is actually tied.
    const tieBand = minRatio + RATIO_TIE * Math.max(1, minRatio);
    let leave = -1;
    for (let i = 0; i < m; i++) {
      if (T[i][enter] <= pivotFloor || ratioOf(i) > tieBand) continue;
      if (leave === -1 || basis[i] < basis[leave]) leave = i;
    }

    const pivot = T[leave][enter];
    const leaveRow = T[leave];
    for (let j = 0; j < width; j++) leaveRow[j] /= pivot;
    leaveRow[enter] = 1; // exact, rather than 1 plus a rounding error
    // Dividing by a small pivot is where the rhs column grows.
    if (Number.isFinite(leaveRow[width - 1])) rhsScale = Math.max(rhsScale, Math.abs(leaveRow[width - 1]));
    const noise = FEAS_REL * rhsScale;
    for (let i = 0; i <= m; i++) {
      if (i === leave) continue;
      const row = T[i];
      const factor = row[enter];
      if (factor === 0) continue;
      for (let j = 0; j < width; j++) row[j] -= factor * leaveRow[j];
      row[enter] = 0;
      if (i < m && row[width - 1] < 0) {
        if (row[width - 1] < -noise) {
          throw new Error(`simplex: basis lost feasibility (rhs=${row[width - 1].toExponential(3)})`);
        }
        row[width - 1] = 0;
      }
    }
    basis[leave] = enter;

    if (!bland) {
      const objective = T[m][width - 1];
      if (objective > lastObjective + IMPROVE_REL * Math.max(1, Math.abs(lastObjective))) {
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
