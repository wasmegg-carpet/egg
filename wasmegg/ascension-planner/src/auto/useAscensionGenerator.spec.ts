import { describe, expect, test } from 'vitest';
import { computeFirstDiffIdx } from './useAscensionGenerator';
import type { ChainedAscension, VariantKey } from '@/stores/autoPlanner';

function fakeChainItem(index: number, te: number | null): ChainedAscension {
  return {
    index,
    variants: {},
    goal: { type: te === null ? 'date' : 'te', te, date: '', time: '' },
  };
}

describe('computeFirstDiffIdx: no overrides', () => {
  test('everything matches: nothing needs regenerating', () => {
    const chain = [fakeChainItem(0, 50), fakeChainItem(1, 100), fakeChainItem(2, 490)];
    const idx = computeFirstDiffIdx([50, 100, 490], chain, {}, {});
    expect(idx).toBe(3);
  });

  test('a changed target TE partway through: regeneration starts exactly there', () => {
    const chain = [fakeChainItem(0, 50), fakeChainItem(1, 100), fakeChainItem(2, 490)];
    const idx = computeFirstDiffIdx([50, 150, 490], chain, {}, {});
    expect(idx).toBe(1);
  });

  test('a shorter target list than the existing chain: regeneration starts where they run out', () => {
    const chain = [fakeChainItem(0, 50), fakeChainItem(1, 100), fakeChainItem(2, 490)];
    const idx = computeFirstDiffIdx([50, 100], chain, {}, {});
    expect(idx).toBe(2);
  });
});

describe('computeFirstDiffIdx: planVariantOverrides', () => {
  test('an override on an otherwise-fully-matching chain reuses ascension k itself, regenerating only after it', () => {
    const chain = [fakeChainItem(0, 50), fakeChainItem(1, 100), fakeChainItem(2, 490)];
    const overrides: Record<number, VariantKey> = { 1: '3-sale' };
    const idx = computeFirstDiffIdx([50, 100, 490], chain, overrides, {});
    expect(idx).toBe(2); // k + 1, NOT k — ascension 1's own stored variants are still valid
  });

  test('an override on the very last ascension still forces nothing beyond it (nothing exists at k+1)', () => {
    const chain = [fakeChainItem(0, 50), fakeChainItem(1, 100)];
    const overrides: Record<number, VariantKey> = { 1: 'continue' };
    const idx = computeFirstDiffIdx([50, 100], chain, overrides, {});
    expect(idx).toBe(2); // matchCount already reached the end; clamp has nothing to pull back
  });
});

describe('computeFirstDiffIdx: endTimeOverrides (regression for the 2026-08-16 stale-reuse bug)', () => {
  test('an override on an otherwise-fully-matching chain forces regeneration starting AT k, not k + 1', () => {
    const chain = [fakeChainItem(0, 50), fakeChainItem(1, 100), fakeChainItem(2, 490)];
    const overrides: Record<number, number> = { 1: 1700000000 };
    const idx = computeFirstDiffIdx([50, 100, 490], chain, {}, overrides);
    // The bug: this used to come back 2 (k + 1), reusing ascension 1's stale pre-override
    // simulation outright — its `variants` were never regenerated against the new deadline at all,
    // so the override silently had no effect on ascension 1 itself, only on which (stale) variant
    // got picked for it.
    expect(idx).toBe(1);
  });

  test('an override on ascension 0 forces the entire chain to regenerate', () => {
    const chain = [fakeChainItem(0, 50), fakeChainItem(1, 100), fakeChainItem(2, 490)];
    const overrides: Record<number, number> = { 0: 1700000000 };
    const idx = computeFirstDiffIdx([50, 100, 490], chain, {}, overrides);
    expect(idx).toBe(0);
  });

  test('an override that has no effect on an already-partial regeneration only tightens it further', () => {
    // Target TE #2 already changed (would naturally regenerate from index 1) — an end-time override
    // on index 2 shouldn't loosen that back up.
    const chain = [fakeChainItem(0, 50), fakeChainItem(1, 100), fakeChainItem(2, 490)];
    const overrides: Record<number, number> = { 2: 1700000000 };
    const idx = computeFirstDiffIdx([50, 999, 490], chain, {}, overrides);
    expect(idx).toBe(1); // the target-TE mismatch at index 1 already forces this; the override at 2 is moot
  });

  test('an override index at or past the natural match point is a no-op (nothing stale to reuse there yet)', () => {
    const chain = [fakeChainItem(0, 50), fakeChainItem(1, 100)];
    const overrides: Record<number, number> = { 5: 1700000000 }; // out of range entirely
    const idx = computeFirstDiffIdx([50, 100], chain, {}, overrides);
    expect(idx).toBe(2);
  });
});

describe('computeFirstDiffIdx: both override kinds together', () => {
  test('a variant override at k and an end-time override at a later index both apply, end-time wins the tighter clamp', () => {
    const chain = [fakeChainItem(0, 50), fakeChainItem(1, 100), fakeChainItem(2, 200), fakeChainItem(3, 490)];
    const planOverrides: Record<number, VariantKey> = { 1: '2-sale' };
    const endOverrides: Record<number, number> = { 2: 1700000000 };
    const idx = computeFirstDiffIdx([50, 100, 200, 490], chain, planOverrides, endOverrides);
    // planVariantOverrides alone would clamp to 2 (k+1 for k=1); endTimeOverrides then clamps
    // further down to 2 (k for k=2) — same value here, but arrived at by the tighter of the two.
    expect(idx).toBe(2);
  });

  test('an end-time override at an earlier index than a variant override wins outright', () => {
    const chain = [fakeChainItem(0, 50), fakeChainItem(1, 100), fakeChainItem(2, 200), fakeChainItem(3, 490)];
    const planOverrides: Record<number, VariantKey> = { 2: '2-sale' };
    const endOverrides: Record<number, number> = { 0: 1700000000 };
    const idx = computeFirstDiffIdx([50, 100, 200, 490], chain, planOverrides, endOverrides);
    expect(idx).toBe(0);
  });
});
