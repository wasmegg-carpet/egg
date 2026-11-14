import { describe, expect, test } from 'vitest';
import {
  boostTransitionsFrom,
  calculateEarningsForTime,
  forecastTransitionsFrom,
  getTimeToSave,
} from 'lib/planners/engine/apply/math';
import { getNextEarningsBoostStart } from 'lib/planners/events';
import type { CalculationsSnapshot } from '@/types';

// Earns exactly $1/s at 1x (full habs, shipping-capped at 1 egg/s worth $1), with a one-hour silo window.
function fakeSnapshot(bankValue = 0): CalculationsSnapshot {
  return {
    eggValue: 1,
    habCapacity: 1e18,
    elr: 1,
    shippingCapacity: 1,
    layRate: 0,
    onlineEarnings: 0,
    offlineEarnings: 1,
    onlineIHR: 0,
    offlineIHR: 0,
    ratePerChickenPerSecond: 1e18,
    bankValue,
    currentEgg: 'edible' as CalculationsSnapshot['currentEgg'],
    shiftCount: 0,
    te: 0,
    soulEggs: 0,
    siloCount: 1,
    siloTimeMinutes: 60,
    tankLevel: 0,
    fuelTankAmounts: {} as CalculationsSnapshot['fuelTankAmounts'],
    eggsDelivered: {} as CalculationsSnapshot['eggsDelivered'],
    teEarned: {} as CalculationsSnapshot['teEarned'],
    population: 1e18,
    lastStepTime: 0,
    vehicles: [],
    habIds: [],
    researchLevels: {},
    artifactLoadout: [],
    activeArtifactSet: null,
    artifactSets: { earnings: null, elr: null },
    activeSales: { research: false, hab: false, vehicle: false },
    earningsBoost: { active: false, multiplier: 1 },
  };
}

const BOOST = getNextEarningsBoostStart(Date.UTC(2026, 10, 16) / 1000);
const SILO_MODE = { deferForEarningsMode: true };
const NORMAL = { deferForEarningsMode: false };

describe('silo-mode forecasts: the credit a boost start pays', () => {
  test('pays the time since the last purchase at the unboosted rate', () => {
    const snap = fakeSnapshot();
    const from = BOOST - 1000;
    // 1000s at 1x, 1000s of credit, then 1000s at 2x.
    expect(calculateEarningsForTime(2000, snap, forecastTransitionsFrom(snap, from, SILO_MODE))).toBeCloseTo(4000, 6);
    expect(calculateEarningsForTime(2000, snap, forecastTransitionsFrom(snap, from, NORMAL))).toBeCloseTo(3000, 6);
  });

  test('is capped at the silos’ away time', () => {
    const snap = fakeSnapshot();
    const from = BOOST - 10_000;
    expect(calculateEarningsForTime(10_000, snap, forecastTransitionsFrom(snap, from, SILO_MODE))).toBeCloseTo(13_600, 6);
  });

  test('a window ending as the boost starts still gets it', () => {
    const snap = fakeSnapshot();
    expect(calculateEarningsForTime(1000, snap, forecastTransitionsFrom(snap, BOOST - 1000, SILO_MODE))).toBeCloseTo(2000, 6);
  });

  test('a purchase the credit covers lands when the boost starts', () => {
    const snap = fakeSnapshot();
    const from = BOOST - 1000;
    expect(getTimeToSave(1500, snap, forecastTransitionsFrom(snap, from, SILO_MODE))).toBeCloseTo(1000, 6);
    // Otherwise it finishes saving at 2x after the boost starts.
    expect(getTimeToSave(1500, snap, forecastTransitionsFrom(snap, from, NORMAL))).toBeCloseTo(1250, 6);
    // Past the credit, the rest is saved at 2x.
    expect(getTimeToSave(3000, snap, forecastTransitionsFrom(snap, from, SILO_MODE))).toBeCloseTo(1500, 6);
  });

  test('the engine’s own transitions never carry it', () => {
    const snap = fakeSnapshot();
    expect(boostTransitionsFrom(snap, BOOST - 1000).some(t => t.siloCreditSeconds)).toBe(false);
    expect(calculateEarningsForTime(2000, snap, boostTransitionsFrom(snap, BOOST - 1000))).toBeCloseTo(3000, 6);
  });
});
