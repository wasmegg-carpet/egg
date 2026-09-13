import { describe, expect, it } from 'vitest';
import { simplexMax } from '@/lib/solver/simplex';

const PREC = 9;

// ---------------------------------------------------------------------------
// Independent optimum, by vertex enumeration.
//
// simplexMax returns a primal and an objective and no dual, so there is no
// certificate to check the way tests/unit/lp.spec.ts checks solveLp's. Instead
// the optimum is recomputed from the definition: max c·x over Ax <= b, x >= 0
// with c >= 0 and a strictly positive budget row is bounded and attained at a
// vertex, and every vertex is the unique solution of n linearly independent
// active constraints drawn from the m rows plus the n nonnegativity bounds. For
// n <= 5 that is at most C(10, 5) = 252 tiny linear systems, which is affordable
// per instance and shares no code with the solver under test.
// ---------------------------------------------------------------------------

interface Instance {
  A: number[][];
  b: number[];
  c: number[];
  spread: number; // max_i r_i / min_i r_i over row magnitudes r_i = max_j |A[i][j]|
}

function rowMagnitudes(A: number[][]): number[] {
  return A.map(row => row.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0));
}

// Gaussian elimination with partial pivoting; null when the system is singular
// to working precision. Rows arrive pre-equilibrated, so the pivot threshold is
// a plain one against entries in [-1, 1].
function solveSquare(M: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = M.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let i = col + 1; i < n; i++) {
      if (Math.abs(a[i][col]) > Math.abs(a[piv][col])) piv = i;
    }
    if (Math.abs(a[piv][col]) < 1e-11) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    for (let i = 0; i < n; i++) {
      if (i === col) continue;
      const f = a[i][col] / a[col][col];
      if (f === 0) continue;
      for (let j = col; j <= n; j++) a[i][j] -= f * a[col][j];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

// The LP's own objective scale, from the budget row alone: every unit of x_j is
// paid for out of row 0, so c·x = sum_j (c_j / A_0j) * A_0j x_j <= b_0 * max_j
// (c_j / A_0j). Optimality is measured against this rather than against the
// optimum itself, because a polytope that pins x at 1e-17 has an optimum made
// entirely of rounding dust and calling a 1e-16 shortfall there "100% short"
// says nothing about the solver.
function objectiveScale(inst: Instance): number {
  let ratio = 0;
  for (let j = 0; j < inst.c.length; j++) {
    if (inst.A[0][j] > 0) ratio = Math.max(ratio, inst.c[j] / inst.A[0][j]);
  }
  return ratio * inst.b[0];
}

// The best objective over all feasible vertices. x = 0 is always one of them,
// so this always returns a number.
function bruteForceOptimum(inst: Instance): number {
  const { A, b, c } = inst;
  const m = A.length;
  const n = c.length;

  // All constraints as `g·x <= h`, row-normalized so one absolute tolerance
  // serves rows whose raw magnitudes are fifteen decades apart.
  const g: number[][] = [];
  const h: number[] = [];
  const mags = rowMagnitudes(A);
  for (let i = 0; i < m; i++) {
    const s = mags[i] > 0 ? mags[i] : 1;
    g.push(A[i].map(v => v / s));
    h.push(b[i] / s);
  }
  for (let j = 0; j < n; j++) {
    const row = new Array<number>(n).fill(0);
    row[j] = -1;
    g.push(row);
    h.push(0);
  }
  const total = g.length;

  let best = -Infinity;
  const pick = new Array<number>(n);
  const choose = (start: number, k: number) => {
    if (k === n) {
      const x = solveSquare(
        pick.map(i => g[i]),
        pick.map(i => h[i])
      );
      if (!x || x.some(v => !Number.isFinite(v))) return;
      for (let i = 0; i < total; i++) {
        let act = 0;
        for (let j = 0; j < n; j++) act += g[i][j] * x[j];
        // Slack measured against the vertex's own magnitude: a normalized row
        // evaluated at x ~ 1e12 cannot be held to an absolute 1e-9.
        const scale = Math.max(1, Math.abs(h[i]), ...x.map(Math.abs));
        if (act - h[i] > 1e-7 * scale) return;
      }
      let obj = 0;
      for (let j = 0; j < n; j++) obj += c[j] * x[j];
      if (obj > best) best = obj;
      return;
    }
    for (let i = start; i < total; i++) {
      pick[k] = i;
      choose(i + 1, k + 1);
    }
  };
  choose(0, 0);
  return best;
}

// same shape as tests/unit/lp.spec.ts and tests/oracle/generate.ts:29
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Arm = 'well-scaled' | 'badly-scaled' | 'badly-scaled objective' | 'degenerate';

// Row 0 is the strictly positive budget row and c >= 0, which together make
// every instance feasible at x = 0 and bounded. The other rows are mixed-sign
// and sparse like the craft-conservation rows the evaluator actually builds.
// `decades` is the whole point of the badly-scaled arm: it is the row spread
// the equilibration in simplexMax exists to absorb.
function makeInstance(rng: () => number, arm: Arm): Instance {
  const n = 2 + Math.floor(rng() * 4); // 2..5 vars
  const m = 2 + Math.floor(rng() * 4); // 2..5 rows
  const decades = arm === 'badly-scaled' ? 15 : 1;

  const mag: number[] = [];
  if (arm === 'badly-scaled') {
    // pin both extremes so the instance genuinely spans the full range
    mag.push(decades, 0);
    for (let i = 2; i < m; i++) mag.push(rng() * decades);
  } else {
    for (let i = 0; i < m; i++) mag.push(rng() * decades);
  }

  const A: number[][] = [];
  for (let i = 0; i < m; i++) {
    const scale = Math.pow(10, mag[i]);
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i === 0) row.push((0.1 + rng() * 0.9) * scale);
      else if (rng() < 0.3) row.push(0);
      else row.push((rng() * 2 - 1) * scale);
    }
    if (i > 0) row[Math.floor(rng() * n)] = (rng() < 0.5 ? -1 : 1) * (0.1 + rng() * 0.9) * scale;
    A.push(row);
  }

  const b: number[] = [];
  for (let i = 0; i < m; i++) {
    const scale = Math.pow(10, mag[i]);
    // A zero RHS makes x = 0 an optimal-or-not vertex with many rows active at
    // once, which is where the ratio test ties and the degenerate pivots come
    // from. The conservation rows in the real problem are frequently zero.
    const zero = arm === 'degenerate' ? rng() < 0.8 : i > 0 && rng() < 0.3;
    b.push(zero ? 0 : rng() * 10 * scale);
  }
  if (b[0] === 0) b[0] = Math.pow(10, mag[0]);

  // The objective row is equilibrated separately from the rows and against the same absolute
  // tolerance, so a c that spans decades is its own pathology and not a restatement of the rows'.
  const cDecades = arm === 'badly-scaled objective' ? 15 : 3;
  const c: number[] = [];
  for (let j = 0; j < n; j++) c.push(rng() < 0.15 ? 0 : Math.pow(10, rng() * cDecades - cDecades / 2));

  const mags = rowMagnitudes(A);
  const lo = Math.min(...mags);
  const hi = Math.max(...mags);
  return { A, b, c, spread: lo > 0 ? hi / lo : Infinity };
}

