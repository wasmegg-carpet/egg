import { describe, expect, it } from 'vitest';
import { simplexMax } from '@/lib/solver/simplex';
// Exact BigInt rationals, so the truth an arm is judged against never turns on the float
// arithmetic under test. `tests/arena/independence.spec.ts` keeps the arena's candidates away
// from `src/lib` and `tests/unit`; the oracle is on neither side of that fence and shares no
// code with `simplexMax`.
import { Frac } from '../oracle/rational';
import { simplexMaximizeFull } from '../oracle/simplex';

const PREC = 9;

// Verify the optimum independently by enumerating vertices: solve every set of
// n active constraints from Ax <= b and x >= 0. These bounded instances have n <= 5,
// requiring at most C(10, 5) = 252 small systems. No solver code is shared.

interface Instance {
  A: number[][];
  b: number[];
  c: number[];
  spread: number; // max_i r_i / min_i r_i over row magnitudes r_i = max_j |A[i][j]|
  rhsRatio: number; // max_i b_i / r_i — within one row, which is what equilibration divides by
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

// Bound objective scale by b_0 * max_j(c_j / A_0j), using the positive budget row.
// Relative error against a near-zero optimum would amplify rounding noise.
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

// Vertex enumeration in floats cannot arbitrate an instance whose vertices sit at 1e18: the
// slack test there is only accurate to a few thousand. The exact solver has no such limit.
function exactOptimum(inst: Instance): number {
  return simplexMaximizeFull(
    inst.A.map(row => row.map(Frac.fromNumber)),
    inst.b.map(Frac.fromNumber),
    inst.c.map(Frac.fromNumber)
  ).objective.toNumber();
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

type Arm = 'well-scaled' | 'badly-scaled' | 'badly-scaled objective' | 'degenerate' | 'rhs-dominant';

// Positive row 0 and c >= 0 ensure feasibility at x = 0 and boundedness.
// Sparse mixed-sign rows model craft conservation; `decades` controls scale spread.
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

  // Independent of the row's own scale on this arm: a budget of 1e18 against unit prices is
  // a legitimate instance, and it is the ratio b_i / max_j |A[i][j]| — not any spread across
  // rows — that row equilibration has to survive.
  const rhsDecades = arm === 'rhs-dominant' ? 18 : 0;
  const b: number[] = [];
  for (let i = 0; i < m; i++) {
    const scale = Math.pow(10, mag[i] + rng() * rhsDecades);
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
  const rhsRatio = Math.max(...b.map((bi, i) => (mags[i] > 0 ? bi / mags[i] : 0)));
  return { A, b, c, spread: lo > 0 ? hi / lo : Infinity, rhsRatio };
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

  const truth = arm === 'rhs-dominant' ? exactOptimum(inst) : bruteForceOptimum(inst);
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
    expect(r.status).toBe('optimal');
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
    // Scaled 2x + y <= 6 with x + y <= 4: 3x + 2y peaks at (2, 2), value 10.
    // Raw tableau entries would swamp the second row's pivot tolerance.
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

// Zero and infinite scales must not produce NaN tableau entries or objectives.
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
    // Duplicate x + y <= 4 at scale 1e300. Equilibration must preserve the optimum 4.
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

describe('simplexMax when the right-hand side dwarfs the coefficients', () => {
  it('keeps a constraint whose rhs is a billion times its coefficients', () => {
    // max x + y s.t. x + y <= 1e9. Equilibrating the row by max(|A|, |b|) divided it by 1e9,
    // which put both coefficients under the pivot floor; the ratio test then found no
    // candidate row and the constraint was gone, taking the optimum to 0 with it.
    const r = simplexMax([[1, 1]], [1e9], [1, 1]);
    expect(r.objective).toBeCloseTo(1e9, PREC);
    expect(r.status).toBe('optimal');
  });

  it('prices a column whose own coefficient is 1e-9 of the row it lives in', () => {
    // max x s.t. 1e-9x + y <= 1, x + y <= 1e9. The second row is the binding one and its
    // rhs dominates it, so the same scaling defect zeroed the whole entering column.
    const r = simplexMax(
      [
        [1e-9, 1],
        [1, 1],
      ],
      [1, 1e9],
      [1, 0]
    );
    expect(r.objective).toBeCloseTo(1e9, PREC);
    expect(r.status).toBe('optimal');
  });

  it('reports a basis it could not prove optimal rather than calling it the answer', () => {
    // max x s.t. 1e-9x + y <= 1, -x + y <= 1. Only the first row bounds x, at 1e9, but its
    // 1e-9 sits under a pivot floor set by the second row's -1, so no row can leave. The
    // point returned is feasible and its objective is a lower bound; `status` is the only
    // thing that says so, and without it a caller reads 0 as the optimum.
    const r = simplexMax(
      [
        [1e-9, 1],
        [-1, 1],
      ],
      [1, 1],
      [1, 0]
    );
    expect(r.status).toBe('stalled');
    expect(r.objective).toBe(0);
    expect(r.primal).toEqual([0, 0]);
  });
});

describe('simplexMax ratio-test ties', () => {
  // Rows 0 and 1 both bind x at 4; row 2 misses by 1e-6, outside any tie band. Which of the
  // tied pair leaves the basis is not readable from the return value — both are valid ratio
  // tests and reach the same vertex — so what is pinned here is what the choice must not
  // cost: the lowest basis index wins, which on this instance means pivoting on an element a
  // thousand times smaller than the alternative, and the answer must still be exact.
  const A = [
    [1e-3, 1],
    [1, 1],
    [1, 0],
  ];
  const b = [4e-3, 4, 4 + 1e-6];
  const c = [3, 2];

  it('stays exact when the tie is split onto the smaller pivot', () => {
    const r = simplexMax(A, b, c);
    expect(r.objective).toBeCloseTo(12, PREC);
    expect(r.primal[0]).toBeCloseTo(4, PREC);
    expect(r.primal[1]).toBeCloseTo(0, PREC);
  });

  it('gives the same answer whichever order the tied rows arrive in', () => {
    // The minimum ratio is taken over every row before any row is chosen, so "tied with the
    // minimum" is a property of a row. Chained pairwise epsilon comparisons are not
    // transitive, and the row they settle on depends on the order the rows were visited.
    const order = [2, 1, 0];
    const r = simplexMax(
      order.map(i => A[i]),
      order.map(i => b[i]),
      c
    );
    expect(r.objective).toBeCloseTo(12, PREC);
    expect(r.primal[0]).toBeCloseTo(4, PREC);
  });
});

describe('simplexMax input validation', () => {
  // The slack basis is only feasible because b >= 0; without the check a negative entry
  // returns a point outside the polytope, and a NaN returns x = 0 with no complaint.
  it('rejects a negative right-hand side', () => {
    expect(() => simplexMax([[1, 1]], [-1], [1, 1])).toThrow(/b\[0\] must be >= 0/);
  });

  it('rejects NaN in b, A and c', () => {
    expect(() => simplexMax([[1, 1]], [NaN], [1, 1])).toThrow(/b\[0\] must be >= 0/);
    expect(() => simplexMax([[1, NaN]], [1], [1, 1])).toThrow(/A\[0\]\[1\] is NaN/);
    expect(() => simplexMax([[1, 1]], [1], [1, NaN])).toThrow(/c\[1\] is NaN/);
  });
});

describe('simplexMax against an independent optimum (randomized)', () => {
  it.each<[Arm, number, number]>([
    ['well-scaled', 0x51e6ce7, 2000],
    ['badly-scaled', 0x9cae1ed, 2000],
    ['badly-scaled objective', 0x0b1ec71e, 2000],
    ['degenerate', 0xde6e7a7e, 2000],
    ['rhs-dominant', 0x6b5d0117, 2000],
  ])('agrees with the independent optimum on %s instances', (arm, seed, n) => {
    const rng = mulberry32(seed);
    const out: Disagreement[] = [];
    let nontrivial = 0;
    let maxSpread = 0;
    let maxRhsRatio = 0;
    for (let k = 0; k < n; k++) {
      const inst = makeInstance(rng, arm);
      maxSpread = Math.max(maxSpread, Number.isFinite(inst.spread) ? inst.spread : 0);
      maxRhsRatio = Math.max(maxRhsRatio, inst.rhsRatio);
      if (check(arm, k, inst, out)) nontrivial++;
    }
    console.log(
      `[simplex ${arm}] ${nontrivial}/${n} with a nonzero optimum, max row spread ` +
        `${maxSpread.toExponential(2)}, max b/row ratio ${maxRhsRatio.toExponential(2)}`
    );
    // An arm whose optima are all zero would pass on feasibility alone.
    expect(nontrivial).toBeGreaterThanOrEqual(n / 4);
    if (arm === 'badly-scaled') expect(maxSpread).toBeGreaterThan(1e12);
    if (arm === 'rhs-dominant') expect(maxRhsRatio).toBeGreaterThan(1e12);
    // The first line is the readable failure: up to eight disagreements printed in full.
    // The second is the assertion that actually bounds their number.
    expect(out.slice(0, 8)).toEqual([]);
    expect(out.length).toBe(0);
  });
});
