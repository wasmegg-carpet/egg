// `formatDuration` (`lib/time.ts`). The cases are `lib/time.spec.ts`'s own, run here because `lib`'s jest
// setup does not currently run (see `probability-format.spec.ts`); the optimizer's plan view is what asked
// for the `units` option. The last block pins the default spelling against the implementation that came
// before `units`, since every other caller in the monorepo reads that default.

import { describe, expect, it } from 'vitest';
import { formatDuration } from 'lib';

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

  it('drops hours past a year only when the year itself is spelled out', () => {
    expect(formatDuration(2 * 31_536_000 + 3_600, true, { max: 'h' })).toBe('17521h');
    expect(formatDuration(2 * 31_536_000 + 3_600, true, { max: 'd' })).toBe('730d1h');
  });
});

// The implementation before `units`, verbatim.
function before(seconds: number, trim = false): string {
  if (seconds < 0) {
    return '-' + before(-seconds);
  }
  if (seconds < 60) {
    return trim ? '0m' : '0d0h0m';
  }
  if (!isFinite(seconds)) {
    return 'Forever';
  }
  if (seconds > 3_153_600_000) {
    return '>100yr';
  }
  const yy = Math.floor(seconds / 31_536_000);
  seconds -= yy * 31536000;
  const dd = Math.floor(seconds / 86400);
  seconds -= dd * 86400;
  const hh = Math.floor(seconds / 3600);
  seconds -= hh * 3600;
  const mm = Math.floor(seconds / 60);
  let s = '';
  if (yy > 0) {
    s += `${yy}y`;
  }
  if (!trim || dd > 0) {
    s += `${dd}d`;
  }
  if (!trim || yy < 1) {
    if (!trim || hh > 0) {
      s += `${hh}h`;
    }
    if (!trim || mm > 0) {
      s += `${mm}m`;
    }
  }
  return s;
}

describe('formatDuration default spelling', () => {
  it('is unchanged for every existing caller', () => {
    const small = [0, 0.5, 1, 59, 59.999, 60, 61, 90.5, 3599, 3600, 3661, 86_399, 86_400, 90_061, 172_782];
    const large = [31_535_999, 31_536_000, 31_536_000 + 90_061, 2 * 31_536_000 + 3_600, 3_153_600_000];
    const samples = [...small, ...large, 3_153_600_001, Infinity, NaN];
    // A deterministic spread across the whole range as well, fractional seconds included.
    for (let x = 0.37; x < 4e9; x = x * 1.37 + 11) samples.push(x);
    for (const s of [...samples, ...samples.map(v => -v)]) {
      for (const trim of [false, true]) expect(formatDuration(s, trim), `${s} trim=${trim}`).toBe(before(s, trim));
    }
  });
});
