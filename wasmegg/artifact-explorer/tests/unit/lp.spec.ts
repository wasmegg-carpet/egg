import { describe, it, expect } from 'vitest';
import { solveLp } from '@/lib/lp';

const PREC = 9;

describe('solveLp', () => {
  it('solves a trivial one-variable problem', () => {
    // max x s.t. x <= 5
    const r = solveLp(new Float64Array([1]), [new Float64Array([1])], new Float64Array([5]));
    expect(r.status).toBe('optimal');
    expect(r.objective).toBeCloseTo(5, PREC);
    expect(r.primal[0]).toBeCloseTo(5, PREC);
    expect(r.duals[0]).toBeCloseTo(1, PREC);
  });

  it('solves two independent constraints', () => {
    // max x+y s.t. x <= 3, y <= 4
    const r = solveLp(
      new Float64Array([1, 1]),
      [new Float64Array([1, 0]), new Float64Array([0, 1])],
      new Float64Array([3, 4])
    );
    expect(r.status).toBe('optimal');
    expect(r.objective).toBeCloseTo(7, PREC);
    expect(r.primal[0]).toBeCloseTo(3, PREC);
    expect(r.primal[1]).toBeCloseTo(4, PREC);
    expect(r.duals[0]).toBeCloseTo(1, PREC);
    expect(r.duals[1]).toBeCloseTo(1, PREC);
  });

  it('finds a vertex that needs multiple pivots', () => {
    // max 5x+4y s.t. 6x+4y <= 24, x+2y <= 6
    // optimum is x=3, y=1.5, obj=21, duals=[0.75, 0.5]
    const r = solveLp(
      new Float64Array([5, 4]),
      [new Float64Array([6, 4]), new Float64Array([1, 2])],
      new Float64Array([24, 6])
    );
    expect(r.status).toBe('optimal');
    expect(r.objective).toBeCloseTo(21, PREC);
    expect(r.primal[0]).toBeCloseTo(3, PREC);
    expect(r.primal[1]).toBeCloseTo(1.5, PREC);
    expect(r.duals[0]).toBeCloseTo(0.75, PREC);
    expect(r.duals[1]).toBeCloseTo(0.5, PREC);
  });

  it('gives slack constraints a zero dual', () => {
    // max x+2y s.t. x+y <= 4, x <= 2, y <= 3
    // optimum x=1, y=3; the x <= 2 constraint is slack so its dual must be 0
    const r = solveLp(
      new Float64Array([1, 2]),
      [new Float64Array([1, 1]), new Float64Array([1, 0]), new Float64Array([0, 1])],
      new Float64Array([4, 2, 3])
    );
    expect(r.status).toBe('optimal');
    expect(r.objective).toBeCloseTo(7, PREC);
    expect(r.primal[0]).toBeCloseTo(1, PREC);
    expect(r.primal[1]).toBeCloseTo(3, PREC);
    expect(r.duals[0]).toBeCloseTo(1, PREC);
    expect(r.duals[1]).toBeCloseTo(0, PREC);
    expect(r.duals[2]).toBeCloseTo(1, PREC);
  });

  it('gives a redundant upper bound a zero dual', () => {
    // x <= 10 is redundant when x <= 5 binds
    const r = solveLp(new Float64Array([1]), [new Float64Array([1]), new Float64Array([1])], new Float64Array([5, 10]));
    expect(r.status).toBe('optimal');
    expect(r.objective).toBeCloseTo(5, PREC);
    expect(r.duals[0]).toBeCloseTo(1, PREC);
    expect(r.duals[1]).toBeCloseTo(0, PREC);
  });

  it('handles a zero RHS', () => {
    // max x s.t. x <= 0
    const r = solveLp(new Float64Array([1]), [new Float64Array([1])], new Float64Array([0]));
    expect(r.status).toBe('optimal');
    expect(r.objective).toBeCloseTo(0, PREC);
    expect(r.primal[0]).toBeCloseTo(0, PREC);
    expect(r.duals[0]).toBeCloseTo(1, PREC);
  });

  it('handles a zero objective', () => {
    const r = solveLp(new Float64Array([0]), [new Float64Array([1])], new Float64Array([5]));
    expect(r.status).toBe('optimal');
    expect(r.objective).toBeCloseTo(0, PREC);
  });

  it('reports infeasible on a negative RHS', () => {
    const r = solveLp(new Float64Array([1, 1]), [new Float64Array([1, 0])], new Float64Array([-1]));
    expect(r.status).toBe('infeasible');
    expect(r.objective).toBe(0);
  });

  it('reports unbounded when a variable has no upper bound', () => {
    // max x s.t. y <= 1; x is unconstrained
    const r = solveLp(new Float64Array([1, 0]), [new Float64Array([0, 1])], new Float64Array([1]));
    expect(r.status).toBe('unbounded');
    expect(r.objective).toBe(Infinity);
  });

  it('solves a production-shaped LP whose rows differ by 1e14', () => {
    // max 3x + 2y  s.t.  2e14 x + 1e14 y <= 6e14   (a fuel-budget row)
    //                          x +      y <= 4     (a conservation row)
    // The first row is just 2x + y <= 6 in disguise. Vertices of the feasible
    // region are (0,0)=0, (3,0)=9, (2,2)=10, (0,4)=8, so the optimum is
    // x=2, y=2, obj=10 with both rows binding. Duals solve A'y = c:
    //   2e14*y0 +   y1 = 3
    //   1e14*y0 +   y1 = 2   =>  y0 = 1e-14, y1 = 1
    // and b'y = 6e14*1e-14 + 4*1 = 10, matching the primal objective.
    const r = solveLp(
      new Float64Array([3, 2]),
      [new Float64Array([2e14, 1e14]), new Float64Array([1, 1])],
      new Float64Array([6e14, 4])
    );
    expect(r.status).toBe('optimal');
    expect(r.objective).toBeCloseTo(10, PREC);
    expect(r.primal[0]).toBeCloseTo(2, PREC);
    expect(r.primal[1]).toBeCloseTo(2, PREC);
    expect(r.duals[0] / 1e-14).toBeCloseTo(1, PREC); // relative: the dual is 1e-14
    expect(r.duals[1]).toBeCloseTo(1, PREC);
  });
});

