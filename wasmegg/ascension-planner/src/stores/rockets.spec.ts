// The Humility plan import writes its launches straight into the plan as actions, so the queue
// below is only ever the mission grid's. What this covers is the one thing about it that is not
// obvious from reading it: the fuel budget and the launch both charge Humility, while the
// over-budget check does not.

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useRocketsStore } from './rockets';
import { useFuelTankStore } from './fuelTank';
import { DurationType, Spaceship, VIRTUE_FUEL_REQUIREMENTS } from '@/lib/missions';

const atreggiesEpicFuel = (egg: 'curiosity' | 'kindness' | 'resilience') =>
  VIRTUE_FUEL_REQUIREMENTS[Spaceship.ATREGGIES][DurationType.EPIC].find(r => r.egg === egg)!.amount;

beforeEach(() => {
  setActivePinia(createPinia());
});

function fillTank(multiplesOfAtreggiesEpic: number) {
  const tank = useFuelTankStore();
  for (const egg of ['curiosity', 'kindness', 'resilience'] as const) {
    tank.setFuelAmount(egg, atreggiesEpicFuel(egg) * multiplesOfAtreggiesEpic);
  }
}

describe('the mission queue', () => {
  it('charges every queued launch to one fuel budget', () => {
    const rockets = useRocketsStore();
    fillTank(10);
    rockets.setCount(Spaceship.ATREGGIES, DurationType.EPIC, 9);

    expect(rockets.totalFuelCost.curiosity).toBe(atreggiesEpicFuel('curiosity') * 9);
    expect(rockets.isOverBudget).toBe(false);

    rockets.setCount(Spaceship.ATREGGIES, DurationType.EPIC, 12);
    expect(rockets.isOverBudget).toBe(true);
  });

  it('leaves an entry the headroom its own commitment already occupies', () => {
    const rockets = useRocketsStore();
    fillTank(10);
    expect(rockets.maxForMission(Spaceship.ATREGGIES, DurationType.EPIC)).toBe(10);

    rockets.setCount(Spaceship.ATREGGIES, DurationType.EPIC, 4);
    expect(rockets.maxForMission(Spaceship.ATREGGIES, DurationType.EPIC)).toBe(10);
  });

  it('exempts Humility from the over-budget check while still costing it', () => {
    // The tank is charged Humility on launch while the budget check skips it. One of the two is
    // wrong; this pins which way it currently falls.
    const rockets = useRocketsStore();
    const tank = useFuelTankStore();
    fillTank(10);
    tank.setFuelAmount('humility', 0);
    rockets.setCount(Spaceship.ATREGGIES, DurationType.EPIC, 1);
    expect(rockets.totalFuelCost.humility).toBeGreaterThan(0);
    expect(rockets.isOverBudget).toBe(false);
  });
});
