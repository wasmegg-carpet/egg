// Spec for `sleep.ts`, the arena's sleep model: which variants a launch splits into and what a slot holds.
// Pinned because it is part of the goalpost: a variant rule that drifted would move every sleep-on score.

import { describe, expect, it } from 'vitest';
import { DAY_SECONDS, sleepCapacity, sleepVariants } from './sleep';

const H = 3600;

interface Opt {
  id: string;
  actualTime: number;
  rawTime: number;
  nights?: number;
}

const opt = (hours: number, rawHours = hours): Opt => ({ id: 'x', actualTime: hours * H, rawTime: rawHours * H });

// Each variant as [waking hours, nights], rounded to dodge float noise in the expectations.
const shape = (variants: readonly Opt[]) =>
  variants.map(v => [Math.round((v.actualTime / H) * 1000) / 1000, v.nights ?? 0]);

describe('sleepVariants', () => {
  it('is the identity with no sleep: same array, no `nights` field', () => {
    const menu = [opt(0.33), opt(19.2), opt(38.4)];
    expect(sleepVariants(menu, 0)).toBe(menu);
    expect(menu.every(o => !('nights' in o))).toBe(true);
  });

  it('splits the report table at a 16h/8h day', () => {
    const S = 8 * H;
    // Chicken One, Short: daytime, or launched at bedtime for no waking time and one night.
    expect(shape(sleepVariants([opt(0.33)], S))).toEqual([
      [0.33, 0],
      [0, 1],
    ]);
    // Henerprise, Short.
    expect(shape(sleepVariants([opt(9.6)], S))).toEqual([
      [9.6, 0],
      [1.6, 1],
    ]);
    // Henerprise, Standard: too long for one waking window.
    expect(shape(sleepVariants([opt(19.2)], S))).toEqual([[11.2, 1]]);
    // Atreggies Henliner, Standard.
    expect(shape(sleepVariants([opt(28.8)], S))).toEqual([
      [20.8, 1],
      [16, 2],
    ]);
    // Henerprise, Extended.
    expect(shape(sleepVariants([opt(38.4)], S))).toEqual([
      [30.4, 1],
      [22.4, 2],
    ]);
  });

  it('applies the launch-period floor before splitting, to overnight variants too', () => {
    // Low effort: a 0.5h ship charged a 24h period. Neither variant may come out cheaper than a 24h ship's.
    const floored = sleepVariants([opt(24, 0.5)], 8 * H);
    expect(shape(floored)).toEqual(shape(sleepVariants([opt(24)], 8 * H)));
    expect(shape(floored)).toEqual([
      [16, 1],
      [16, 2],
    ]);
    // `rawTime` is kept as it was.
    expect(floored.every(v => v.rawTime === 0.5 * H)).toBe(true);
  });

  it('rejects a sleep window of a whole day or more', () => {
    expect(() => sleepVariants([opt(1)], DAY_SECONDS)).toThrow();
    expect(() => sleepVariants([opt(1)], -1)).toThrow();
  });

  it('gives each overnight variant its own id and keeps the daytime one', () => {
    const v = sleepVariants([opt(9.6)], 8 * H);
    expect(v.map(o => o.id)).toEqual(['x', 'x~night1']);
  });

  it('bounds every variant by the rule it relaxes', () => {
    // Waking seconds >= d - m*S (the ship has to finish) and >= (m-1)*W (whole waking windows inside it),
    // with equality in one of the two, and a daytime variant only when it fits one waking window.
    for (const sleepHours of [4, 6, 8, 10, 12]) {
      const S = sleepHours * H;
      const W = DAY_SECONDS - S;
      for (let d = 0; d <= 4 * DAY_SECONDS; d += 1234.5) {
        const variants = sleepVariants<Opt>([{ id: 'x', actualTime: d, rawTime: d }], S);
        expect(variants.length).toBeGreaterThan(0);
        for (const v of variants) {
          const m = v.nights ?? 0;
          if (m === 0) {
            expect(d).toBeLessThanOrEqual(W);
            expect(v.actualTime).toBe(d);
            continue;
          }
          expect(v.actualTime).toBe(Math.max(d - m * S, (m - 1) * W));
          // Spans m nights: (m-1)*D <= d <= m*D + W.
          expect(d).toBeGreaterThanOrEqual((m - 1) * DAY_SECONDS);
          expect(d).toBeLessThanOrEqual(m * DAY_SECONDS + W);
        }
      }
    }
  });
});

describe('sleepCapacity', () => {
  it('counts whole nights and the waking time around them', () => {
    const S = 8 * H;
    expect(sleepCapacity(3 * DAY_SECONDS, S)).toEqual({ wakingSecondsPerSlot: 3 * 16 * H, nightsPerSlot: 3 });
    // A trailing partial day contributes at most one waking window, and its partial night nothing.
    expect(sleepCapacity(3 * DAY_SECONDS + 10 * H, S)).toEqual({
      wakingSecondsPerSlot: 3 * 16 * H + 10 * H,
      nightsPerSlot: 3,
    });
    expect(sleepCapacity(3 * DAY_SECONDS + 20 * H, S)).toEqual({
      wakingSecondsPerSlot: 4 * 16 * H,
      nightsPerSlot: 3,
    });
    // Under a day: no night at all.
    expect(sleepCapacity(5 * H, S)).toEqual({ wakingSecondsPerSlot: 5 * H, nightsPerSlot: 0 });
  });
});
