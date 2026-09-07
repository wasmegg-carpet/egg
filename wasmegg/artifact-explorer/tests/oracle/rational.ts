// Exact rational arithmetic over BigInt for the oracle's simplex solver.

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

export class Frac {
  readonly n: bigint;
  readonly d: bigint; // always > 0, gcd(n, d) === 1

  constructor(n: bigint, d = 1n) {
    if (d === 0n) {
      throw new Error('division by zero');
    }
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    this.n = g === 0n ? 0n : n / g;
    this.d = g === 0n ? 1n : d / g;
  }

  static readonly ZERO = new Frac(0n);
  static readonly ONE = new Frac(1n);

  // Exact: every finite double is p / 2^k.
  static fromNumber(x: number): Frac {
    if (!Number.isFinite(x)) {
      throw new Error(`cannot convert ${x} to a rational`);
    }
    let d = 1n;
    while (!Number.isInteger(x)) {
      x *= 2;
      d *= 2n;
      if (d > 1n << 1100n) {
        throw new Error('double conversion did not terminate');
      }
    }
    return new Frac(BigInt(x), d);
  }

  add(o: Frac): Frac {
    return new Frac(this.n * o.d + o.n * this.d, this.d * o.d);
  }

  sub(o: Frac): Frac {
    return new Frac(this.n * o.d - o.n * this.d, this.d * o.d);
  }

  mul(o: Frac): Frac {
    return new Frac(this.n * o.n, this.d * o.d);
  }

  div(o: Frac): Frac {
    return new Frac(this.n * o.d, this.d * o.n);
  }

  neg(): Frac {
    return new Frac(-this.n, this.d);
  }

  // sign of (this - o)
  cmp(o: Frac): number {
    const lhs = this.n * o.d;
    const rhs = o.n * this.d;
    return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
  }

  isZero(): boolean {
    return this.n === 0n;
  }

  isPositive(): boolean {
    return this.n > 0n;
  }

  isNegative(): boolean {
    return this.n < 0n;
  }

  toNumber(): number {
    const q = Number(this.n) / Number(this.d);
    if (Number.isFinite(q)) {
      return q;
    }
    // fall back to scaled BigInt division for huge components
    const scaled = (this.n * 10n ** 18n) / this.d;
    return Number(scaled) / 1e18;
  }
}
