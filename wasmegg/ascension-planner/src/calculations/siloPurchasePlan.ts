import { nextSiloCost, MAX_SILOS } from '@/stores/silos';
import { getTimeToSave } from '@/engine/apply';
import type { CalculationsSnapshot } from '@/types';

export interface SiloPurchaseStep {
  fromCount: number;
  toCount: number;
  cost: number;
  waitSeconds: number;
}

export interface SiloPlanResult {
  steps: SiloPurchaseStep[];
  totalSeconds: number;
}

/**
 * Simulate buying silos back-to-back (waiting to save up gems between purchases)
 * within a `budgetSeconds` window, using the growth-aware `getTimeToSave` for each
 * purchase's wait and hand-advancing population/layRate/elr/offlineEarnings toward
 * hab capacity for the next iteration.
 */
export function planSilosWithinBudget(
  startSnapshot: CalculationsSnapshot,
  startSiloCount: number,
  budgetSeconds: number
): SiloPlanResult {
  const steps: SiloPurchaseStep[] = [];
  const virtualSnapshot: CalculationsSnapshot = { ...startSnapshot };
  let elapsedSeconds = 0;
  let currentSiloCount = startSiloCount;

  while (currentSiloCount < MAX_SILOS) {
    const cost = nextSiloCost(currentSiloCount);
    const seconds = getTimeToSave(cost, virtualSnapshot);
    if (!isFinite(seconds) || elapsedSeconds + seconds > budgetSeconds) break;

    elapsedSeconds += seconds;

    // Advance virtual population/earnings state during the wait
    const I = virtualSnapshot.offlineIHR / 60;
    virtualSnapshot.population = Math.min(virtualSnapshot.habCapacity, virtualSnapshot.population + I * seconds);
    const layRatePerChicken = startSnapshot.population > 0 ? startSnapshot.layRate / startSnapshot.population : 0;
    virtualSnapshot.layRate = virtualSnapshot.population * layRatePerChicken;
    virtualSnapshot.elr = Math.min(virtualSnapshot.layRate, virtualSnapshot.shippingCapacity);
    const earningsPerEgg = startSnapshot.elr > 0 ? startSnapshot.offlineEarnings / startSnapshot.elr : 0;
    virtualSnapshot.offlineEarnings = virtualSnapshot.elr * earningsPerEgg;

    // Bank is spent down to exactly cover the purchase
    virtualSnapshot.bankValue = seconds > 0 ? 0 : Math.max(0, (virtualSnapshot.bankValue || 0) - cost);

    steps.push({ fromCount: currentSiloCount, toCount: currentSiloCount + 1, cost, waitSeconds: seconds });
    currentSiloCount++;
  }

  return { steps, totalSeconds: elapsedSeconds };
}
