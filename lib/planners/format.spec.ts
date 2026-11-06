import { describe, expect, test } from 'vitest';
import { formatDuration } from './format';

describe('formatDuration', () => {
  test('rounds a value a sub-microsecond epsilon under a whole unit up to that unit', () => {
    // Reproduces a real case: a 27h-exact silo credit (see advanceTime.ts's silo-mode `modify_bank`
    // credit) displayed as "1d 2h" instead of "1d 3h" because delta/rate (ActionHistoryItem.vue's
    // display math) landed at 97199.99999999999 seconds, not the theoretically-exact 97200.
    expect(formatDuration(97199.99999999999)).toBe('1d 3h');
    expect(formatDuration(97200)).toBe('1d 3h');
  });

  test('exact round-number durations at every unit boundary', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(5400)).toBe('1h 30m');
    expect(formatDuration(86400)).toBe('1d');
    expect(formatDuration(90000)).toBe('1d 1h');
  });

  test('only rounds to the nearest whole second, not up to the next unit', () => {
    expect(formatDuration(3599.4)).toBe('59m 59s'); // rounds to 3599s, still short of 1h
    expect(formatDuration(3599.6)).toBe('1h'); // rounds to 3600s, genuinely reaches 1h
    expect(formatDuration(3540)).toBe('59m');
  });

  test('non-finite or negative input', () => {
    expect(formatDuration(Infinity)).toBe('∞');
    expect(formatDuration(-5)).toBe('∞');
  });
});
