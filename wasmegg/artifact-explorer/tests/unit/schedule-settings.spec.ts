// The sleep and 2x capacity event settings both apps share: what a stored or typed value means, and what the
// solver is handed for it.

import { describe, it, expect } from 'vitest';

import { MAX_DOUBLE_CAPACITY_SECONDS } from 'lib/mission-optimizer/capacity';
import {
  clampSleepHours,
  DEFAULT_DOUBLE_CAPACITY_REMAINING,
  DEFAULT_SLEEP_HOURS,
  eventWindowInput,
  MAX_SLEEP_HOURS,
  MIN_SLEEP_HOURS,
  newScheduleSettings,
  normalizeEventRemaining,
  normalizeScheduleSettings,
  parseEventRemaining,
  scheduleArgsOf,
  scheduleSettingsFieldsValid,
  timingNote,
  timingTooltip,
  timingZero,
  withSleepEnabled,
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
      sleepEnabled: false,
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
    expect(scheduleArgsOf({ ...base, sleepEnabled: true, sleepHours: 8 })).toEqual({ sleepSeconds: 8 * H });
    // Off, the hours are kept but the solver is handed no sleep.
    expect(scheduleArgsOf({ ...base, sleepEnabled: false, sleepHours: 8 })).toEqual({});
    expect(scheduleArgsOf({ ...base, doubleCapacityEnabled: true, doubleCapacityRemaining: '5h' })).toEqual({
      eventWindowSeconds: 5 * H,
    });
    // Both at once is a request like any other: whether the engine can plan it is the engine's to say.
    expect(
      scheduleArgsOf({
        sleepEnabled: true,
        sleepHours: 8,
        doubleCapacityEnabled: true,
        doubleCapacityRemaining: '72h',
      })
    ).toEqual({
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
    expect(scheduleSettingsFieldsValid({ sleepEnabled: 1 })).toBe(false);
    expect(scheduleSettingsFieldsValid({ sleepEnabled: true, sleepHours: 8 })).toBe(true);
    expect(
      normalizeScheduleSettings({ sleepHours: 30, doubleCapacityEnabled: 'yes', doubleCapacityRemaining: 48 })
    ).toEqual({
      sleepEnabled: true,
      sleepHours: MAX_SLEEP_HOURS,
      doubleCapacityEnabled: false,
      doubleCapacityRemaining: '48h',
    });
    // A typed "time left" that does not parse is the field's to flag, so it is kept.
    expect(normalizeScheduleSettings({ doubleCapacityRemaining: 'soon' }).doubleCapacityRemaining).toBe('soon');
  });

  // A record from before sleep could be switched off: its hours were the switch.
  it('reads a stored record without sleepEnabled as on exactly when its hours were above 0', () => {
    expect(normalizeScheduleSettings({ sleepHours: 8 })).toMatchObject({ sleepEnabled: true, sleepHours: 8 });
    expect(normalizeScheduleSettings({ sleepHours: 0 })).toMatchObject({ sleepEnabled: false, sleepHours: 0 });
    expect(normalizeScheduleSettings({ sleepHours: 'x' })).toMatchObject({ sleepEnabled: false, sleepHours: 0 });
    expect(normalizeScheduleSettings({ sleepEnabled: 'yes', sleepHours: 6 })).toMatchObject({ sleepEnabled: true });
    // What was stored wins once it is there, and off keeps the hours.
    expect(normalizeScheduleSettings({ sleepEnabled: false, sleepHours: 6 })).toMatchObject({
      sleepEnabled: false,
      sleepHours: 6,
    });
  });

  it("holds sleep that is on to at least the control's step, so it never silently means off", () => {
    expect(normalizeScheduleSettings({ sleepEnabled: true, sleepHours: 0 }).sleepHours).toBe(MIN_SLEEP_HOURS);
    expect(normalizeScheduleSettings({ sleepEnabled: true, sleepHours: 0.2 }).sleepHours).toBe(MIN_SLEEP_HOURS);
    expect(normalizeScheduleSettings({ sleepEnabled: true, sleepHours: -3 }).sleepHours).toBe(MIN_SLEEP_HOURS);
    expect(normalizeScheduleSettings({ sleepEnabled: true, sleepHours: 7 }).sleepHours).toBe(7);
    expect(scheduleArgsOf(normalizeScheduleSettings({ sleepEnabled: true, sleepHours: 0.1 }))).toEqual({
      sleepSeconds: MIN_SLEEP_HOURS * H,
    });
  });

  it('switches sleep on at 8 hours when none are kept, and keeps hours that are', () => {
    const base = newScheduleSettings();
    expect(withSleepEnabled(base, true)).toMatchObject({ sleepEnabled: true, sleepHours: DEFAULT_SLEEP_HOURS });
    expect(withSleepEnabled({ ...base, sleepHours: 6 }, true)).toMatchObject({ sleepEnabled: true, sleepHours: 6 });
    const off = withSleepEnabled({ ...base, sleepEnabled: true, sleepHours: 6 }, false);
    expect(off).toMatchObject({ sleepEnabled: false, sleepHours: 6 });
    expect(scheduleArgsOf(off)).toEqual({});
  });

  it('says what T+0 is for each combination of sleep and event', () => {
    const cases = [
      { sleeping: false, event: false },
      { sleeping: true, event: false },
      { sleeping: false, event: true },
      { sleeping: true, event: true },
    ];
    expect(cases.map(timingNote)).toEqual([
      '',
      'The plan starts now, as you wake up.',
      'The plan starts now.',
      'The plan starts now, as you wake up, with the event already running.',
    ]);
    expect(timingTooltip(cases[0])).toBe('');
    expect(timingTooltip(cases[1])).toContain('T+0 on the plan is when you wake up');
    expect(timingTooltip(cases[2])).toContain('T+0 on the plan is now');
    expect(timingTooltip(cases[2])).not.toContain('wake');
    expect(timingTooltip(cases[3])).toContain('you have just woken up');
    // Sleep's reading of the dots, and the event's of the badge, appear only with the setting on.
    expect(timingTooltip(cases[1])).toContain('indigo dot');
    expect(timingTooltip(cases[2])).not.toContain('indigo');
    expect(timingTooltip(cases[1])).not.toContain('2×');
    expect(timingTooltip(cases[3])).toContain('2×');
    expect(cases.map(timingZero)).toEqual([
      'when you start launching',
      'when you wake up',
      'now, the moment the event shows the time left you entered',
      'now, the moment the event shows the time left you entered, with you just woken up',
    ]);
  });
});
