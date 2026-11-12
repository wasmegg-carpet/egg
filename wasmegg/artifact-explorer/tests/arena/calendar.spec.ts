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
