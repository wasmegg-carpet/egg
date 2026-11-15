// The inline optimizer reads its visit off the live plan with the explorer's own reader, so this runs
// against the plan fixture the two apps already share. See the README beside it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ei, fuelTankSizes } from 'lib';

import type { Action } from '@/types';
import { currentHumilityVisit, durationSeconds } from './humilityOptimizer';
import { humilitySourceTag } from './humilityMissionsStage';

const FIXTURES = new URL('../../../artifact-explorer/tests/fixtures/', import.meta.url).pathname;
const plan = () =>
  (JSON.parse(readFileSync(FIXTURES + 'ascension-plan.json', 'utf8')) as { actions: Action[] }).actions;

const EPIC_RESEARCH = { afx_mission_time: 55, afx_mission_capacity: 8 };
const CLOCK = { ascensionDate: '2026-03-01', ascensionTime: '12:00', ascensionTimezone: 'UTC' };

const read = (actions: Action[], insertBefore = actions.length) =>
  currentHumilityVisit(actions, actions.slice(0, insertBefore), EPIC_RESEARCH, CLOCK);

// A launch placed at the end of the plan's first visit, burning 100T of Curiosity.
function withLaunch(sourceTag?: string): Action[] {
  const actions = plan();
  const before = actions[2];
  const launch = {
    ...before,
    id: 'launch_f6f6f6f',
    type: 'launch_missions',
    totalTimeSeconds: 7200,
    payload: { missions: [], totalTimeSeconds: 7200, totalMissions: 0, fuelConsumed: { curiosity: 100e12 } },
    endState: {
      ...before.endState,
      fuelTankAmounts: { ...before.endState.fuelTankAmounts, curiosity: 350e12 },
    },
    sourceTag,
  } as unknown as Action;
  return [...actions.slice(0, 3), launch, ...actions.slice(3)];
}

describe('the visit the planner is on', () => {
  it('is the last Humility run when the plan ends on Humility', () => {
    const current = read(plan());
    expect(current?.visit.visitId).toBe('shift_e5e5e5e');
    expect(current?.visit.visitIndex).toBe(1);
    expect(current?.visitCount).toBe(2);
    expect(current?.visit.epicResearchFTLLevel).toBe(55);
    expect(current?.visit.tankLevel).toBe(7);
  });

  it('is the earlier visit while that group is being edited', () => {
    // Editing a past group inserts before the shift that leaves it.
    const current = read(plan(), 3);
    expect(current?.visit.visitId).toBe('shift_a1b2c3d');
    expect(current?.visitCount).toBe(2);
    expect(current?.visit.fuelByEgg.get(ei.Egg.CURIOSITY)).toBe(450e12);
    expect(current?.visit.fuelByEgg.has(ei.Egg.HUMILITY)).toBe(false);
  });

  it('counts every egg in the tank against the room left, Humility included', () => {
    const actions = plan();
    const tank = { curiosity: 100e12, integrity: 0, humility: 50e12, resilience: 0, kindness: 0 };
    for (const action of actions.slice(1, 3)) action.endState = { ...action.endState, fuelTankAmounts: tank };
    expect(read(actions, 3)?.tankFree).toBe(fuelTankSizes[6] - 150e12);
    // The fixture's second visit holds more than its tank does; there is simply no room.
    expect(read(plan())?.tankFree).toBe(0);
  });

  it('is nothing while the insertion point is on another egg', () => {
    expect(read(plan(), 5)).toBeNull();
    expect(read(plan(), 1)).toBeNull();
  });

  it('budgets the tank as it stands after a launch made by hand', () => {
    const current = read(withLaunch(), 4);
    expect(current?.visit.fuelByEgg.get(ei.Egg.CURIOSITY)).toBe(350e12);
    expect(current?.visit.plannedDurationSeconds).toBe(86400 + 7200);
  });

  it('describes the visit without the missions the optimizer staged for it', () => {
    const current = read(withLaunch(humilitySourceTag('shift_a1b2c3d')), 4);
    // Restaging replaces the launch, so its fuel is still there to spend and its time is not yet spent.
    expect(current?.visit.fuelByEgg.get(ei.Egg.CURIOSITY)).toBe(450e12);
    expect(current?.visit.plannedDurationSeconds).toBe(86400);
  });

  it("leaves another visit's staged missions alone", () => {
    const current = read(withLaunch(humilitySourceTag('shift_e5e5e5e')), 4);
    expect(current?.visit.fuelByEgg.get(ei.Egg.CURIOSITY)).toBe(350e12);
  });
});

// A plan small enough to count by hand: a 400T tank that arrives on Humility holding 100T of Curiosity.
function smallPlan(): Action[] {
  const actions = plan().slice(0, 3);
  const tank = { curiosity: 100e12, integrity: 0, humility: 0, resilience: 0, kindness: 0 };
  for (const action of actions) action.endState = { ...action.endState, tankLevel: 6, fuelTankAmounts: tank };
  return actions;
}
function after(previous: Action, id: string, type: string, fuel: Record<string, number>, sourceTag?: string): Action {
  return {
    ...previous,
    id,
    type,
    totalTimeSeconds: 0,
    payload: {},
    endState: { ...previous.endState, fuelTankAmounts: { ...previous.endState.fuelTankAmounts, ...fuel } },
    sourceTag,
  } as unknown as Action;
}

describe('what staging already did to the tank', () => {
  const tag = humilitySourceTag('shift_a1b2c3d');

  it('neither banks nor is crowded by the stores staged for this visit', () => {
    const [start, arrival, wait] = smallPlan();
    // A 250T Kindness store staged before the arrival, carried through every later snapshot.
    const store = after(start, 'store_staged', 'store_fuel', { kindness: 250e12 }, tag);
    for (const action of [arrival, wait]) {
      action.endState = {
        ...action.endState,
        fuelTankAmounts: { ...action.endState.fuelTankAmounts, kindness: 250e12 },
      };
    }
    const current = read([start, store, arrival, wait]);
    expect(current?.visit.fuelByEgg.get(ei.Egg.KINDNESS)).toBe(0);
    expect(current?.visit.fuelByEgg.get(ei.Egg.CURIOSITY)).toBe(100e12);
    expect(current?.tankFree).toBe(fuelTankSizes[6] - 100e12);
  });

  it('gives back what a staged launch really burned, not what it asked for', () => {
    const [start, arrival, wait] = smallPlan();
    // Asked for 80T of Humility from a tank holding none, so the tank gave none; burned 60T of Curiosity.
    const launch = after(wait, 'launch_staged', 'launch_missions', { curiosity: 40e12 }, tag);
    (launch as unknown as { payload: unknown }).payload = { fuelConsumed: { curiosity: 60e12, humility: 80e12 } };
    const later = after(launch, 'wait_later', 'wait_for_time', {});
    const current = read([start, arrival, wait, launch, later]);
    expect(current?.visit.fuelByEgg.get(ei.Egg.CURIOSITY)).toBe(100e12);
    expect(current?.tankFree).toBe(fuelTankSizes[6] - 100e12);
  });
});

describe('the time field', () => {
  it('reads units, and a bare number as days', () => {
    expect(durationSeconds('3d')).toBe(3 * 86400);
    expect(durationSeconds('36h')).toBe(36 * 3600);
    expect(durationSeconds('2')).toBe(2 * 86400);
  });

  it.each(['', '0', 'soon', '-1d'])('rejects %j', input => {
    expect(durationSeconds(input)).toBeNaN();
  });
});