interface Disagreement {
  arm: Arm;
  seed: number;
  kind: 'primal-sign' | 'primal-feas' | 'objective-mismatch' | 'suboptimal' | 'superoptimal' | 'threw';
  rel: number;
  detail: string;
}

const REL = 1e-6;

function check(arm: Arm, seed: number, inst: Instance, out: Disagreement[]): boolean {
  const { A, b, c } = inst;
  const m = A.length;
  const n = c.length;

  let res;
  try {
    res = simplexMax(A, b, c);
  } catch (err) {
    out.push({ arm, seed, kind: 'threw', rel: Infinity, detail: String(err) });
    return false;
  }
  const x = res.primal;
  const xMax = x.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0);
  const mags = rowMagnitudes(A);

  for (let j = 0; j < n; j++) {
    if (x[j] < -REL * Math.max(1, xMax)) {
      out.push({ arm, seed, kind: 'primal-sign', rel: -x[j] / Math.max(1, xMax), detail: `x[${j}]=${x[j]}` });
    }
  }
  for (let i = 0; i < m; i++) {
    let ax = 0;
    for (let j = 0; j < n; j++) ax += A[i][j] * x[j];
    const scale = Math.max(Math.abs(b[i]), mags[i] * xMax, Number.MIN_VALUE);
    const rel = (ax - b[i]) / scale;
    if (rel > REL) out.push({ arm, seed, kind: 'primal-feas', rel, detail: `row ${i}: ${ax} > ${b[i]}` });
  }

  let cx = 0;
  for (let j = 0; j < n; j++) cx += c[j] * x[j];
  const objErr = Math.abs(cx - res.objective) / Math.max(Math.abs(cx), Math.abs(res.objective), Number.MIN_VALUE);
  if (objErr > REL) {
    out.push({ arm, seed, kind: 'objective-mismatch', rel: objErr, detail: `c·x=${cx} reported=${res.objective}` });
  }

  const truth = bruteForceOptimum(inst);
  const scale = objectiveScale(inst);
  const short = (truth - res.objective) / scale;
  if (short > REL) {
    out.push({
      arm,
      seed,
      kind: 'suboptimal',
      rel: short,
      detail: `reported ${res.objective}, vertex optimum ${truth}`,
    });
  }
  // The other direction is what a broken feasibility check produces: an
  // objective better than any vertex means the basis left the polytope.
  if (-short > REL) {
    out.push({
      arm,
      seed,
      kind: 'superoptimal',
      rel: -short,
      detail: `reported ${res.objective}, vertex optimum ${truth}`,
    });
  }
  return truth > REL * scale;
}

