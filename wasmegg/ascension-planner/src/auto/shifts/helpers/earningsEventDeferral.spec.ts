import { describe, expect, test } from 'vitest';
import { modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import type { EngineState, SimulationContext } from '../../types';
import type { Action } from '@/types/actions/meta';
import { getNextEarningsBoostEnd, getNextEarningsBoostStart, isEarningsBoostActive } from '@/lib/events';
import { totalAwayTime } from '@/stores/silos';
import { runWithEarningsEventDeferral, MULTI_LAYERING_ID } from './earningsEventDeferral';
import type { DeferralCheckpoint, EarningsEventDeferralHost } from './earningsEventDeferral';

/**
 * A toy economy standing in for `createMilestoneShiftHelpers`: earnings rate is `BASE_RATE` times
 * the product of every owned item's `gain`, doubled during an earnings event, and reaching an
 * event's start credits the pre-event rate × the trailing idle gap (capped at silo time) — the
 * same shape as `advanceTimeWithBoundaries`'s `modify_bank` credit.
 */
interface Item {
  id: string;
  price: number;
  gain: number;
}

const BASE_RATE = 1;
const SILO_COUNT = 10;
const SILO_SECONDS = totalAwayTime(SILO_COUNT, 0) * 60;

function fakeState(): EngineState {
  return {
    currentEgg: 'curiosity',
    shiftCount: 0,
    te: 0,
    soulEggs: 0,
    bankValue: 0,
    habIds: [0, null, null, null],
    vehicles: [{ vehicleId: 0, trainLength: 1 }],
    researchLevels: {},
    siloCount: SILO_COUNT,
    tankLevel: 0,
    artifactLoadout: [],
    activeArtifactSet: null,
    artifactSets: { earnings: null, elr: null },
    fuelTankAmounts: {} as EngineState['fuelTankAmounts'],
    eggsDelivered: {} as EngineState['eggsDelivered'],
    teEarned: {} as EngineState['teEarned'],
    population: 1,
    lastStepTime: 0,
    activeSales: { research: false, hab: false, vehicle: false },
    earningsBoost: { active: false, multiplier: 1 },
  };
}

function fakeContext(deferForEarningsMode: boolean): SimulationContext {
  return {
    epicResearchLevels: {},
    colleggtibleModifiers: modifiersFromColleggtibleTiers({}),
    ascensionStartTime: 0,
    planStartOffset: 0,
    assumeDoubleEarnings: false,
    deferForEarningsMode,
  };
}

function createToyHost(anchor: number, itemsById: Record<string, Item>) {
  let state = fakeState();
  let elapsed = 0;
  const actions: Action[] = [];
  const log = (type: string, totalTimeSeconds = 0, payload: object = {}) =>
    actions.push({ type, totalTimeSeconds, payload } as unknown as Action);

  const baseRate = (s: EngineState) =>
    Object.entries(s.researchLevels).reduce((r, [id, lvl]) => r * Math.pow(itemsById[id].gain, lvl), BASE_RATE);
  const rateAt = (s: EngineState, abs: number) => baseRate(s) * (isEarningsBoostActive(abs) ? 2 : 1);
  const trailingIdle = () => {
    let s = 0;
    for (let i = actions.length - 1; i >= 0 && (actions[i].type as string) !== 'buy_research'; i--) {
      s += actions[i].totalTimeSeconds;
    }
    return s;
  };

  const advanceTime = (seconds: number) => {
    let remaining = seconds;
    while (remaining > 1e-9) {
      const abs = anchor + elapsed;
      const next = Math.min(getNextEarningsBoostStart(abs), getNextEarningsBoostEnd(abs));
      const step = Math.min(remaining, next - abs);
      state = { ...state, bankValue: (state.bankValue || 0) + rateAt(state, abs) * step };
      elapsed += step;
      remaining -= step;
      log('wait_for_time', step);
      if (step === next - abs && next === getNextEarningsBoostStart(abs)) {
        const credit = baseRate(state) * Math.min(trailingIdle(), SILO_SECONDS);
        state = { ...state, bankValue: (state.bankValue || 0) + credit };
        log('modify_bank', 0, { delta: credit });
      }
    }
  };

  const host: EarningsEventDeferralHost = {
    getAbsTime: () => anchor + elapsed,
    advanceTime,
    getElapsedSeconds: () => elapsed,
    getState: () => state,
    checkpoint: (): DeferralCheckpoint => ({ state, elapsedSeconds: elapsed, actionsLength: actions.length }),
    restore: (cp, append = []) => {
      state = cp.state;
      elapsed = cp.elapsedSeconds;
      actions.length = cp.actionsLength;
      actions.push(...append);
    },
    actionsSince: cp => actions.slice(cp.actionsLength),
  };

  const buy = (id: string, timeLimit: number): number | false => {
    const item = itemsById[id];
    const shortfall = item.price - (state.bankValue || 0);
    const wait = shortfall > 0 ? shortfall / rateAt(state, anchor + elapsed) : 0;
    if (elapsed + wait > timeLimit) return false;
    // Rough wait (ignores a mid-wait rate change) — only the purchase order matters for these tests.
    advanceTime(wait);
    state = {
      ...state,
      bankValue: (state.bankValue || 0) - item.price,
      researchLevels: { ...state.researchLevels, [id]: (state.researchLevels[id] || 0) + 1 },
    };
    log('buy_research', 0, { researchId: id });
    return item.price;
  };

  // Bank at an absolute time, assuming nothing else is bought — the "common horizon" comparison.
  const bankAt = (abs: number) => {
    advanceTime(abs - (anchor + elapsed));
    return state.bankValue || 0;
  };

  return { host, buy, bankAt, actions, getState: () => state };
}

const anchor = Date.UTC(2024, 0, 1, 0, 0, 0) / 1000; // a Monday, well clear of any boost window
const boostStart = getNextEarningsBoostStart(anchor);
// Start the sweep 6h before the event — inside the 10h silo window.
const sweepStart = boostStart - 6 * 3600;

function run(items: Item[], deferForEarningsMode: boolean) {
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const toy = createToyHost(sweepStart, byId);
  const result = runWithEarningsEventDeferral(
    items.map(i => i.id),
    id => id,
    toy.buy,
    toy.host,
    fakeContext(deferForEarningsMode),
    Infinity
  );
  const purchases = toy.actions.filter(a => (a.type as string) === 'buy_research');
  const purchaseTimes = (() => {
    let t = sweepStart;
    const out: Record<string, number> = {};
    for (const a of toy.actions) {
      t += a.totalTimeSeconds;
      if (a.type === 'buy_research') out[a.payload.researchId] = t;
    }
    return out;
  })();
  const credit = toy.actions
    .filter((a): a is Action<'modify_bank'> => a.type === 'modify_bank')
    .reduce((s, a) => s + a.payload.delta, 0);
  return { toy, result, purchases, purchaseTimes, credit };
}

// Cheap, low-gain purchases spread across the 6h before the event, then one after it.
const cheapItems: Item[] = [
  { id: 'a', price: 3600, gain: 1.02 },
  { id: 'b', price: 3600, gain: 1.02 },
  { id: 'c', price: 3600, gain: 1.02 },
  { id: 'd', price: 3600, gain: 1.02 },
  { id: 'e', price: 3600, gain: 1.02 },
  { id: 'after', price: 30000, gain: 1.02 },
];

describe('runWithEarningsEventDeferral undo-and-rebuy search', () => {
  test('moves cheap, low-gain purchases from just before the event to right after it', () => {
    const plain = run(cheapItems, false);
    const searched = run(cheapItems, true);

    // Plain: the last pre-event purchase lands ~1h before the event, leaving a ~1h credit.
    expect(plain.purchaseTimes['e']).toBeLessThan(boostStart);
    // Searched: every cheap purchase moves to the event's start, so the whole 6h gap is credited.
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(searched.purchaseTimes[id]).toBeGreaterThanOrEqual(boostStart);
    expect(searched.credit).toBeGreaterThan(plain.credit * 3);

    // Same purchases in the end, and strictly more bank at a common later moment.
    expect(searched.result.executedCount).toBe(plain.result.executedCount);
    const horizon = boostStart + 20 * 3600;
    expect(searched.toy.bankAt(horizon)).toBeGreaterThan(plain.toy.bankAt(horizon));
  });

  test('keeps a purchase before the event when its earnings gain outweighs the lost credit', () => {
    const items: Item[] = [
      { id: 'big', price: 3600, gain: 3 },
      { id: 'after', price: 1e6, gain: 1.01 },
    ];
    const searched = run(items, true);
    expect(searched.purchaseTimes['big']).toBeLessThan(boostStart);
  });

  test('never undoes Multiversal Layering or anything bought before it', () => {
    const items: Item[] = [
      { id: 'a', price: 3600, gain: 1.01 },
      { id: MULTI_LAYERING_ID, price: 3600, gain: 1.01 },
      { id: 'b', price: 3600, gain: 1.01 },
      { id: 'after', price: 30000, gain: 1.01 },
    ];
    const plain = run(items, false);
    const searched = run(items, true);
    expect(searched.purchaseTimes['a']).toBeCloseTo(plain.purchaseTimes['a'], 6);
    expect(searched.purchaseTimes[MULTI_LAYERING_ID]).toBeCloseTo(plain.purchaseTimes[MULTI_LAYERING_ID], 6);
    expect(searched.purchaseTimes['b']).toBeGreaterThanOrEqual(boostStart);
  });

  test('when items run out shortly before the event, undoes the tail and jumps to it', () => {
    const items = cheapItems.filter(i => i.id !== 'after');
    const plain = run(items, false);
    const searched = run(items, true);
    expect(plain.toy.getState().researchLevels['e']).toBe(1);
    expect(searched.result.executedCount).toBe(5);
    expect(searched.purchaseTimes['e']).toBeGreaterThanOrEqual(boostStart);
    const horizon = boostStart + 20 * 3600;
    expect(searched.toy.bankAt(horizon)).toBeGreaterThan(plain.toy.bankAt(horizon));
  });

  test('is never worse than buying on schedule', () => {
    const mixes: Item[][] = [
      cheapItems,
      cheapItems.map((i, n) => ({ ...i, gain: n % 2 ? 1.5 : 1.01 })),
      cheapItems.map(i => ({ ...i, price: i.price * 0.2, gain: 1.2 })),
    ];
    const horizon = boostStart + 30 * 3600;
    for (const items of mixes) {
      const plain = run(items, false);
      const searched = run(items, true);
      expect(searched.toy.bankAt(horizon)).toBeGreaterThanOrEqual(plain.toy.bankAt(horizon) * (1 - 1e-12));
    }
  });
});
