// Spec for `calendar.ts`, the arena's calendar verifier: C1 for a problem with a sleep window. Pinned because it
// is the goalpost: a verifier that drifted would pass plans no player could fly.

import { describe, expect, it } from 'vitest';
import { calendarFaults, type CalendarDay } from './calendar';

const H = 3600;
const S = 8 * H;
const W = 16 * H;
const D = 24 * H;

// A daytime 10-hour ship, a 6-hour one, and a short ship's bedtime variant (no waking time, one night).
const menu = [
  { id: 'long', actualTime: 10 * H, nights: 0 },
  { id: 'short', actualTime: 6 * H },
  { id: 'short~night1', actualTime: 0, nights: 1 },
];

const day: CalendarDay = { sleepSeconds: S, horizonSeconds: 2 * D, slots: 2 };

const launch = (option: number, launchAt: number, extra: Record<string, unknown> = {}) => ({
  option,
  optionId: menu[option].id,
  launchAt,
  ...extra,
});

// Two days in slot 0: long then short, a bedtime launch, then long on day 1. Slot 1 flies one short ship.
const valid = () => [[launch(0, 0), launch(1, 10 * H), launch(2, W), launch(0, D)], [launch(1, 3 * H)]];
const validAllocation = [2, 2, 1];

describe('calendarFaults', () => {
  it('accepts a calendar that keeps the rule and matches the allocation', () => {
    expect(calendarFaults(valid(), menu, validAllocation, day)).toEqual([]);
  });

  it('rejects a launch while the player sleeps', () => {
    const cal = valid();
    cal[1][0].launchAt = W + 60;
    expect(calendarFaults(cal, menu, validAllocation, day).join('\n')).toMatch(/asleep/);
  });

  it('rejects a launch before the previous one in its slot is free, the night it flew through included', () => {
    const cal = valid();
    // The bedtime launch holds the slot until wake-up on day 1.
    cal[0][3].launchAt = D - 1;
    expect(calendarFaults(cal, menu, validAllocation, day).join('\n')).toMatch(/before the slot is free/);
    const overlap = valid();
    overlap[0][1].launchAt = 10 * H - 1;
    expect(calendarFaults(overlap, menu, validAllocation, day).join('\n')).toMatch(/before the slot is free/);
  });

  it('rejects a slot still busy past the horizon', () => {
    const cal = valid();
    cal[1][0].launchAt = D + W - H;
    // Slot 0 ends at 34h, inside a 40-hour horizon; slot 1's short ship launched at 39h lands at 45h.
    expect(calendarFaults(cal, menu, validAllocation, { ...day, horizonSeconds: D + W })).toEqual([
      `slot 1 is busy until ${D + W + 5 * H}s, past the ${D + W}s horizon`,
    ]);
  });

  it('rejects a calendar whose launches do not match the allocation', () => {
    expect(calendarFaults(valid(), menu, [2, 1, 1], day)).toEqual([
      'option 1 (short) is allocated 1 but flown 2 time(s)',
    ]);
    expect(calendarFaults(valid(), menu, [2, 2, 2], day)).toEqual([
      'option 2 (short~night1) is allocated 2 but flown 1 time(s)',
    ]);
  });

  it('times each launch from the menu, not from what the candidate wrote beside it', () => {
    const cal = valid();
    // Claiming the long ship takes no time does not let the short one start at once.
    cal[0][0] = launch(0, 0, { wakingSeconds: 0, nights: 0 });
    cal[0][1].launchAt = 0;
    expect(calendarFaults(cal, menu, validAllocation, day).join('\n')).toMatch(/before the slot is free/);
  });

  it('rejects a launch naming an option off the menu or under the wrong id', () => {
    const cal = valid();
    cal[1][0] = { option: 7, optionId: 'short', launchAt: 0 };
    expect(calendarFaults(cal, menu, validAllocation, day).join('\n')).toMatch(/not on the menu/);
    const misnamed = valid();
    misnamed[1][0] = { option: 1, optionId: 'long', launchAt: 0 };
    expect(calendarFaults(misnamed, menu, validAllocation, day).join('\n')).toMatch(/its id is short/);
  });

  it('rejects a calendar of the wrong shape', () => {
    expect(calendarFaults(undefined, menu, validAllocation, day)).toEqual(['calendar is not an array']);
    expect(calendarFaults([[]], menu, [0, 0, 0], day)).toEqual(['calendar has 1 slot(s), the problem has 2']);
  });
});

