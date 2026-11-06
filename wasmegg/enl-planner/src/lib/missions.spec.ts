import { describe, expect, test } from 'vitest';
import { ei, MissionType } from 'lib';
import { ALL_DURATIONS, ALL_SHIPS, BASE_DURATIONS, DurationType, FUEL_REQUIREMENTS, fuelEggIconPath } from '@/lib/missions';
import { FUEL_EGGS, eiEggToFuelEgg, fuelEggToEiEgg } from '@/types';
import { eggIconPath } from 'lib';

const LIB_DURATION = {
  [DurationType.SHORT]: ei.MissionInfo.DurationType.SHORT,
  [DurationType.LONG]: ei.MissionInfo.DurationType.LONG,
  [DurationType.EPIC]: ei.MissionInfo.DurationType.EPIC,
};

describe('missions from a non-virtue farm', () => {
  test('burn the regular fuel table, not the virtue one', () => {
    for (const ship of ALL_SHIPS) {
      for (const duration of ALL_DURATIONS) {
        const lib = new MissionType(ship as never, LIB_DURATION[duration]);
        const ours = new Map(FUEL_REQUIREMENTS[ship][duration].map(r => [fuelEggToEiEgg(r.egg), r.amount]));
        expect(ours).toEqual(new Map(lib.defaultFuels.map(f => [f.egg, f.amount])));
      }
    }
    expect(FUEL_REQUIREMENTS[0][DurationType.SHORT]).toEqual([{ egg: 'rocket_fuel', amount: 2e6 }]);
  });

  test('take the durations the game config gives', () => {
    for (const ship of ALL_SHIPS) {
      for (const duration of ALL_DURATIONS) {
        const lib = new MissionType(ship as never, LIB_DURATION[duration]);
        expect(BASE_DURATIONS[ship][duration]).toBe(lib.defaultDurationSeconds);
      }
    }
  });
});

describe('fuel eggs', () => {
  test('line up with ei.Egg and the backup tank order', () => {
    expect(FUEL_EGGS).toHaveLength(19);
    expect(fuelEggToEiEgg('edible')).toBe(ei.Egg.EDIBLE);
    expect(fuelEggToEiEgg('rocket_fuel')).toBe(ei.Egg.ROCKET_FUEL);
    expect(fuelEggToEiEgg('graviton')).toBe(ei.Egg.GRAVITON);
    expect(fuelEggToEiEgg('dark_matter')).toBe(ei.Egg.DARK_MATTER);
    expect(fuelEggToEiEgg('enlightenment')).toBe(ei.Egg.ENLIGHTENMENT);
    expect(eiEggToFuelEgg(ei.Egg.CURIOSITY)).toBeUndefined();
  });

  test('use the icon the rest of the site uses', () => {
    expect(fuelEggIconPath('rocket_fuel')).toBe(eggIconPath(ei.Egg.ROCKET_FUEL));
  });
});
