import { describe, expect, it } from '@jest/globals';
import { formatDuration, isDurationNormalizable, parseDurationDays } from './time';

describe('parseDurationDays', () => {
  it('parses bare integer as days', () => {
    expect(parseDurationDays('30')).toBe(30 * 86400);
  });
  it('parses bare decimal as days', () => {
    expect(parseDurationDays('1.5')).toBe(1.5 * 86400);
  });
  it('parses compound d/h/m/s', () => {
    expect(parseDurationDays('12d12h')).toBe(12 * 86400 + 12 * 3600);
    expect(parseDurationDays('10h5m')).toBe(10 * 3600 + 5 * 60);
    expect(parseDurationDays('1d2h3m4s')).toBe(86400 + 2 * 3600 + 3 * 60 + 4);
  });
  it('strips all internal whitespace, not just outer', () => {
    expect(parseDurationDays('10h 5m')).toBe(10 * 3600 + 5 * 60);
    expect(parseDurationDays(' 12 d 12 h ')).toBe(12 * 86400 + 12 * 3600);
  });
  it('is case-insensitive', () => {
    expect(parseDurationDays('12D12H')).toBe(12 * 86400 + 12 * 3600);
  });
  it('returns NaN for invalid input', () => {
    expect(parseDurationDays('')).toBeNaN();
    expect(parseDurationDays('bogus')).toBeNaN();
    expect(parseDurationDays('10x')).toBeNaN();
  });
  it('returns NaN for garbage with embedded unit-like substrings', () => {
    expect(parseDurationDays('1hbogus')).toBeNaN();
    expect(parseDurationDays('bogus1h')).toBeNaN();
    expect(parseDurationDays('30dhours')).toBeNaN();
    expect(parseDurationDays('5hgarbage')).toBeNaN();
  });
  it('parses year unit', () => {
    expect(parseDurationDays('1y35d')).toBe(31_536_000 + 35 * 86400);
  });
  it('round-trips long durations through formatDuration without losing precision', () => {
    expect(parseDurationDays(formatDuration(400 * 86400, true))).toBe(400 * 86400);
  });
});

describe('formatDuration', () => {
  it('spells XdXhXm by default, trimmed or not', () => {
    expect(formatDuration(90_061)).toBe('1d1h1m');
    expect(formatDuration(90_061, true)).toBe('1d1h1m');
    expect(formatDuration(86_400, true)).toBe('1d');
    expect(formatDuration(30)).toBe('0d0h0m');
    expect(formatDuration(30, true)).toBe('0m');
  });

  it('caps at the largest unit asked for instead of rolling up', () => {
    expect(formatDuration(172_800, true, { max: 'h' })).toBe('48h');
    expect(formatDuration(138_240, true, { max: 'h' })).toBe('38h24m');
    expect(formatDuration(400 * 86_400, true, { max: 'd' })).toBe('400d');
  });

  it('goes down to seconds when asked, and stays quiet about them when there are none', () => {
    expect(formatDuration(172_782, true, { max: 'h', min: 's' })).toBe('47h59m42s');
    expect(formatDuration(138_240, true, { max: 'h', min: 's' })).toBe('38h24m');
    expect(formatDuration(90, true, { min: 's' })).toBe('1m30s');
    expect(formatDuration(30, true, { min: 's' })).toBe('30s');
  });

  it('says zero in the finest unit on offer rather than nothing', () => {
    expect(formatDuration(0, true, { min: 's' })).toBe('0s');
    expect(formatDuration(0, true)).toBe('0m');
  });

  it('keeps the units it is given out of the year and overflow shortcuts', () => {
    expect(formatDuration(Infinity, true, { max: 'h' })).toBe('Forever');
    expect(formatDuration(4_000_000_000, true, { max: 'h' })).toBe('>100yr');
    expect(formatDuration(31_536_000 + 90_061, true)).toBe('1y1d');
  });
});

describe('isDurationNormalizable', () => {
  it('accepts valid positive durations', () => {
    expect(isDurationNormalizable('30')).toBe(true);
    expect(isDurationNormalizable('12d12h')).toBe(true);
    expect(isDurationNormalizable('295.6')).toBe(true);
  });

  it('accepts input whose normalized form drops sub-minute precision', () => {
    // ~60.1s formats to '1m'; the remainder is fine to lose
    expect(formatDuration(parseDurationDays('0.00069560'), true)).toBe('1m');
    expect(isDurationNormalizable('0.00069560')).toBe(true);
  });

  it('rejects invalid and non-positive input', () => {
    expect(isDurationNormalizable('')).toBe(false);
    expect(isDurationNormalizable('bogus')).toBe(false);
    expect(isDurationNormalizable('0')).toBe(false);
  });

  it('rejects durations past the >100yr formatting cutoff', () => {
    const input = String(101 * 365);
    expect(formatDuration(parseDurationDays(input), true)).toBe('>100yr');
    expect(isDurationNormalizable(input)).toBe(false);
  });
});
