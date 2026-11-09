/**
 * Earnings calculation.
 * Earnings = egg value × ELR × (1 + earning bonus), with colleggtible bonuses.
 * On an enlightenment farm Soul Eggs, Eggs of Prophecy and Truth Eggs all feed the earning bonus.
 * Online and offline earnings differ due to offline-only bonuses.
 */

import type { EarningsInput, EarningsOutput } from '@/types';

/** Bonus per Soul Egg before Soul Food and artifacts. */
export const BASE_SOUL_EGG_BONUS = 0.1;
/** Bonus per Egg of Prophecy before Prophecy Bonus and artifacts. */
export const BASE_PROPHECY_EGG_BONUS = 0.05;
/** Per Truth Egg on a non-virtue farm (virtue farms get 1.1). */
export const TRUTH_EGG_MULTIPLIER = 1.01;

/**
 * The earning bonus: SE × SE bonus × (1 + PE bonus)^PE × 1.01^TE. Same formula as
 * lib/earning_bonus.ts and artifact-sandbox; the artifact parts are additive to the per-egg bonuses.
 */
export function calculateEarningBonus(input: {
  soulEggs: number;
  prophecyEggs: number;
  te: number;
  soulFoodLevel: number;
  prophecyBonusLevel: number;
  artifactSoulEggBonus: number;
  artifactProphecyEggBonus: number;
}): number {
  const soulEggBonus = BASE_SOUL_EGG_BONUS + input.soulFoodLevel * 0.01 + input.artifactSoulEggBonus;
  const prophecyEggBonus = BASE_PROPHECY_EGG_BONUS + input.prophecyBonusLevel * 0.01 + input.artifactProphecyEggBonus;
  return (
    input.soulEggs * soulEggBonus * Math.pow(1 + prophecyEggBonus, input.prophecyEggs) * Math.pow(TRUTH_EGG_MULTIPLIER, input.te)
  );
}

/**
 * Calculate earnings (online and offline).
 */
export function calculateEarnings(input: EarningsInput): EarningsOutput {
  const {
    eggValue,
    effectiveLayRate,
    earningBonus,
    earningsMultiplier,
    awayEarningsMultiplier,
    artifactAwayMultiplier,
    videoDoublerMultiplier,
    eventMultiplier,
    proPermit,
    artifactEffects,
  } = input;

  // Base earnings = egg value × ELR × (1 + earning bonus)
  const baseEarnings = eggValue * effectiveLayRate * (1 + earningBonus);

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
    earningBonus,
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
