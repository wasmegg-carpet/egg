// The persisted-settings validators, at the two points where a bad value is silent rather than obvious.
// The golden egg capacity is the exception: `buildModel` reads a non-finite capacity as "no cap", so a blob
// carrying one leaves the checkbox on with nothing enforcing it and the plan comes back looking fine.

import { describe, it, expect } from 'vitest';

import { isMissionFilters, newMissionFilters } from '@/store/schema';

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

// The schedule fields' rules are `schedule-settings.ts`'s (`schedule-settings.spec.ts`); these check the store
// uses them.
describe('MissionFilters schedule fields', () => {
  it('loads a record saved before the 2x capacity event existed', () => {
    const legacy: Record<string, unknown> = { ...newMissionFilters() };
    delete legacy.doubleCapacityEnabled;
    delete legacy.doubleCapacityRemaining;
    expect(isMissionFilters(legacy)).toBe(true);
  });

  it('starts with the event off and a full 48h ready', () => {
    expect(newMissionFilters()).toMatchObject({ doubleCapacityEnabled: false, doubleCapacityRemaining: '48h' });
  });

  it('rejects mistyped event fields', () => {
    expect(isMissionFilters({ ...newMissionFilters(), doubleCapacityRemaining: 48 })).toBe(false);
    expect(isMissionFilters({ ...newMissionFilters(), doubleCapacityEnabled: 'yes' })).toBe(false);
  });
});
