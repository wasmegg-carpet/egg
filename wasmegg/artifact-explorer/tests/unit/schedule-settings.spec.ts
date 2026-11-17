// The sleep and 2x capacity event settings both apps share: what a stored or typed value means, and what the
// solver is handed for it.

import { describe, it, expect } from 'vitest';

import { MAX_DOUBLE_CAPACITY_SECONDS } from 'lib/mission-optimizer/capacity';
import {
  clampSleepHours,
  DEFAULT_DOUBLE_CAPACITY_REMAINING,
  eventWindowInput,
  MAX_SLEEP_HOURS,
  newScheduleSettings,
  normalizeEventRemaining,
  normalizeScheduleSettings,
  parseEventRemaining,
  scheduleArgsOf,
  scheduleSettingsFieldsValid,
} from 'lib/mission-optimizer/schedule-settings';
import { MAX_SLEEP_SECONDS } from 'lib/mission-optimizer/sleep';

const H = 3600;

describe('schedule settings', () => {
  it('takes its bounds from the solver side rather than restating them', () => {
    expect(MAX_SLEEP_HOURS * H).toBe(MAX_SLEEP_SECONDS);
    expect(parseEventRemaining(DEFAULT_DOUBLE_CAPACITY_REMAINING)).toBe(MAX_DOUBLE_CAPACITY_SECONDS);
  });

  it('starts with sleep off and no event, a full event ready to switch on', () => {
    expect(newScheduleSettings()).toEqual({
      sleepHours: 0,
      doubleCapacityEnabled: false,
      doubleCapacityRemaining: '48h',
    });
    expect(scheduleArgsOf(newScheduleSettings())).toEqual({});
  });

  it('holds sleep to the range the control offers', () => {
    expect(clampSleepHours(7.5)).toBe(7.5);
    expect(clampSleepHours(-3)).toBe(0);
    expect(clampSleepHours(40)).toBe(MAX_SLEEP_HOURS);
    for (const value of [undefined, null, '8', NaN, Infinity]) expect(clampSleepHours(value)).toBe(0);
  });

  it('reads a bare number as hours and anything else as a duration', () => {
    expect(parseEventRemaining('12')).toBe(12 * H);
    expect(parseEventRemaining('3h30m')).toBe(3.5 * H);
    expect(parseEventRemaining(' 1d ')).toBe(24 * H);
    for (const bad of ['', '0', '0h', 'soon', '-3h']) expect(parseEventRemaining(bad)).toBeNaN();
  });

  it('caps the window at what an event can have left, and says when it did', () => {
    expect(eventWindowInput('3d')).toEqual({ seconds: MAX_DOUBLE_CAPACITY_SECONDS, invalid: false, truncated: true });
    expect(eventWindowInput('48h')).toEqual({ seconds: MAX_DOUBLE_CAPACITY_SECONDS, invalid: false, truncated: false });
    expect(eventWindowInput('nope')).toMatchObject({ invalid: true });
  });

  it('tidies a valid entry and leaves an invalid one alone', () => {
    expect(normalizeEventRemaining('3d')).toBe('48h');
    expect(normalizeEventRemaining('210m')).toBe('3h30m');
    expect(normalizeEventRemaining('12')).toBe('12h');
    expect(normalizeEventRemaining('30s')).toBe('30s');
    expect(normalizeEventRemaining('nope')).toBeNull();
  });

  it('hands the solver each window only when it is on, and refuses an event with no duration', () => {
    const base = newScheduleSettings();
    expect(scheduleArgsOf({ ...base, sleepHours: 8 })).toEqual({ sleepSeconds: 8 * H });
    expect(scheduleArgsOf({ ...base, doubleCapacityEnabled: true, doubleCapacityRemaining: '5h' })).toEqual({
      eventWindowSeconds: 5 * H,
    });
    // Both at once is a request like any other: whether the engine can plan it is the engine's to say.
    expect(scheduleArgsOf({ sleepHours: 8, doubleCapacityEnabled: true, doubleCapacityRemaining: '72h' })).toEqual({
      sleepSeconds: 8 * H,
      eventWindowSeconds: MAX_DOUBLE_CAPACITY_SECONDS,
    });
    expect(scheduleArgsOf({ ...base, doubleCapacityEnabled: true, doubleCapacityRemaining: 'x' })).toBeNull();
    // Off, a "time left" nobody can see does not block anything.
    expect(scheduleArgsOf({ ...base, doubleCapacityRemaining: 'x' })).toEqual({});
  });

  it('loads a record from before any of the fields existed, and fixes mistyped ones', () => {
    expect(scheduleSettingsFieldsValid({})).toBe(true);
    expect(normalizeScheduleSettings({})).toEqual(newScheduleSettings());
    expect(scheduleSettingsFieldsValid({ doubleCapacityRemaining: 48 })).toBe(false);
    expect(scheduleSettingsFieldsValid({ doubleCapacityEnabled: 'yes' })).toBe(false);
    expect(
      normalizeScheduleSettings({ sleepHours: 30, doubleCapacityEnabled: 'yes', doubleCapacityRemaining: 48 })
    ).toEqual({ sleepHours: MAX_SLEEP_HOURS, doubleCapacityEnabled: false, doubleCapacityRemaining: '48h' });
    // A typed "time left" that does not parse is the field's to flag, so it is kept.
    expect(normalizeScheduleSettings({ doubleCapacityRemaining: 'soon' }).doubleCapacityRemaining).toBe('soon');
  });
});
