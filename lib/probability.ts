// Format probabilities and expected counts without rounding small values to zero.
// Limit precision to reflect uncertainty in observed drop rates.

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
  // Carry a rounded mantissa of 10 into the next exponent.
  if (mantissa >= 10) {
    mantissa /= 10;
    exponent++;
  }
  return `${mantissa.toFixed(1)}×10${superscript(exponent)}`;
}

// Choose notation after rounding at band boundaries (e.g. 0.0996 becomes 0.1).
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
 * Format a probability as a percentage; use scientific notation below 0.01%.
 * Preserve exact 0 and 1, and display near-certainty as >99.9%.
 */
export function formatProbability(p: number): string {
  if (!Number.isFinite(p)) return 'NaN';
  if (p < 0) return `-${formatProbability(-p)}`;
  if (p === 0) return '0%';
  if (p >= 1) return '100%';
  if (p > 0.999) return '>99.9%';
  return `${formatMagnitude(p * 100)}%`;
}

/** An expected count, such as λ or expected drops, on the same scale rules as `formatProbability`. */
export function formatExpectedCount(x: number): string {
  if (!Number.isFinite(x)) return 'NaN';
  if (x < 0) return `-${formatExpectedCount(-x)}`;
  if (x === 0) return '0';
  return formatMagnitude(x);
}
