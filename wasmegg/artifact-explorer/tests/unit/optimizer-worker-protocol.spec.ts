// The worker boundary is a structured clone, so this round-trips through a
// real structuredClone rather than just calling the two converters back to
// back -- the whole point of the wire format is surviving that step.

import { describe, expect, it } from 'vitest';
import { ei, MissionType } from 'lib';

import { optionsFromWire, optionsToWire, solutionsFromWire, solutionsToWire } from '@/lib/optimizer-worker-protocol';
import { makeOpt, makeSolution } from './spec-helpers';
import type { LaunchSolution } from '@/lib/types';

const Spaceship = ei.MissionInfo.Spaceship;
const DurationType = ei.MissionInfo.DurationType;

function makeChoice(): LaunchSolution {
  return {
    ship: new MissionType(Spaceship.HENERPRISE, DurationType.EPIC),
    actualFuel: 1234,
    actualFuelByEgg: new Map([[ei.Egg.ROCKET_FUEL, 1234]]),
    actualTime: 5678,
    target: 'tachyon-deflector-4',
    targetAfxId: ei.ArtifactSpec.Name.TACHYON_DEFLECTOR,
    numShipsLaunched: 7,
    supplyVector: new Map([['tachyon-stone-1', 2.5]]),
    legendarySupplyVector: new Map([['tachyon-deflector-4', 0.125]]),
  };
}

describe('optimizer worker protocol', () => {
  it('round-trips launch options into the worker', () => {
    // Distinct ships on purpose: makeOpt hands out one shared fixture ship, so
    // asserting per-element ship mapping against identical ships would pass
    // whatever the converters did with the ordering.
    const options = [
      {
        ...makeOpt(100, 3600, [['tachyon-stone-1', 4]], [['tachyon-deflector-4', 0.01]]),
        ship: new MissionType(Spaceship.HENERPRISE, DurationType.EPIC),
      },
      {
        ...makeOpt(200, 7200, [['tachyon-stone-2', 1.5]]),
        ship: new MissionType(Spaceship.ATREGGIES, DurationType.SHORT),
      },
    ];

    const received = optionsFromWire(structuredClone(optionsToWire(options)));

    expect(received).toHaveLength(2);
    expect(received[0].actualFuel).toBe(100);
    expect(received[0].yieldVector.get('tachyon-stone-1')).toBe(4);
    expect(received[0].legendaryYieldVector.get('tachyon-deflector-4')).toBe(0.01);
    expect(received[1].supplyVector.get('tachyon-stone-2')).toBe(1.5);
    received.forEach((option, i) => {
      // optimizeFull copies this straight onto the solution's choiceHistory,
      // where the presentation layer reads its getters.
      expect(option.ship).toBeInstanceOf(MissionType);
      expect(option.ship.shipType).toBe(options[i].ship.shipType);
      expect(option.ship.durationType).toBe(options[i].ship.durationType);
    });
  });

  it('survives a structured clone with Maps and a usable MissionType', () => {
    const solution = makeSolution({
      bestProbability: 0.42,
      jointProbability: 0.42,
      choiceHistory: [makeChoice()],
      finalYieldVector: new Map([['tachyon-stone-1', 17.5]]),
      craftPrimal: new Map([['tachyon-deflector-4', 3]]),
      perTarget: [
        {
          nodeId: 'tachyon-deflector-4',
          bestProbability: 0.42,
          craftProbability: 0.3,
          dropProbability: 0.17,
          expectedCrafts: 3,
        },
      ],
    });

    const received = solutionsFromWire(structuredClone(solutionsToWire([solution])));
    expect(received).toHaveLength(1);
    const [got] = received;

    expect(got.bestProbability).toBe(0.42);
    expect(got.finalYieldVector).toBeInstanceOf(Map);
    expect(got.finalYieldVector.get('tachyon-stone-1')).toBe(17.5);
    expect(got.craftPrimal.get('tachyon-deflector-4')).toBe(3);
    expect(got.perTarget[0].expectedCrafts).toBe(3);

    const [choice] = got.choiceHistory;
    expect(choice.supplyVector.get('tachyon-stone-1')).toBe(2.5);
    expect(choice.actualFuelByEgg.get(ei.Egg.ROCKET_FUEL)).toBe(1234);
    // The prototype is what a bare clone would lose: the presentation layer
    // reads these getters, none of which are own properties.
    expect(choice.ship).toBeInstanceOf(MissionType);
    expect(choice.ship.shipName).toBe(new MissionType(Spaceship.HENERPRISE, DurationType.EPIC).shipName);
    expect(choice.ship.missionTypeId).toBe(new MissionType(Spaceship.HENERPRISE, DurationType.EPIC).missionTypeId);
  });
});
