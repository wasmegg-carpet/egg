/**
 * "Wait until the bank reaches an amount". Ascension plans save this as `wait_for_gems` and
 * enlightenment plans as `wait_for_cash`, each with its own field names. Saved plans keep those names,
 * and everything else goes through these helpers so either form runs the same code.
 */

export interface WaitForGemsPayload {
  targetGems: number;
  currentGems: number;
  requiredGems: number;
  earningsPerSecond: number;
  timeSeconds: number;
}

export interface WaitForCashPayload {
  targetCash: number;
  currentCash: number;
  requiredCash: number;
  earningsPerSecond: number;
  timeSeconds: number;
}

export type CurrencyWaitPayload = WaitForGemsPayload | WaitForCashPayload;
export type CurrencyWaitType = 'wait_for_gems' | 'wait_for_cash';

export function isCurrencyWaitType(type: string): type is CurrencyWaitType {
  return type === 'wait_for_gems' || type === 'wait_for_cash';
}

export function currencyWaitTarget(payload: CurrencyWaitPayload): number {
  return 'targetGems' in payload ? payload.targetGems : payload.targetCash;
}

/** `payload` updated for the current bank, under the same field names it came with. */
export function refreshCurrencyWait<P extends CurrencyWaitPayload>(payload: P, bankValue: number, timeSeconds: number): P {
  const required = Math.max(0, currencyWaitTarget(payload) - bankValue);
  return 'targetGems' in payload
    ? { ...payload, currentGems: bankValue, requiredGems: required, timeSeconds }
    : { ...payload, currentCash: bankValue, requiredCash: required, timeSeconds };
}

export function createCurrencyWaitPayload(
  type: CurrencyWaitType,
  values: { target: number; bankValue: number; earningsPerSecond: number; timeSeconds: number }
): CurrencyWaitPayload {
  const { target, bankValue, earningsPerSecond, timeSeconds } = values;
  const required = Math.max(0, target - bankValue);
  return type === 'wait_for_gems'
    ? { targetGems: target, currentGems: bankValue, requiredGems: required, earningsPerSecond, timeSeconds }
    : { targetCash: target, currentCash: bankValue, requiredCash: required, earningsPerSecond, timeSeconds };
}
