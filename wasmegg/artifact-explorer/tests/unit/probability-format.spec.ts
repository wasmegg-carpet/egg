// `formatProbability` / `formatExpectedCount` (`lib/probability.ts`), which every probability the
// optimizer shows goes through. The spec lives here rather than beside the source because `lib`'s
// own jest setup does not currently run, and the optimizer is the only consumer.

import { describe, expect, it } from 'vitest';
import { formatExpectedCount, formatProbability } from 'lib';

describe('formatProbability', () => {
  it('reports the certain ends exactly', () => {
    expect(formatProbability(0)).toBe('0%');
    expect(formatProbability(1)).toBe('100%');
  });
  it('never rounds up to a certainty the solver did not claim', () => {
    expect(formatProbability(0.9999)).toBe('>99.9%');
    expect(formatProbability(0.999)).toBe('99.9%');
  });
  it('gives one decimal down to 0.1%', () => {
    expect(formatProbability(0.87654)).toBe('87.7%');
    expect(formatProbability(0.2)).toBe('20%');
    expect(formatProbability(0.0483)).toBe('4.8%');
    expect(formatProbability(0.0016)).toBe('0.2%');
  });
  it('gives one significant figure between 0.01% and 0.1%', () => {
    expect(formatProbability(8e-4)).toBe('0.08%');
    expect(formatProbability(3.7e-4)).toBe('0.04%');
  });
  it('goes scientific below 0.01%, one decimal of mantissa', () => {
    expect(formatProbability(1.5e-5)).toBe('1.5×10⁻³%');
    expect(formatProbability(2.9e-8)).toBe('2.9×10⁻⁶%');
    expect(formatProbability(1.23e-13)).toBe('1.2×10⁻¹¹%');
  });
  it('bands on the rounded value, not the raw one', () => {
    expect(formatProbability(9.96e-4)).toBe('0.1%');
    expect(formatProbability(9.97e-5)).toBe('0.01%');
    expect(formatProbability(9.97e-6)).toBe('1.0×10⁻³%');
  });
  it('keeps tiny probabilities apart from each other and from zero', () => {
    expect(formatProbability(6.25e-6)).not.toBe(formatProbability(1e-8));
    expect(formatProbability(6.25e-6)).not.toBe('0%');
  });
  it('passes NaN through rather than printing a number', () => {
    expect(formatProbability(NaN)).toBe('NaN');
  });
});

describe('formatExpectedCount', () => {
  it('uses the same bands without the percentage', () => {
    expect(formatExpectedCount(0)).toBe('0');
    expect(formatExpectedCount(12.345)).toBe('12.3');
    expect(formatExpectedCount(0.4512)).toBe('0.5');
    expect(formatExpectedCount(0.037)).toBe('0.04');
    expect(formatExpectedCount(4e-4)).toBe('4.0×10⁻⁴');
  });
});
