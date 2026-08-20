// The persisted-settings validators, at the two points where a bad value is silent rather than obvious.
// The golden egg capacity is the exception: `buildModel` reads a non-finite capacity as "no cap", so a blob
// carrying one leaves the checkbox on with nothing enforcing it and the plan comes back looking fine.

import { describe, it, expect } from 'vitest';

import {
  doubleCapacityWindowOf,
  isMissionFilters,
  MAX_DOUBLE_CAPACITY_SECONDS,
  newMissionFilters,
} from '@/store/schema';

describe('MissionFilters', () => {
  it('rejects a maxGoldenEggCost that could never bind', () => {
    for (const maxGoldenEggCost of [-1, NaN, Infinity, -Infinity]) {
      expect(isMissionFilters({ ...newMissionFilters(), maxGoldenEggCost })).toBe(false);
    }
  });

  it('still accepts a zero capacity, which is a real cap and not an absent one', () => {
    expect(isMissionFilters({ ...newMissionFilters(), maxGoldenEggCost: 0 })).toBe(true);
  });

  it('accepts a blob written before the 2x capacity fields existed', () => {
    // Every field is optional in the validator: rejecting the blob would silently reset the player's
    // time budget and effort along with it.
    const legacy = { ...newMissionFilters() } as Record<string, unknown>;
    delete legacy.doubleCapacityEnabled;
    delete legacy.doubleCapacityRemaining;
    expect(isMissionFilters(legacy)).toBe(true);
  });

  it('starts with no event in progress', () => {
    expect(newMissionFilters().doubleCapacityEnabled).toBe(false);
  });

  it('rejects a non-string window, which would not parse to a duration', () => {
    expect(isMissionFilters({ ...newMissionFilters(), doubleCapacityRemaining: 48 })).toBe(false);
    expect(isMissionFilters({ ...newMissionFilters(), doubleCapacityEnabled: 'yes' })).toBe(false);
  });
});

describe('doubleCapacityWindowOf', () => {
  const withWindow = (doubleCapacityRemaining: string) => ({
    ...newMissionFilters(),
    doubleCapacityEnabled: true,
    doubleCapacityRemaining,
  });

  it('truncates to the 48h the event actually runs', () => {
    // Solving against a longer window would double missions the player cannot double.
    for (const over of ['72h', '5d', '100']) {
      expect(doubleCapacityWindowOf(withWindow(over))).toBe(MAX_DOUBLE_CAPACITY_SECONDS);
    }
  });

  it('leaves anything inside 48h alone', () => {
    expect(doubleCapacityWindowOf(withWindow('3h30m'))).toBe(3.5 * 3600);
    expect(doubleCapacityWindowOf(withWindow('48h'))).toBe(MAX_DOUBLE_CAPACITY_SECONDS);
  });

  it('reads off, unparseable and non-positive as no event at all', () => {
    expect(doubleCapacityWindowOf({ ...newMissionFilters(), doubleCapacityRemaining: '12h' })).toBe(0);
    for (const bad of ['', 'soon', '0h', '-3h']) {
      expect(doubleCapacityWindowOf(withWindow(bad))).toBe(0);
    }
  });
});