describe('simplexMax on hand-checked LPs', () => {
  it('solves a trivial one-variable problem', () => {
    const r = simplexMax([[1]], [5], [1]);
    expect(r.objective).toBeCloseTo(5, PREC);
    expect(r.primal[0]).toBeCloseTo(5, PREC);
  });

  it('finds a vertex that needs multiple pivots', () => {
    // max 5x+4y s.t. 6x+4y <= 24, x+2y <= 6 -> x=3, y=1.5, obj=21
    const r = simplexMax(
      [
        [6, 4],
        [1, 2],
      ],
      [24, 6],
      [5, 4]
    );
    expect(r.objective).toBeCloseTo(21, PREC);
    expect(r.primal[0]).toBeCloseTo(3, PREC);
    expect(r.primal[1]).toBeCloseTo(1.5, PREC);
  });

  it('leaves a variable at zero when its column cannot pay for itself', () => {
    // max x + y s.t. x + 4y <= 4: y buys a quarter of what x does per unit of
    // the budget, so the optimum is all x.
    const r = simplexMax([[1, 4]], [4], [1, 1]);
    expect(r.objective).toBeCloseTo(4, PREC);
    expect(r.primal[0]).toBeCloseTo(4, PREC);
    expect(r.primal[1]).toBeCloseTo(0, PREC);
  });

  it('throws rather than returning a number when the LP is unbounded', () => {
    // x has no upper bound at all: the row constrains only y.
    expect(() => simplexMax([[0, 1]], [1], [1, 0])).toThrow(/unbounded/);
    // The same, but with x present in the row at a negative coefficient: raising x loosens the
    // row instead of consuming it. A ray is a column with no *positive* entry, not a column with
    // no entries, and the two are only distinguishable on this instance.
    expect(() =>
      simplexMax(
        [
          [-1, 1],
          [0, 1],
        ],
        [1, 1],
        [1, 0]
      )
    ).toThrow(/unbounded/);
  });

  it('holds the optimum across a 1e14 row spread', () => {
    // 2e14 x + 1e14 y <= 6e14 is 2x + y <= 6 in disguise; with x + y <= 4 the
    // vertices are (0,0), (3,0), (2,2), (0,4) and 3x+2y peaks at (2,2) = 10.
    // Against an absolute pivot tolerance on the raw tableau the first row's
    // entries swamp the second and the solve stops early.
    const r = simplexMax(
      [
        [2e14, 1e14],
        [1, 1],
      ],
      [6e14, 4],
      [3, 2]
    );
    expect(r.objective).toBeCloseTo(10, PREC);
    expect(r.primal[0]).toBeCloseTo(2, PREC);
    expect(r.primal[1]).toBeCloseTo(2, PREC);
  });

  it('holds the optimum across a 1e14 objective spread', () => {
    // Same polytope, but now it is the objective whose entries span the
    // decades: c = (3e14, 2e14) ranks the vertices identically, so the answer
    // is 1e14 times the row above and the primal is unchanged.
    const r = simplexMax(
      [
        [2, 1],
        [1, 1],
      ],
      [6, 4],
      [3e14, 2e14]
    );
    expect(r.objective / 1e14).toBeCloseTo(10, PREC);
    expect(r.primal[0]).toBeCloseTo(2, PREC);
    expect(r.primal[1]).toBeCloseTo(2, PREC);
  });

  it("survives Beale's cycling example", () => {
    // The classic instance that cycles forever under Dantzig pricing with a
    // naive ratio-test tie-break. Reaching the optimum at all is the Bland
    // fallback doing its job; the iteration cap would otherwise throw.
    const r = simplexMax(
      [
        [0.25, -60, -0.04, 9],
        [0.5, -90, -0.02, 3],
        [0, 0, 1, 0],
      ],
      [0, 0, 1],
      [0.75, -150, 0.02, -6]
    );
    expect(r.objective).toBeCloseTo(0.05, PREC);
    expect(r.primal[2]).toBeCloseTo(1, PREC);
  });
});

