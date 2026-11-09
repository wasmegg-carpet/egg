import type { EngineState, SimulationContext, SimulationResult } from './types';
import type {
  EggValueInput,
  HabCapacityInput,
  LayRateInput,
  ShippingCapacityInput,
  EarningsInput,
  IHRInput,
} from '@/types';
import { calculateArtifactModifiers, activeSlots } from '@/lib/artifacts';
import { totalAwayTime } from '@/stores/silos';
import { integrateRate } from 'lib/planners/engine/apply/math';

import { calculateEggValue, ENLIGHTENMENT_EGG_VALUE } from '@/calculations/eggValue';
import { calculateHabCapacity_Full as calculateHabCapacity } from 'lib/planners/calculations/habCapacity';
import { calculateLayRate } from 'lib/planners/calculations/layRate';
import { calculateShippingCapacity } from 'lib/planners/calculations/shippingCapacity';
import { calculateEffectiveLayRate } from 'lib/planners/calculations/effectiveLayRate';
import { calculateEarningBonus, calculateEarnings } from '@/calculations/earnings';
import { calculateIHR } from 'lib/planners/calculations/internalHatcheryRate';
import { PROFILE } from '@/lib/profile';


/**
 * Purely compute the full snapshot from engine state and context.
 * Bypasses Pinia stores and composables completely.
 */
