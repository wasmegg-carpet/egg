import { describe, expect, test } from 'vitest';
import { pickVariant, type VariantKey, type VariantResult } from './autoPlanner';
import type { AscensionSummary } from '@/auto/types';

function fakeVariant(overrides: Partial<AscensionSummary> = {}): VariantResult {
  const summary: AscensionSummary = {
    id: 'asc_0',
    startTime: 0,
    endTime: 1000,
    totalDurationSeconds: 1000,
    buildPhaseEndTime: 0,
    buildPhaseSaleCount: 1,
    buildDurationSeconds: 0,
    startTE: 0,
    endTE: 0,
    teGained: 0,
    maxELR: 1,
    maxEarningsRate: 1,
    startSoulEggs: 0,
    endSoulEggs: 0,
    startShiftCount: 0,
    endShiftCount: 12,
    totalShiftCost: 0,
    eggsDelivered: {} as any,
    teEarned: {} as any,
    finalTE: {} as any,
    lastTEDurationSeconds: 0,
    strategyLabel: '1-sale build',
    isMaxELRAscension: false,
    tier13Unlocked: false,
    ...overrides,
  };
  return { summary, actions: [] };
}

describe('pickVariant', () => {
  test('an explicit override wins outright, regardless of duration or TE', () => {
    const variants: Partial<Record<VariantKey, VariantResult>> = {
      '1-sale': fakeVariant({ totalDurationSeconds: 100, endTE: 1 }),
      '3-sale': fakeVariant({ totalDurationSeconds: 9999, endTE: 0 }),
    };

    expect(pickVariant(variants, '3-sale')).toBe(variants['3-sale']);
  });

  test('an override naming an absent variant is ignored, falling back to the normal pick', () => {
    const variants: Partial<Record<VariantKey, VariantResult>> = {
      '1-sale': fakeVariant({ totalDurationSeconds: 100 }),
    };

    expect(pickVariant(variants, '3-sale')).toBe(variants['1-sale']);
  });

  describe('no override, no end-time deadline: shortest duration wins', () => {
    test('picks the fastest of several variants', () => {
      const variants: Partial<Record<VariantKey, VariantResult>> = {
        '1-sale': fakeVariant({ totalDurationSeconds: 500 }),
        '2-sale': fakeVariant({ totalDurationSeconds: 200 }),
        '3-sale': fakeVariant({ totalDurationSeconds: 800 }),
      };

      expect(pickVariant(variants)).toBe(variants['2-sale']);
    });

    test('a variant with a higher endTE but longer duration still loses', () => {
      const variants: Partial<Record<VariantKey, VariantResult>> = {
        '1-sale': fakeVariant({ totalDurationSeconds: 100, endTE: 1 }),
        '3-sale': fakeVariant({ totalDurationSeconds: 200, endTE: 50 }),
      };

      expect(pickVariant(variants)).toBe(variants['1-sale']);
    });
  });

  describe('hasEndTimeOverride: highest endTE wins instead', () => {
    test('picks the variant that reached the most TE by the shared deadline', () => {
      const variants: Partial<Record<VariantKey, VariantResult>> = {
        '1-sale': fakeVariant({ totalDurationSeconds: 1000, endTE: 5 }),
        '2-sale': fakeVariant({ totalDurationSeconds: 1000, endTE: 8 }),
        '3-sale': fakeVariant({ totalDurationSeconds: 1000, endTE: 3 }),
      };

      expect(pickVariant(variants, undefined, true)).toBe(variants['2-sale']);
    });

    test('a variant with shorter duration but lower endTE loses under a deadline', () => {
      const variants: Partial<Record<VariantKey, VariantResult>> = {
        '1-sale': fakeVariant({ totalDurationSeconds: 100, endTE: 1 }),
        '3-sale': fakeVariant({ totalDurationSeconds: 999, endTE: 50 }),
      };

      expect(pickVariant(variants, undefined, true)).toBe(variants['3-sale']);
    });

    test('an explicit variant override still wins over the endTE comparison', () => {
      const variants: Partial<Record<VariantKey, VariantResult>> = {
        '1-sale': fakeVariant({ endTE: 50 }),
        '3-sale': fakeVariant({ endTE: 1 }),
      };

      expect(pickVariant(variants, '3-sale', true)).toBe(variants['3-sale']);
    });

    test('a single-variant map returns that variant regardless of the flag', () => {
      const variants: Partial<Record<VariantKey, VariantResult>> = {
        '1-sale': fakeVariant({ endTE: 7 }),
      };

      expect(pickVariant(variants, undefined, true)).toBe(variants['1-sale']);
    });
  });
});