// Klee-Minty cube of dimension d: max sum 2^(d-1-j) x_j subject to
// 2*sum_{j<i} 2^(i-j) x_j + x_i <= 5^(i+1). Bland's rule walks it in a
// Fibonacci-ish number of pivots (d=14 -> 1219, d=16 -> 3193), while solveLp's
// budget is 50*(n+m+1) (1450 and 1650 respectively). That straddles the cap and
// gives a deterministic instance on each side of it.
function kleeMinty(d: number): { c: Float64Array; A: Float64Array[]; b: Float64Array } {
  const c = new Float64Array(d);
  for (let j = 0; j < d; j++) c[j] = Math.pow(2, d - 1 - j);
  const A: Float64Array[] = [];
  const b = new Float64Array(d);
  for (let i = 0; i < d; i++) {
    const row = new Float64Array(d);
    for (let j = 0; j < i; j++) row[j] = Math.pow(2, i - j + 1);
    row[i] = 1;
    A.push(row);
    b[i] = Math.pow(5, i + 1);
  }
  return { c, A, b };
}

describe('solveLp iteration limit', () => {
  it('reports optimal when the pivot budget is enough (Klee-Minty d=14)', () => {
    const { c, A, b } = kleeMinty(14);
    const r = solveLp(c, A, b);
    expect(r.status).toBe('optimal');
    // the cube's optimum is the last constraint's RHS
    expect(r.objective / Math.pow(5, 14)).toBeCloseTo(1, PREC);
  });

  it('reports iteration-limit instead of a false optimal (Klee-Minty d=16)', () => {
    const { c, A, b } = kleeMinty(16);
    const r = solveLp(c, A, b);
    expect(r.status).toBe('iteration-limit');
    expect(r.status).not.toBe('optimal');
    // it stopped short of the true optimum, which is exactly the bug: before
    // this status existed the caller would have believed the number below
    expect(r.objective).toBeLessThan(Math.pow(5, 16));
  });
});

// ---------------------------------------------------------------------------
// Randomized optimality-certificate sweep.
//
// This is the load-bearing test. It does not compare against another solver; it
// checks the LP duality conditions directly, so anything the solver returns as
// 'optimal' has to carry its own proof: primal feasible, dual feasible, and a
// zero duality gap. Premature termination -- the failure mode where a badly
// scaled tableau makes an improving column look non-negative against an
// absolute epsilon -- shows up precisely as a nonzero gap, because the reported
// basis is primal feasible but its duals are not dual feasible.
// ---------------------------------------------------------------------------

// same shape as tests/oracle/generate.ts:29
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

interface Instance {
  c: Float64Array;
  A: Float64Array[];
  b: Float64Array;
  spread: number; // max_i r_i / min_i r_i, where r_i = max_j |A[i][j]|
}

