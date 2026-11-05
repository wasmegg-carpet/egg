import type { CalculationsSnapshot } from '@/types';
import type { EngineState } from '../types';
import { calculateEarningsForTime, type EarningsRateTransition } from './math';

/**
 * Advance the simulation time in the engine state and add earned gems to the bank.
 */
export function applyTime(
  state: EngineState,
  seconds: number,
  prevSnapshot: CalculationsSnapshot,
  options: { skipGrowth?: boolean, skipEarnings?: boolean, transitions?: EarningsRateTransition[] } = {}
): EngineState {
  if (seconds <= 0) return state;

  if (options.skipGrowth) {
    return {
      ...state,
      lastStepTime: (state.lastStepTime || 0) + seconds,
      population: prevSnapshot.population,
      bankValue: prevSnapshot.bankValue,
    };
  }

  const P0 = prevSnapshot.population;
  const I = prevSnapshot.offlineIHR / 60;
  const maxPop = prevSnapshot.habCapacity;

  const newPop = Math.min(maxPop, P0 + I * seconds);

  let earnedGems = 0;
  if (!options.skipEarnings) {
    const V = prevSnapshot.elr > 0 ? prevSnapshot.offlineEarnings / prevSnapshot.elr : 0;
    if (V > 0) {
      earnedGems = calculateEarningsForTime(seconds, prevSnapshot, options.transitions);
    }
  }

  let newBankValue = (state.bankValue || 0) + earnedGems;
  if (!options.skipEarnings && prevSnapshot.offlineEarnings > 0) {
    if (Math.abs(newBankValue) < prevSnapshot.offlineEarnings * 1e-6) {
      newBankValue = 0;
    }
  }

  return {
    ...state,
    population: newPop,
    lastStepTime: (state.lastStepTime || 0) + seconds,
    bankValue: newBankValue,
  };
}

/**
 * Apply passive egg delivery to an engine state.
 */
export function applyPassiveEggs(state: EngineState, passiveEggs: number): EngineState {
  if (passiveEggs <= 0) return state;
  const egg = state.currentEgg;
  return {
    ...state,
    eggsDelivered: {
      ...state.eggsDelivered,
      [egg]: (state.eggsDelivered[egg] || 0) + passiveEggs,
    },
  };
}