// The guards on `cScale` and on the per-row `s`. Both exist so that a scale of
// zero or infinity never reaches a division: without them the tableau fills
// with NaN, every reduced cost compares false, and the solve returns x = 0 with
// a NaN objective rather than failing.
describe('simplexMax degenerate scales', () => {
  it('accepts an all-zero objective', () => {
    const r = simplexMax(
      [
        [1, 1],
        [2, 1],
      ],
      [4, 6],
      [0, 0]
    );
    expect(r.objective).toBe(0);
    expect(r.primal.every(Number.isFinite)).toBe(true);
  });

  it('accepts an objective coefficient of Infinity', () => {
    // The other half of the `cScale` guard, and the only half with an observable answer: dividing
    // the objective row by an infinite scale sends every finite coefficient to zero, no column
    // then prices as improving, and the solve returns x = 0 with an objective of NaN.
    const r = simplexMax([[1, 1]], [5], [1, Infinity]);
    expect(r.primal[1]).toBeCloseTo(5, PREC);
    expect(r.objective).toBe(Infinity);
  });

  it('accepts an all-zero constraint row', () => {
    // `0 = 0` is a conservation row for an item nothing produces or consumes. It constrains
    // nothing, so the optimum is the one-row problem's. First, because a NaN row that the ratio
    // test reaches after a real candidate loses to it, while one it reaches first is chosen.
    const r = simplexMax(
      [
        [0, 0],
        [1, 4],
      ],
      [0, 4],
      [1, 1]
    );
    expect(r.objective).toBeCloseTo(4, PREC);
    expect(r.primal[0]).toBeCloseTo(4, PREC);
  });

  it('accepts a row whose right-hand side is infinite', () => {
    // An unbounded budget: the row imposes nothing, so the answer is the other
    // row's. Equilibrating by an infinite scale would divide the row into
    // zeros and its rhs into NaN.
    const r = simplexMax(
      [
        [1, 1],
        [1, 4],
      ],
      [Infinity, 4],
      [1, 1]
    );
    expect(r.objective).toBeCloseTo(4, PREC);
    expect(r.primal[0]).toBeCloseTo(4, PREC);
  });

  it('keeps rows independent when one is 1e300 times the other', () => {
    // x + y <= 4 written twice, once multiplied through by 1e300. Both rows
    // say the same thing, so the optimum is 4 either way; without row
    // equilibration the scaled row's slack column is 1 against entries of
    // 1e300 and the pivot on it is indistinguishable from zero.
    const r = simplexMax(
      [
        [1e300, 1e300],
        [1, 2],
      ],
      [4e300, 6],
      [1, 1]
    );
    expect(r.objective).toBeCloseTo(4, PREC);
  });
});

describe('simplexMax against an enumerated vertex optimum (randomized)', () => {
  it.each<[Arm, number, number]>([
    ['well-scaled', 0x51e6ce7, 2000],
    ['badly-scaled', 0x9cae1ed, 2000],
    ['badly-scaled objective', 0x0b1ec71e, 2000],
    ['degenerate', 0xde6e7a7e, 2000],
  ])('agrees with the vertex optimum on %s instances', (arm, seed, n) => {
    const rng = mulberry32(seed);
    const out: Disagreement[] = [];
    let nontrivial = 0;
    let maxSpread = 0;
    for (let k = 0; k < n; k++) {
      const inst = makeInstance(rng, arm);
      maxSpread = Math.max(maxSpread, Number.isFinite(inst.spread) ? inst.spread : 0);
      if (check(arm, k, inst, out)) nontrivial++;
    }
    console.log(
      `[simplex ${arm}] ${nontrivial}/${n} with a nonzero optimum, max row spread ${maxSpread.toExponential(2)}`
    );
    // An arm whose optima are all zero would pass on feasibility alone.
    expect(nontrivial).toBeGreaterThanOrEqual(n / 4);
    if (arm === 'badly-scaled') expect(maxSpread).toBeGreaterThan(1e12);
    expect(out.slice(0, 8)).toEqual([]);
    expect(out.length).toBe(0);
  });
});