// Row 0 is an all-positive budget row (the fuel/time rows in the real problem),
// which together with c >= 0 keeps every instance bounded and feasible at x=0.
// The remaining rows are mixed-sign and sparse, like the craft-conservation
// rows. Per-row magnitude multipliers are what create the pathology.
function makeInstance(rng: () => number, badlyScaled: boolean): Instance {
  const n = 2 + Math.floor(rng() * 11); // 2..12 vars
  const m = 2 + Math.floor(rng() * 11); // 2..12 constraints

  // magnitude exponent per row: 0..15 decades when badly scaled, else 0..2
  const mag = new Float64Array(m);
  if (badlyScaled) {
    // pin the extremes so the instance genuinely spans >= 1e9, then let the
    // rest fall anywhere in between
    mag[0] = 9 + rng() * 6;
    mag[1] = 0;
    for (let i = 2; i < m; i++) mag[i] = rng() * 15;
  } else {
    for (let i = 0; i < m; i++) mag[i] = rng() * 2;
  }

  const A: Float64Array[] = [];
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(n);
    const scale = Math.pow(10, mag[i]);
    for (let j = 0; j < n; j++) {
      if (i === 0) {
        row[j] = (0.1 + rng() * 0.9) * scale; // budget row: strictly positive
      } else if (rng() < 0.35) {
        row[j] = 0; // sparsity
      } else {
        row[j] = (rng() * 2 - 1) * scale;
      }
    }
    if (i > 0) {
      // guarantee the row is not entirely zero, so its scale actually matters
      row[Math.floor(rng() * n)] = (rng() < 0.5 ? -1 : 1) * (0.1 + rng() * 0.9) * scale;
    }
    A.push(row);
  }

  const b = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const scale = Math.pow(10, mag[i]);
    // conservation rows frequently have a zero RHS in the real problem
    b[i] = i > 0 && rng() < 0.3 ? 0 : rng() * 10 * scale;
  }
  if (b[0] === 0) b[0] = Math.pow(10, mag[0]);

  const c = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    c[j] = rng() < 0.15 ? 0 : Math.pow(10, rng() * 3 - 1.5);
  }

  let lo = Infinity;
  let hi = 0;
  for (let i = 0; i < m; i++) {
    let r = 0;
    for (let j = 0; j < n; j++) r = Math.max(r, Math.abs(A[i][j]));
    lo = Math.min(lo, r);
    hi = Math.max(hi, r);
  }
  return { c, A, b, spread: lo > 0 ? hi / lo : Infinity };
}

const REL = 1e-6;

interface Violation {
  kind: string;
  index: number;
  rel: number;
}

