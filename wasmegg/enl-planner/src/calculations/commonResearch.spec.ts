import { expect, test } from 'vitest';
import { getDiscountedResearchPrice, type CommonResearch } from './commonResearch';

test('research prices round up after discounts', () => {
  const research = { prices: [0.5, 10] } as unknown as CommonResearch;
  const mods = { labUpgradeLevel: 0, researchCostMultiplier: 1, puzzleCubeMultiplier: 1 };
  expect(getDiscountedResearchPrice(research, 0, mods, false)).toBe(1);
  expect(getDiscountedResearchPrice(research, 1, mods, true)).toBe(3); // 70% off 10
});
