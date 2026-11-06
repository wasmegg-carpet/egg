import { describe, it, expect } from 'vitest';
import { getDiscountedVehiclePrice, getDiscountedTrainCarPrice } from './vehicles';

// Max Bust Unions + max colleggtible = the sheet's "with reductions" column (× 0.45).
const maxed = { bustUnionsLevel: 10, vehicleCostMultiplier: 0.9 };

describe('regular vehicle prices', () => {
  it('match the sheet with max reductions', () => {
    expect(getDiscountedVehiclePrice(0, 1, maxed)).toBeCloseTo(10.09, 1); // 2nd Trike
    expect(getDiscountedVehiclePrice(1, 0, maxed)).toBeCloseTo(245, 0); // 1st Transit Van
    expect(getDiscountedVehiclePrice(2, 15, maxed) / 621.487e6).toBeCloseTo(1, 4); // Pickup #16
    expect(getDiscountedVehiclePrice(11, 0, maxed) / 9.506e36).toBeCloseTo(1, 3); // 1st Hyperloop
    expect(getDiscountedTrainCarPrice(1, maxed) / 881.582e33).toBeCloseTo(1, 4); // 2nd car
  });

  it('applies the 75% sale on top', () => {
    expect(getDiscountedVehiclePrice(1, 0, maxed, true)).toBeCloseTo(245 * 0.25, 0);
  });

  it('first train car is free', () => {
    expect(getDiscountedTrainCarPrice(0, maxed)).toBe(0);
  });
});
