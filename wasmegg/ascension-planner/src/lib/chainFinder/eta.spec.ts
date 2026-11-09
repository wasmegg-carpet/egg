import { describe, expect, it } from 'vitest';
import { BuildEta, teCost } from './eta';

describe('teCost', () => {
  it('interpolates the measured profile and clamps outside it', () => {
    expect(teCost(120)).toBe(320);
    expect(teCost(150)).toBe(245);
    expect(teCost(100)).toBe(320);
    expect(teCost(489)).toBe(20);
    expect(teCost(600)).toBe(20);
  });
});

describe('BuildEta', () => {
  it('extrapolates by weighted work, not cell count', () => {
    // Two TEs, one cell each: 489 (cost 20) then 120 (cost 320).
    const eta = new BuildEta([489, 120], 1, 0);
    eta.cellDone(489, 60_000);
    // 20 units took 60 s, so 320 left takes 960 s (a cell count would say 60 s).
    expect(eta.remainingMs(60_000)).toBe(960_000);
    expect(eta.fractionDone).toBeCloseTo(20 / 340);
  });

  it('waits for enough data and follows the recent rate', () => {
    const eta = new BuildEta(Array(100).fill(0).map((_, i) => 400 + i), 1, 0);
    expect(eta.remainingMs(10_000)).toBeNull();
    // Slow for 10 min, then twice as fast for 10 min: only the fast stretch is in the window.
    let t = 0;
    for (let te = 499; te > 479; te--) eta.cellDone(te, (t += 30_000));
    for (let te = 479; te > 439; te--) eta.cellDone(te, (t += 15_000));
    const remaining = eta.remainingMs(t)!;
    let left = 0;
    for (let te = 400; te <= 439; te++) left += teCost(te);
    const recentRate = [...Array(20)].reduce((s, _, i) => s + teCost(459 - i), 0) / 300_000;
    expect(remaining).toBeCloseTo(left / recentRate, -3);
  });
});
