// The sleep and 2x capacity event settings both apps share: what a stored or typed value means, and what the
// solver is handed for it.

import { describe, it, expect } from 'vitest';

import { MAX_DOUBLE_CAPACITY_SECONDS } from 'lib/mission-optimizer/capacity';
import {
  clampHoursSinceWake,
  clampSleepHours,
  DEFAULT_DOUBLE_CAPACITY_REMAINING,
  DEFAULT_SLEEP_HOURS,
  eventWindowInput,
  formatPlanClock,
  MAX_HOURS_SINCE_WAKE,
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
  withSleepEnabled,
  type Timing,
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
      hoursSinceWake: 0,
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
        hoursSinceWake: 0,
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
      hoursSinceWake: 0,
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

  it('hands the solver the wake offset only with sleep on and some time since waking', () => {
    const base = { ...newScheduleSettings(), sleepEnabled: true, sleepHours: 8 };
    expect(scheduleArgsOf(base)).toEqual({ sleepSeconds: 8 * H });
    expect(scheduleArgsOf({ ...base, hoursSinceWake: 3.5 })).toEqual({
      sleepSeconds: 8 * H,
      wakeOffsetSeconds: 3.5 * H,
    });
    expect(scheduleArgsOf({ ...base, hoursSinceWake: 0.0001 })).toEqual({ sleepSeconds: 8 * H });
    // Off, the offset is kept but not handed over.
    expect(scheduleArgsOf({ ...base, sleepEnabled: false, hoursSinceWake: 3.5 })).toEqual({});
    // Not clamped to the waking window here: the solver does that against the sleep it is handed.
    expect(scheduleArgsOf({ ...base, hoursSinceWake: 20 })).toEqual({ sleepSeconds: 8 * H, wakeOffsetSeconds: 20 * H });
    expect(
      scheduleArgsOf({ ...base, hoursSinceWake: 2, doubleCapacityEnabled: true, doubleCapacityRemaining: '5h' })
    ).toEqual({ sleepSeconds: 8 * H, wakeOffsetSeconds: 2 * H, eventWindowSeconds: 5 * H });
  });

  it('keeps a stored time since waking as entered, and defaults a record from before it existed to 0', () => {
    expect(scheduleSettingsFieldsValid({ hoursSinceWake: 3 })).toBe(true);
    expect(scheduleSettingsFieldsValid({ hoursSinceWake: '3' })).toBe(false);
    expect(normalizeScheduleSettings({ sleepHours: 8 }).hoursSinceWake).toBe(0);
    expect(normalizeScheduleSettings({ sleepEnabled: true, sleepHours: 8, hoursSinceWake: 5.5 }).hoursSinceWake).toBe(
      5.5
    );
    for (const bad of ['3', NaN, Infinity, -2, null]) {
      expect(normalizeScheduleSettings({ hoursSinceWake: bad }).hoursSinceWake).toBe(0);
    }
    // Sleep hours changing afterwards does not touch it: 10 is past the waking window of a 16-hour sleep.
    const before = normalizeScheduleSettings({ sleepEnabled: true, sleepHours: 8, hoursSinceWake: 10 });
    expect(normalizeScheduleSettings({ ...before, sleepHours: 16 }).hoursSinceWake).toBe(10);
    // Round-trips through JSON as a store does.
    expect(normalizeScheduleSettings(JSON.parse(JSON.stringify(before)))).toEqual(before);
    expect(withSleepEnabled(before, false).hoursSinceWake).toBe(10);
  });

  it('holds a time since waking to just short of a day, whatever the sleep', () => {
    expect(MAX_HOURS_SINCE_WAKE).toBeLessThan(24);
    expect(clampHoursSinceWake(3)).toBe(3);
    expect(clampHoursSinceWake(20)).toBe(20);
    expect(clampHoursSinceWake(24)).toBe(MAX_HOURS_SINCE_WAKE);
    expect(clampHoursSinceWake(-1)).toBe(0);
    for (const bad of ['3', NaN, undefined]) expect(clampHoursSinceWake(bad)).toBe(0);
  });

  it('prints a time on the plan clock as the timeline does', () => {
    expect([0, 30, 60, 7.5 * H, 16 * H, 24 * H].map(formatPlanClock)).toEqual([
      'T+0',
      'T+0',
      'T+1m',
      'T+7h30m',
      'T+16h',
      'T+1d',
    ]);
  });

  describe('the timing copy', () => {
    const none: Timing = { sleepHours: 0, hoursSinceWake: 0, event: false };
    const sleep = (hoursSinceWake: number, event = false, sleepHours = 8): Timing => ({
      sleepHours,
      hoursSinceWake,
      event,
    });
    const event: Timing = { ...none, event: true };

    it('has nothing to say with neither sleep nor event', () => {
      expect(timingNote(none)).toBe('');
      expect(timingTooltip(none)).toBe('');
    });

    it('reads the note off the time since waking and the event', () => {
      expect(timingNote(sleep(0))).toBe('The plan starts now, as you wake up.');
      expect(timingNote(sleep(3.5))).toBe('The plan starts now, 3h30m after you woke.');
      expect(timingNote(sleep(0, true))).toBe('The plan starts now, as you wake up, with the event already running.');
      expect(timingNote(sleep(2, true))).toBe(
        'The plan starts now, 2h after you woke, with the event already running.'
      );
      expect(timingNote(event)).toBe('The plan starts now.');
      // The time since waking means nothing without sleep.
      expect(timingNote({ ...none, hoursSinceWake: 5 })).toBe('');
    });

    it('says when you sleep and wake while you are still awake, and with the event only that T+0 is now', () => {
      // 8 hours of sleep: a 16-hour waking window.
      expect(timingTooltip(sleep(0))).toContain(
        'T+0 on the plan is now. You go to sleep at T+16h and wake at T+1d, then keep the same hours.'
      );
      expect(timingTooltip(sleep(3.5))).toContain(
        'You go to sleep at T+12h30m and wake at T+20h30m, then keep the same hours.'
      );
      // Exactly at bedtime is still the awake case.
      expect(timingTooltip(sleep(16))).toContain('You go to sleep at T+0 and wake at T+8h, then keep');
      expect(timingTooltip(event)).toBe(
        'T+0 on the plan is now, the moment the event shows the time left you entered. ' +
          'Launches with the 2× badge go up inside the event. ' +
          'One ship fuels at a time, starting now, so launches due together go up a few minutes apart.'
      );
      expect(timingTooltip(sleep(3.5, true))).toMatch(
        /^T\+0 on the plan is now, the moment the event shows the time left you entered\. You go to sleep at T\+12h30m/
      );
    });

    it('says what happens when you are up past your usual bedtime', () => {
      // 20 hours since waking, with 8 hours of sleep: 4 hours past bedtime, back to sleep until T+4h.
      expect(timingTooltip(sleep(20))).toContain(
        "You're up past your usual bedtime: launch the first ships from T+0 as each finishes fueling, then sleep until T+4h, your usual wake-up."
      );
      expect(timingTooltip(sleep(20))).not.toContain('You go to sleep at');
      expect(timingNote(sleep(20))).toBe('The plan starts now, 20h after you woke.');
    });

    it('keeps the rest of the explanation to the settings that are on', () => {
      expect(timingTooltip(sleep(0))).toContain('No launches during your sleep hours, but ships still fly and land');
      expect(timingTooltip(sleep(0))).toContain('A ship that lands while you sleep waits until you wake');
      expect(timingTooltip(sleep(0))).toContain('indigo dot');
      expect(timingTooltip(sleep(0))).not.toContain('2×');
      expect(timingTooltip(event)).not.toContain('indigo');
      expect(timingTooltip(event)).not.toContain('sleep');
      expect(timingTooltip(sleep(0, true))).toContain('2×');
    });
  });
});