// Every check is relative to the natural magnitude of the quantity involved,
// because an absolute tolerance is meaningless when rows span 1e15.
function certify(inst: Instance, primal: Float64Array, duals: Float64Array, objective: number): Violation[] {
  const { c, A, b } = inst;
  const n = c.length;
  const m = A.length;
  const out: Violation[] = [];

  const rowMaxArr = new Float64Array(m);
  const colMaxArr = new Float64Array(n);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const v = Math.abs(A[i][j]);
      if (v > rowMaxArr[i]) rowMaxArr[i] = v;
      if (v > colMaxArr[j]) colMaxArr[j] = v;
    }
  }

  let xMax = 0;
  for (let j = 0; j < n; j++) xMax = Math.max(xMax, Math.abs(primal[j]));
  let yMax = 0;
  for (let i = 0; i < m; i++) yMax = Math.max(yMax, Math.abs(duals[i]));

  // Sign checks are normalized the same way the residuals below are: in
  // "effect" units rather than raw magnitude. |A_:j|_inf * x_j bounds how much
  // x_j can move any row activity, and |A_i|_inf * y_i bounds how much y_i can
  // move any reduced cost. Raw ||x||_inf / ||y||_inf would be meaningless here,
  // since a dual sitting on a 1e14-coefficient row is numerically tiny while
  // dominating every price it touches -- and its 1e0-coefficient neighbour is
  // numerically comparable while contributing nothing.
  let xEffMax = 0;
  for (let j = 0; j < n; j++) {
    xEffMax = Math.max(xEffMax, Math.abs(primal[j]) * Math.max(colMaxArr[j], Math.abs(c[j])));
  }
  let yEffMax = 0;
  for (let i = 0; i < m; i++) {
    yEffMax = Math.max(yEffMax, Math.abs(duals[i]) * rowMaxArr[i]);
  }

  // x >= 0
  for (let j = 0; j < n; j++) {
    if (primal[j] < 0) {
      const eff = -primal[j] * Math.max(colMaxArr[j], Math.abs(c[j]));
      const rel = eff / Math.max(xEffMax, Number.MIN_VALUE);
      if (rel > REL) out.push({ kind: 'primal-sign', index: j, rel });
    }
  }

  // Ax <= b. The residual is measured against the row's natural magnitude,
  // |b_i| or ||A_i||_inf * ||x||_inf, not against the surviving sum: a b_i = 0
  // row whose terms all cancel to 1e-16 is satisfied, not 100% violated.
  for (let i = 0; i < m; i++) {
    const Ai = A[i];
    let ax = 0;
    for (let j = 0; j < n; j++) ax += Ai[j] * primal[j];
    if (ax > b[i]) {
      const rel = (ax - b[i]) / Math.max(Math.abs(b[i]), rowMaxArr[i] * xMax, Number.MIN_VALUE);
      if (rel > REL) out.push({ kind: 'primal-feas', index: i, rel });
    }
  }

  // y >= 0
  for (let i = 0; i < m; i++) {
    if (duals[i] < 0) {
      const rel = (-duals[i] * rowMaxArr[i]) / Math.max(yEffMax, Number.MIN_VALUE);
      if (rel > REL) out.push({ kind: 'dual-sign', index: i, rel });
    }
  }

  // A'y >= c, scaled the same way against |c_j| or ||A_:j||_inf * ||y||_inf
  for (let j = 0; j < n; j++) {
    let aty = 0;
    for (let i = 0; i < m; i++) aty += A[i][j] * duals[i];
    if (aty < c[j]) {
      const rel = (c[j] - aty) / Math.max(Math.abs(c[j]), colMaxArr[j] * yMax, Number.MIN_VALUE);
      if (rel > REL) out.push({ kind: 'dual-feas', index: j, rel });
    }
  }

  // strong duality: c'x == b'y == objective
  let cx = 0;
  for (let j = 0; j < n; j++) cx += c[j] * primal[j];
  let by = 0;
  for (let i = 0; i < m; i++) by += b[i] * duals[i];
  const denom = Math.max(Math.abs(cx), Math.abs(by), Number.MIN_VALUE);
  const gap = Math.abs(cx - by) / denom;
  if (gap > REL) out.push({ kind: 'duality-gap', index: -1, rel: gap });
  const objErr = Math.abs(cx - objective) / Math.max(Math.abs(cx), Math.abs(objective), Number.MIN_VALUE);
  if (objErr > REL) out.push({ kind: 'objective-mismatch', index: -1, rel: objErr });

  return out;
}

describe('solveLp optimality certificate (randomized)', () => {
  it('certifies every solve it reports as optimal', () => {
    const N = 2500;
    const rng = mulberry32(0x5eed1234);
    let certified = 0;
    let badlyScaled = 0;
    let nontrivial = 0;
    const byStatus: Record<string, number> = {};
    const violations: { seed: number; v: Violation }[] = [];

    for (let k = 0; k < N; k++) {
      const inst = makeInstance(rng, k % 2 === 0);
      if (inst.spread > 1e9) badlyScaled++;

      const r = solveLp(inst.c, inst.A, inst.b);
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (r.status !== 'optimal') continue;

      // copy out: primal/duals are views into a buffer the next call reuses
      const primal = Float64Array.from(r.primal);
      const duals = Float64Array.from(r.duals);
      certified++;
      if (Math.abs(r.objective) > 0) nontrivial++;

      for (const v of certify(inst, primal, duals, r.objective)) {
        violations.push({ seed: k, v });
      }
    }

    console.log(
      `[lp certificate] ${certified}/${N} optimal and certified, ${violations.length} violations; ` +
        `badly-scaled (row spread > 1e9): ${badlyScaled}; nontrivial optima: ${nontrivial}; ` +
        `statuses: ${JSON.stringify(byStatus)}`
    );

    // the badly-scaled arm must actually be exercised, or the sweep could pass
    // by only ever seeing well-conditioned problems
    expect(badlyScaled).toBeGreaterThanOrEqual(300);
    // ...and the optima must be non-degenerate, or feasibility alone would pass
    expect(nontrivial).toBeGreaterThanOrEqual(1000);
    expect(certified).toBeGreaterThanOrEqual(2000);
    expect(violations.slice(0, 10)).toEqual([]);
    expect(violations.length).toBe(0);
  });
});
