// The persisted-settings validators, at the two points where a bad value is silent rather than obvious.
// The golden egg capacity is the exception: `buildModel` reads a non-finite capacity as "no cap", so a blob
// carrying one leaves the checkbox on with nothing enforcing it and the plan comes back looking fine.

import { describe, it, expect } from 'vitest';

import { isMissionFilters, newMissionFilters } from './schema';

describe('MissionFilters', () => {
  it('rejects a maxGoldenEggCost that could never bind', () => {
    for (const maxGoldenEggCost of [-1, NaN, Infinity, -Infinity]) {
      expect(isMissionFilters({ ...newMissionFilters(), maxGoldenEggCost })).toBe(false);
    }
  });

  it('still accepts a zero capacity, which is a real cap and not an absent one', () => {
    expect(isMissionFilters({ ...newMissionFilters(), maxGoldenEggCost: 0 })).toBe(true);
  });
});
