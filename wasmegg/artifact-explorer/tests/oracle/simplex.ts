// Primal simplex for the oracle: maximize c.x s.t. A x <= b, x >= 0, b >= 0.
// Dense tableau with Bland's rule; instances are tiny, so the exact variant
// is affordable.

import { Frac } from './rational';

export interface SimplexFloatResult {
  objective: number;
  primal: number[]; // one entry per column of c, in its order
}

export interface SimplexResult {
  objective: Frac;
  primal: Frac[];
}

// Float twin of simplexMaximize for cheap candidate ranking.
export function simplexMaximizeFloatFull(A: number[][], b: number[], c: number[]): SimplexFloatResult {
  const EPS = 1e-9;
  const m = A.length;
  const n = c.length;
  const width = n + m + 1;
  const T: number[][] = [];
  for (let i = 0; i < m; i++) {
    const row = new Array<number>(width).fill(0);
    for (let j = 0; j < n; j++) {
      row[j] = A[i][j];
    }
    row[n + i] = 1;
    row[width - 1] = b[i];
    T.push(row);
  }
  const obj = new Array<number>(width).fill(0);
  for (let j = 0; j < n; j++) {
    obj[j] = -c[j];
  }
  T.push(obj);

  const basis: number[] = [];
  for (let i = 0; i < m; i++) {
    basis.push(n + i);
  }

  for (let iter = 0; iter < 10000; iter++) {
    let enter = -1;
    for (let j = 0; j < n + m; j++) {
      if (T[m][j] < -EPS) {
        enter = j;
        break;
      }
    }
    if (enter === -1) {
      const primal = new Array<number>(n).fill(0);
      for (let i = 0; i < m; i++) {
        if (basis[i] < n) primal[basis[i]] = T[i][width - 1];
      }
      return { objective: T[m][width - 1], primal };
    }
    let leave = -1;
    let bestRatio = Infinity;
    for (let i = 0; i < m; i++) {
      if (T[i][enter] > EPS) {
        const ratio = T[i][width - 1] / T[i][enter];
        if (ratio < bestRatio - EPS) {
          bestRatio = ratio;
          leave = i;
        } else if (ratio < bestRatio + EPS && (leave === -1 || basis[i] < basis[leave])) {
          // Bland tie-break on near-ties; bestRatio keeps the smaller value.
          leave = i;
        }
      }
    }
    if (leave === -1) {
      throw new Error('float LP is unbounded');
    }
    const pivot = T[leave][enter];
    for (let j = 0; j < width; j++) {
      T[leave][j] /= pivot;
    }
    for (let i = 0; i <= m; i++) {
      if (i !== leave && Math.abs(T[i][enter]) > 0) {
        const factor = T[i][enter];
        for (let j = 0; j < width; j++) {
          T[i][j] -= factor * T[leave][j];
        }
      }
    }
    basis[leave] = enter;
  }
  throw new Error('float simplex iteration cap exceeded');
}

export function simplexMaximizeFloat(A: number[][], b: number[], c: number[]): number {
  return simplexMaximizeFloatFull(A, b, c).objective;
}

export function simplexMaximizeFull(A: Frac[][], b: Frac[], c: Frac[]): SimplexResult {
  const m = A.length;
  const n = c.length;
  for (const bi of b) {
    if (bi.isNegative()) {
      throw new Error('simplexMaximize requires b >= 0');
    }
  }

  // Columns: [x_0..x_{n-1}, s_0..s_{m-1}, rhs]; the objective row's rhs
  // accumulates the objective value as pivots proceed.
  const width = n + m + 1;
  const T: Frac[][] = [];
  for (let i = 0; i < m; i++) {
    const row: Frac[] = new Array(width).fill(Frac.ZERO);
    for (let j = 0; j < n; j++) {
      row[j] = A[i][j];
    }
    row[n + i] = Frac.ONE;
    row[width - 1] = b[i];
    T.push(row);
  }
  const obj: Frac[] = new Array(width).fill(Frac.ZERO);
  for (let j = 0; j < n; j++) {
    obj[j] = c[j].neg();
  }
  T.push(obj);

  const basis: number[] = [];
  for (let i = 0; i < m; i++) {
    basis.push(n + i);
  }

  const maxIters = 10000;
  for (let iter = 0; ; iter++) {
    if (iter >= maxIters) {
      throw new Error('simplex iteration cap exceeded (cycling?)');
    }
    // Bland: entering variable = lowest-index column with negative reduced cost.
    let enter = -1;
    for (let j = 0; j < n + m; j++) {
      if (T[m][j].isNegative()) {
        enter = j;
        break;
      }
    }
    if (enter === -1) {
      const primal: Frac[] = new Array(n).fill(Frac.ZERO);
      for (let i = 0; i < m; i++) {
        if (basis[i] < n) primal[basis[i]] = T[i][width - 1];
      }
      return { objective: T[m][width - 1], primal }; // objective value accumulated in rhs
    }
    // Ratio test; Bland tie-break on lowest basis variable index.
    let leave = -1;
    let bestRatio: Frac | null = null;
    for (let i = 0; i < m; i++) {
      if (T[i][enter].isPositive()) {
        const ratio = T[i][width - 1].div(T[i][enter]);
        if (bestRatio === null || ratio.cmp(bestRatio) < 0 || (ratio.cmp(bestRatio) === 0 && basis[i] < basis[leave])) {
          bestRatio = ratio;
          leave = i;
        }
      }
    }
    if (leave === -1) {
      throw new Error('LP is unbounded');
    }
    // Pivot on (leave, enter).
    const pivot = T[leave][enter];
    for (let j = 0; j < width; j++) {
      T[leave][j] = T[leave][j].div(pivot);
    }
    for (let i = 0; i <= m; i++) {
      if (i !== leave && !T[i][enter].isZero()) {
        const factor = T[i][enter];
        for (let j = 0; j < width; j++) {
          T[i][j] = T[i][j].sub(factor.mul(T[leave][j]));
        }
      }
    }
    basis[leave] = enter;
  }
}

export function simplexMaximize(A: Frac[][], b: Frac[], c: Frac[]): Frac {
  return simplexMaximizeFull(A, b, c).objective;
}
