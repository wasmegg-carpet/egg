import { describe, expect, test } from 'vitest';
import { applyPassiveEggs, computePassiveEggsDelivered } from './passiveEggs';

describe('passive egg delivery', () => {
  test('steps that do not ship on their own deliver nothing', () => {
    expect(computePassiveEggsDelivered({ type: 'store_fuel' }, 3600, {} as never)).toBe(0);
  });

  test('adds to the current egg only', () => {
    const state = { currentEgg: 'kindness', eggsDelivered: { kindness: 5, humility: 2 } };
    expect(applyPassiveEggs(state, 3).eggsDelivered).toEqual({ kindness: 8, humility: 2 });
    expect(applyPassiveEggs(state, 0)).toBe(state);
  });

  test('works before anything has been delivered', () => {
    expect(applyPassiveEggs({ currentEgg: 'enlightenment', eggsDelivered: {} }, 4).eggsDelivered).toEqual({ enlightenment: 4 });
  });
});
