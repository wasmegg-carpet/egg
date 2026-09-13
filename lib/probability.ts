// Display rules for the mission optimizer's probabilities and expected counts.
//
// These quantities span a dozen decades — a joint probability is a product over targets, and the
// solver works in nats precisely because its scores reach 1e-13 — so a fixed decimal count either
// rounds the small end to zero or claims precision at the large end that nothing behind it
// supports: drop rates come from sparse observations that can be off by multiples, and the
// envelope the search optimizes over is only good to ~4.5e-2 nats. One decimal, everywhere,
// including on the mantissa once the value is small enough to need one.

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function superscript(n: number): string {
  const digits = Math.abs(n)
    .toString()
    .replace(/\d/g, d => SUPERSCRIPT_DIGITS[+d]);
  return n < 0 ? `⁻${digits}` : digits;
}

function scientific(x: number): string {
  let exponent = Math.floor(Math.log10(x));
  let mantissa = Math.round((x / 10 ** exponent) * 10) / 10;
  // Rounding 9.97 up lands on 10.0, which is the next decade written the long way.
  if (mantissa >= 10) {
    mantissa /= 10;
    exponent++;
  }
  return `${mantissa.toFixed(1)}×10${superscript(exponent)}`;
}

// Rounding may carry a value into the band above; where it does, the band above spells it. Left to
// its own band, 0.0996 renders as "0.10" and 0.00997 as "10.0×10⁻³" — each the neighbouring band's
// answer, spelled wrong.
function formatMagnitude(x: number): string {
  if (x >= 0.1) {
    return String(Math.round(x * 10) / 10);
  }
  const oneSigFig = Math.round(x * 100) / 100;
  if (oneSigFig >= 0.1) {
    return String(oneSigFig);
  }
  return oneSigFig >= 0.01 ? oneSigFig.toFixed(2) : scientific(x);
}

/**
 * A probability in [0, 1] as a percentage, to one decimal — of the mantissa below 0.01%.
 *
 * 0 and 1 are reported exactly, because the optimizer means them exactly: an unreachable target
 * scores -Infinity and a prob-1 craft scores +Infinity. Anything merely close to certain is
 * reported as `>99.9%` rather than rounded up to a `100%` the solver never claimed.
 */
export function formatProbability(p: number): string {
  if (!Number.isFinite(p)) return 'NaN';
  if (p < 0) return `-${formatProbability(-p)}`;
  if (p === 0) return '0%';
  if (p >= 1) return '100%';
  if (p > 0.999) return '>99.9%';
  return `${formatMagnitude(p * 100)}%`;
}

/** An expected count — λ, expected drops — on the same scale rules as `formatProbability`. */
export function formatExpectedCount(x: number): string {
  if (!Number.isFinite(x)) return 'NaN';
  if (x < 0) return `-${formatExpectedCount(-x)}`;
  if (x === 0) return '0';
  return formatMagnitude(x);
}
