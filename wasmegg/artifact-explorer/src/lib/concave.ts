// The per-target objective g(s) = log(1 - e^-s), its derivative, and the line search both Frank-Wolfe
// drivers run on it. A leaf module: the two drivers differ in how they walk the craft polytope, but they
// must agree to the last bit on what they are maximizing.

// g(s) = log(1 - exp(-s)), computed as log(-expm1(-s)). The form matters: evaluating `1 - exp(-s)` directly
// cancels in the s ~ 1e-13 regime the arena scores in.
export function logHit(s: number): number {
  return s > 0 ? Math.log(-Math.expm1(-s)) : -Infinity;
}

// g'(s); grows like 1/s as s -> 0, capped to keep linearizations finite. The cut generator in
// `solver/milp.ts` deliberately does *not* use this — at s ~ 1e-13 the cap is active at every tangent point.
export const GPRIME_CAP = 1e12;

export function gPrime(s: number): number {
  return s <= 0 ? GPRIME_CAP : Math.min(1 / Math.expm1(s), GPRIME_CAP);
}

const GOLDEN = (Math.sqrt(5) - 1) / 2;

// argmax over [0, 1] of a unimodal (concave) f. Robust to f returning
// -Infinity on part of the interval.
export function goldenSectionArgmax(f: (x: number) => number, iters = 100): number {
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