export function computeSnapshot(
  state: EngineState,
  context: SimulationContext,
  options: { skipGrowth?: boolean; freezePopulation?: boolean; skipEpochConversion?: boolean } = {}
): SimulationResult {
  const { epicResearchLevels, colleggtibleModifiers } = context;

  // 1. Artifacts - Calculate first as they affect almost everything
  const artifactMods = calculateArtifactModifiers(activeSlots(state.artifactLoadout, state.proPermit));

  // 2. Egg Value
  const eggValueInput: EggValueInput = {
    baseValue: ENLIGHTENMENT_EGG_VALUE,
    researchLevels: state.researchLevels,
    artifactMultiplier: artifactMods.eggValue.totalMultiplier,
    artifactEffects: artifactMods.eggValue.effects,
  };
  const eggValueOutput = calculateEggValue(eggValueInput);

  // 3. Hab Capacity
  const habCapacityInput: HabCapacityInput = {
    habIds: state.habIds,
    researchLevels: state.researchLevels,
    habCapMultiplier: colleggtibleModifiers.habCap,
    artifactMultiplier: artifactMods.habCapacity.totalMultiplier,
    artifactEffects: artifactMods.habCapacity.effects,
  };
  const habCapacityOutput = calculateHabCapacity(habCapacityInput);

  // 7. Internal Hatchery Rate (IHR)
  const ihrInput: IHRInput = {
    te: state.te,
    teBase: PROFILE.ihrTruthEggBase,
    researchLevels: state.researchLevels,
    epicResearchLevels: {
      epicInternalIncubators: epicResearchLevels['epic_internal_incubators'] || 0,
      internalHatcheryCalm: epicResearchLevels['int_hatch_calm'] || 0,
    },
    ihrMultiplier: colleggtibleModifiers.ihr,
    artifactMultiplier: artifactMods.internalHatcheryRate.totalMultiplier,
    artifactEffects: artifactMods.internalHatcheryRate.effects,
  };
  const ihrOutput = calculateIHR(ihrInput);

  // 8. Population growth (catch-up if starting from a backup)
  const startPopulation = state.population || 0;
  let population = startPopulation;
  let bankValue = state.bankValue || 0;
  let lastStepTime = state.lastStepTime;

  if (options.skipGrowth) {
    population = habCapacityOutput.totalFinalCapacity;
    bankValue = state.bankValue || 0;
  } else if (options.freezePopulation) {
    // Population and earnings are frozen (e.g. waiting with empty silos): no growth, no bocks.
    population = state.population || 0;
    bankValue = state.bankValue || 0;
  } else {
    // 8. Population growth (catch-up if starting from a backup)
    // If time is not initialized (e.g. fresh ascension), base it on the planned start time.
    // Skip this when called from simulation loops (skipEpochConversion:true) to keep lastStepTime
    // in the same relative reference frame as the rest of the plan.
    if (!options.skipEpochConversion && lastStepTime < 1e9 && context.ascensionStartTime > 1e9) {
      lastStepTime = context.ascensionStartTime;
    }

    if (lastStepTime > 1e9 && context.ascensionStartTime > lastStepTime) {
      const elapsedSeconds = context.ascensionStartTime - lastStepTime;
      const growthRatePerSecond = ihrOutput.offlineRate / 60;
      const growth = Math.floor(growthRatePerSecond * elapsedSeconds);
      population = Math.min(habCapacityOutput.totalFinalCapacity, population + growth);
      // Once growth is applied, we are at the start of the ascension
      lastStepTime = context.ascensionStartTime;
    }
  }

  // 9. Lay Rate
  // Use the farm's total final capacity for metric calculations.
  // This ensures that metrics like ELR and Earnings reflect the farm's potential
  // at that stage, and avoids negative deltas when real population is low.
  const layRateInput: LayRateInput = {
    researchLevels: state.researchLevels,
    epicComfyNestsLevel: epicResearchLevels['epic_egg_laying'] || 0,
    elrMultiplier: colleggtibleModifiers.elr,
    population: population,
    artifactMultiplier: artifactMods.eggLayingRate.totalMultiplier,
    artifactEffects: artifactMods.eggLayingRate.effects,
  };
  const layRateOutput = calculateLayRate(layRateInput);

  // 10. Shipping Capacity
  const shippingInput: ShippingCapacityInput = {
    vehicles: state.vehicles,
    researchLevels: state.researchLevels,
    transportationLobbyistLevel: epicResearchLevels['transportation_lobbyist'] || 0,
    shippingCapMultiplier: colleggtibleModifiers.shippingCap,
    artifactMultiplier: artifactMods.shippingRate.totalMultiplier,
    artifactEffects: artifactMods.shippingRate.effects,
  };
  const shippingOutput = calculateShippingCapacity(shippingInput);

  // 11. Effective Lay Rate (ELR)
  const elrOutput = calculateEffectiveLayRate(layRateOutput.totalRatePerSecond, shippingOutput.totalFinalCapacity);

  // 12. Earnings
  const earningsInput: EarningsInput = {
    eggValue: eggValueOutput.finalValue,
    effectiveLayRate: elrOutput.effectiveLayRate,
    earningBonus: calculateEarningBonus({
      soulEggs: state.soulEggs,
      prophecyEggs: state.prophecyEggs,
      te: state.te,
      soulFoodLevel: epicResearchLevels['soul_eggs'] || 0,
      prophecyBonusLevel: epicResearchLevels['prophecy_bonus'] || 0,
      artifactSoulEggBonus: artifactMods.soulEggBonus.totalMultiplier,
      artifactProphecyEggBonus: artifactMods.prophecyEggBonus.totalMultiplier,
    }),
    earningsMultiplier: colleggtibleModifiers.earnings,
    awayEarningsMultiplier: colleggtibleModifiers.awayEarnings,
    artifactAwayMultiplier: artifactMods.awayEarnings.totalMultiplier,
    videoDoublerMultiplier: context.assumeDoubleEarnings ? 2 : 1,
    eventMultiplier: state.earningsBoost.active ? state.earningsBoost.multiplier : 1,
    proPermit: state.proPermit,
    artifactEffects: artifactMods.awayEarnings.effects,
  };
  const earningsOutput = calculateEarnings(earningsInput);

  // Apply catch-up earnings to the bank if this is the start of the plan
  // and we were offline.
  // We use 1e9 as a threshold to distinguish between 0-based simulation time
  // and absolute Unix timestamps from a backup.
  if (
    state.lastStepTime > 1e9 &&
    context.ascensionStartTime > state.lastStepTime &&
    !options.skipGrowth &&
    !options.freezePopulation
  ) {
    const elapsedSeconds = context.ascensionStartTime - state.lastStepTime;

    // Accurate catch-up using integrated rate (accounts for population growth)
    const extraEggs = integrateRate(
      elapsedSeconds,
      startPopulation,
      ihrOutput.offlineRate / 60,
      layRateOutput.ratePerChickenPerSecond,
      shippingOutput.totalFinalCapacity,
      habCapacityOutput.totalFinalCapacity
    );

    // Offline earnings factor (Value per egg * away multipliers)
    const vOffline = elrOutput.effectiveLayRate > 0 ? earningsOutput.offlineEarnings / elrOutput.effectiveLayRate : 0;
    bankValue += vOffline * extraEggs;
  }

  // Normalize rounding errors
  if (earningsOutput.offlineEarnings > 0) {
    if (Math.abs(bankValue) < earningsOutput.offlineEarnings * 1e-6) {
      bankValue = 0;
    }
  }

  // 13. Silo Time
  const siloTimeMinutes = totalAwayTime(state.siloCount, epicResearchLevels['silo_capacity'] || 0);

  // Assemble Snapshot with all inputs and computed outputs
  return {
    // Metrics
    eggValue: eggValueOutput.finalValue,
    habCapacity: habCapacityOutput.totalFinalCapacity,
    elr: elrOutput.effectiveLayRate,
    shippingCapacity: shippingOutput.totalFinalCapacity,
    layRate: layRateOutput.totalRatePerSecond,
    onlineEarnings: earningsOutput.onlineEarnings,
    offlineEarnings: earningsOutput.offlineEarnings,
    onlineIHR: ihrOutput.onlineRate,
    offlineIHR: ihrOutput.offlineRate,
    ratePerChickenPerSecond: layRateOutput.ratePerChickenPerSecond,
    bankValue,

    // State (Pass through inputs for UI reconstruction)
    te: state.te,
    soulEggs: state.soulEggs,
    prophecyEggs: state.prophecyEggs,
    siloCount: state.siloCount,
    siloTimeMinutes,
    tankLevel: state.tankLevel,
    proPermit: state.proPermit,
    fuelTankAmounts: state.fuelTankAmounts,
    vehicles: state.vehicles,
    habIds: state.habIds,
    researchLevels: state.researchLevels,
    artifactLoadout: state.artifactLoadout,
    activeArtifactSet: state.activeArtifactSet,
    artifactSets: state.artifactSets,
    population,
    lastStepTime,
    activeSales: state.activeSales,
    earningsBoost: state.earningsBoost,
  };
}
