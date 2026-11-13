import { describe, expect, test } from 'vitest';
import { computeTierUnlockStatus } from 'lib/planners/calculations/tierUnlockStatus';
import { getCommonResearches } from '@/calculations/commonResearch';
import { isEarningsResearch } from 'lib/planners/calculations/researchRanking';

describe('tier unlock status', () => {
  test('a new farm has tier 1 unlocked and needs 30 purchases for tier 2', () => {
    const status = computeTierUnlockStatus({});
    expect(status.highestUnlockedTier).toBe(1);
    expect(status.nextTier).toBe(2);
    expect(status.purchasesNeeded).toBe(30);
    const tier1Earnings = getCommonResearches()
      .filter(r => r.tier === 1 && isEarningsResearch(r))
      .reduce((sum, r) => sum + r.levels, 0);
    expect(status.earningsLevelsLeft).toBe(tier1Earnings);
  });

  test('hatchery research is bought toward the tier but is not earnings research', () => {
    const before = computeTierUnlockStatus({});
    const after = computeTierUnlockStatus({ better_incubators: 5 });
    expect(after.purchasesNeeded).toBe(before.purchasesNeeded - 5);
    expect(after.earningsLevelsLeft).toBe(before.earningsLevelsLeft);
  });

  test('unlocking a tier adds its earnings research and moves the next tier on', () => {
    const status = computeTierUnlockStatus({ comfy_nests: 30 });
    expect(status.highestUnlockedTier).toBe(2);
    expect(status.nextTier).toBe(3);
    expect(status.purchasesNeeded).toBe(50);
  });
});