// A sleep window and a 2x window together: the window is wall-clock time from wake-up on day 0, nights included,
// and the rule is still only a doubled launch's start time against it.
describe('calendarFaults with a sleep window and a 2x window', () => {
  const doubledMenu = [
    { id: 'long', actualTime: 10 * H, nights: 0, variant: 'normal' },
    { id: 'long::event', actualTime: 10 * H, nights: 0, variant: 'event' },
    { id: 'night::overhang', actualTime: 0, nights: 1, variant: 'overhang' },
  ];
  const both: CalendarDay = { sleepSeconds: S, horizonSeconds: 2 * D, slots: 1, eventWindowSeconds: 30 * H };
  const at = (option: number, launchAt: number) => ({ option, optionId: doubledMenu[option].id, launchAt });

  it('accepts doubled launches on day 1 that start inside the window, and normal ones after it', () => {
    // Doubled at 0:00, at bedtime, and at 6:00 on day 1 (30 hours in, the window's very edge).
    const cal = [[at(1, 0), at(2, W), at(1, D + 6 * H)]];
    expect(calendarFaults(cal, doubledMenu, [0, 2, 1], both)).toEqual([]);
    expect(calendarFaults([[at(1, 0), at(0, D + 6 * H + 1)]], doubledMenu, [1, 1, 0], both)).toEqual([]);
  });

  it('rejects a doubled launch past the window, however few waking hours lie before it', () => {
    const cal = [[at(1, 0), at(1, D + 6 * H + 1)]];
    expect(calendarFaults(cal, doubledMenu, [0, 2, 0], both).join('\n')).toMatch(/past the 2x window/);
  });

  it('rejects a 1x launch inside the window that the menu could have doubled, by its place in the slot', () => {
    const menu = [
      { id: 'short', actualTime: 2 * H, variant: 'normal' },
      { id: 'short::event', actualTime: 2 * H, variant: 'event' },
      { id: 'short::overhang', actualTime: 2 * H, variant: 'overhang' },
      { id: 'bare', actualTime: 2 * H, variant: 'normal' },
    ];
    const window: CalendarDay = { sleepSeconds: 0, horizonSeconds: 20 * H, slots: 1, eventWindowSeconds: 3 * H };
    const go = (option: number, launchAt: number) => ({ option, optionId: menu[option].id, launchAt });
    // Event at 0:00, overhang at 2:00 (the last inside), 1x after the window: the rule both ways.
    expect(calendarFaults([[go(1, 0), go(2, 2 * H), go(0, 4 * H)]], menu, [1, 1, 1, 0], window)).toEqual([]);
    // 1x at 0:00 with a doubled launch after it inside the window: it could have been an event launch.
    expect(calendarFaults([[go(0, 0), go(2, 2 * H)]], menu, [1, 0, 1, 0], window).join('\n')).toMatch(
      /1x inside the 2x window, as short::event could/
    );
    // 1x as the last launch inside: it could have been the overhang.
    expect(calendarFaults([[go(1, 0), go(0, 2 * H)]], menu, [1, 1, 0, 0], window).join('\n')).toMatch(
      /as short::overhang could/
    );
    // An option with no doubled copy on the menu may fly 1x anywhere, and a launch at the window's very end is not
    // held to it.
    expect(calendarFaults([[go(3, 0), go(1, 2 * H)]], menu, [0, 1, 0, 1], window)).toEqual([]);
    expect(calendarFaults([[go(0, 3 * H)]], menu, [1, 0, 0, 0], window)).toEqual([]);
  });

  it('a window closing in the night leaves bedtime as the last doubled launch', () => {
    const closingAsleep = { ...both, eventWindowSeconds: 20 * H };
    expect(calendarFaults([[at(1, 0), at(2, W)]], doubledMenu, [0, 1, 1], closingAsleep)).toEqual([]);
    expect(calendarFaults([[at(2, W), at(1, D)]], doubledMenu, [0, 1, 1], closingAsleep).join('\n')).toMatch(
      /past the 2x window/
    );
  });
});

// A plan that starts after the player woke up: the same rule, the day counted from that wake-up rather than from the
// plan's start (ARENA.md, "Sleep").
describe('calendarFaults with a wake offset', () => {
  // Twelve hours awake at the plan's start: bedtime is 4 hours in, and the next wake-up 12 hours in.
  const awake: CalendarDay = { ...day, slots: 1, wakeOffsetSeconds: 12 * H };

  it('accepts launches in what is left of the first waking day, and from the next wake-up', () => {
    // A bedtime launch 4 hours in, a 10-hour ship at the next wake-up 12 hours in, and a 6-hour one after it.
    const cal = [[launch(2, 4 * H), launch(0, 12 * H), launch(1, 22 * H)]];
    expect(calendarFaults(cal, menu, [1, 1, 1], awake)).toEqual([]);
    // A 10-hour ship at the start lands in the night, which sleep does not forbid.
    expect(calendarFaults([[launch(0, 0)]], menu, [1, 0, 0], awake)).toEqual([]);
  });

  it('rejects a launch in the shifted night, which the same time from wake-up would allow', () => {
    // Five hours in is 17 hours since waking: asleep, though five hours after a wake-up is broad day.
    expect(calendarFaults([[launch(1, 5 * H)]], menu, [0, 1, 0], awake).join('\n')).toMatch(/asleep/);
    expect(calendarFaults([[launch(1, 5 * H)]], menu, [0, 1, 0], { ...day, slots: 1 })).toEqual([]);
    // Eleven hours in is 23 hours since waking: still asleep; twelve is the wake-up.
    expect(calendarFaults([[launch(1, 11 * H)]], menu, [0, 1, 0], awake).join('\n')).toMatch(/asleep/);
    expect(calendarFaults([[launch(1, 12 * H)]], menu, [0, 1, 0], awake)).toEqual([]);
  });

  it('rejects a launch before the plan starts', () => {
    expect(calendarFaults([[launch(1, -60)]], menu, [0, 1, 0], awake).join('\n')).toMatch(/before the slot is free/);
  });

  it('is the rule without one at an offset of 0', () => {
    expect(calendarFaults(valid(), menu, validAllocation, { ...day, wakeOffsetSeconds: 0 })).toEqual([]);
  });
});
