import { describe, expect, test } from 'vitest';
import { buildLibraryPlansFromExport } from './buildLibraryPlans';
import { getLocalTimestampInTimezone } from '@/lib/events';
import type { ExportedPlan } from './export';

const TIMEZONE = 'America/Chicago';

// Minimal fixture: a single ascension whose real start time (`startTime`) deliberately falls
// mid-minute (`:30.87`) — exactly the shape a non-first ascension in a chain has in practice,
// since its start is simply wherever the previous ascension's simulation happened to end, never
// aligned to a clean minute boundary. `actions` is empty, which is what forces
// `buildLibraryPlansFromExport` down its "synthesize a start_ascension" branch — the code path
// this test exercises.
function makeFixture(startTime: number): ExportedPlan {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    startTime,
    timezone: TIMEZONE,
    initialState: {
      epicResearchLevels: {},
      colleggtibleTiers: {},
      artifactLoadout: [],
      soulEggs: 0,
      isUltra: false,
      initialTankLevel: 0,
      initialFuelAmounts: {},
      initialEggsDelivered: {},
      initialTeEarned: {},
    },
    ascensions: [
      {
        index: 0,
        targetTE: 1,
        variants: {
          continue: {
            summary: {
              id: 'asc_0',
              startTime,
              endTime: startTime + 1000,
              totalDurationSeconds: 1000,
              buildPhaseEndTime: 0,
              buildPhaseSaleCount: 0,
              buildDurationSeconds: 0,
              startTE: 0,
              endTE: 1,
              teGained: 1,
              maxELR: 0,
              maxEarningsRate: 0,
              startSoulEggs: 0,
              endSoulEggs: 0,
              startShiftCount: 0,
              endShiftCount: 12,
              totalShiftCost: 0,
              eggsDelivered: {} as any,
              teEarned: {} as any,
              finalTE: {} as any,
            } as any,
            actions: [],
          },
        },
        goal: { type: 'te', te: 1, date: '', time: '' },
      },
    ],
  };
}

describe('buildLibraryPlansFromExport', () => {
  test('preserves a mid-minute ascension start time exactly via planStartOffset', () => {
    // 2026-11-10 12:36:30.872... Central — not on a minute boundary, mirroring a real A2+ start.
    const trueStart = getLocalTimestampInTimezone('2026-11-10', '12:36', TIMEZONE) + 30.872108936309814;

    const [plan] = buildLibraryPlansFromExport(makeFixture(trueStart), 'Test');
    const virtueState = plan.data.virtueState as any;
    const actions = plan.data.actions as any[];

    // The date/time fields are necessarily minute-only (an "HH:MM" form input) — reconstructing
    // from them alone would floor away the `:30.872` remainder.
    const reconstructedStart = getLocalTimestampInTimezone(
      virtueState.ascensionDate,
      virtueState.ascensionTime,
      virtueState.ascensionTimezone
    );
    expect(reconstructedStart).toBe(Math.floor(trueStart / 60) * 60);
    expect(reconstructedStart).not.toBe(trueStart);

    // ...but the dropped remainder must be recoverable via the synthesized start_ascension
    // action's lastStepTime (== planStartOffset, per stores/actions/index.ts), so every other
    // action's `ascensionStartTime + (lastStepTime - planStartOffset)` still lands on the exact
    // true instant.
    expect(actions[0].type).toBe('start_ascension');
    const planStartOffset = actions[0].endState.lastStepTime;
    expect(reconstructedStart - planStartOffset).toBeCloseTo(trueStart, 9);
  });

  test('is a no-op when the ascension already starts exactly on a minute boundary', () => {
    const trueStart = getLocalTimestampInTimezone('2026-11-10', '12:36', TIMEZONE);

    const [plan] = buildLibraryPlansFromExport(makeFixture(trueStart), 'Test');
    const actions = plan.data.actions as any[];

    expect(actions[0].endState.lastStepTime).toBe(0);
  });
});
