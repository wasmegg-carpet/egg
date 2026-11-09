/**
 * Earnings calculation.
 * Earnings = egg value × ELR × TE multiplier, with colleggtible bonuses.
 * Online and offline earnings differ due to offline-only bonuses.
 */

import type { EarningsInput, EarningsOutput } from '@/types';

/**
 * Calculate earnings (online and offline).
 */
export function calculateEarnings(input: EarningsInput): EarningsOutput {
  const {
    eggValue,
    effectiveLayRate,
    te,
    earningsMultiplier,
    awayEarningsMultiplier,
    artifactAwayMultiplier,
    videoDoublerMultiplier,
    eventMultiplier,
    proPermit,
    artifactEffects,
  } = input;

  // TE multiplier: 1.1^TE (clamped to 0-490)
  const clampedTE = Math.max(0, Math.min(490, Math.round(te)));
  const teMultiplier = Math.pow(1.1, clampedTE);

  // Base earnings = egg value × ELR × TE multiplier
  const baseEarnings = eggValue * effectiveLayRate * teMultiplier;

  // Final multiplier = earnings colleggtibles × video doubler × event boost
  const finalMultiplier = earningsMultiplier * videoDoublerMultiplier * eventMultiplier;

  // Online earnings
  const onlineEarnings = baseEarnings * finalMultiplier;

  // Standard permit halves offline earnings only
  const permitAwayMultiplier = proPermit === false ? 0.5 : 1;

  // Offline earnings = online × away-earnings colleggtibles × artifact (lunar) × permit
  const offlineEarnings = onlineEarnings * awayEarningsMultiplier * artifactAwayMultiplier * permitAwayMultiplier;

  return {
    baseEarnings,
    teMultiplier,
    earningsMultiplier,
    awayEarningsMultiplier,
    artifactAwayMultiplier,
    permitAwayMultiplier,
    videoDoublerMultiplier,
    eventMultiplier,
    onlineEarnings,
    offlineEarnings,
    artifactBreakdown: artifactEffects,
  };
}
