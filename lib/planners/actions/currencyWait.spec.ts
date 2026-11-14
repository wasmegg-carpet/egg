import { describe, expect, test } from 'vitest';
import {
  createCurrencyWaitPayload,
  currencyWaitTarget,
  isCurrencyWaitType,
  refreshCurrencyWait,
  type WaitForCashPayload,
  type WaitForGemsPayload,
} from './currencyWait';

const values = { target: 100, bankValue: 30, earningsPerSecond: 2, timeSeconds: 35 };

describe('currency waits', () => {
  test('both saved action types count', () => {
    expect(isCurrencyWaitType('wait_for_gems')).toBe(true);
    expect(isCurrencyWaitType('wait_for_cash')).toBe(true);
    expect(isCurrencyWaitType('wait_for_time')).toBe(false);
  });

  test('each type is created under its own saved field names', () => {
    expect(createCurrencyWaitPayload('wait_for_gems', values)).toEqual({
      targetGems: 100,
      currentGems: 30,
      requiredGems: 70,
      earningsPerSecond: 2,
      timeSeconds: 35,
    });
    expect(createCurrencyWaitPayload('wait_for_cash', values)).toEqual({
      targetCash: 100,
      currentCash: 30,
      requiredCash: 70,
      earningsPerSecond: 2,
      timeSeconds: 35,
    });
  });

  test('a refresh reads either form and keeps its field names', () => {
    const gems = createCurrencyWaitPayload('wait_for_gems', values) as WaitForGemsPayload;
    const cash = createCurrencyWaitPayload('wait_for_cash', values) as WaitForCashPayload;
    expect(currencyWaitTarget(gems)).toBe(100);
    expect(currencyWaitTarget(cash)).toBe(100);
    expect(refreshCurrencyWait(gems, 90, 5)).toEqual({ ...gems, currentGems: 90, requiredGems: 10, timeSeconds: 5 });
    expect(refreshCurrencyWait(cash, 120, 0)).toEqual({ ...cash, currentCash: 120, requiredCash: 0, timeSeconds: 0 });
  });
});
