import { calculateHabCapacity_Full } from './habCapacity';
import { calculateLayRate } from './layRate';
import { calculateMaxVehicleSlots, calculateMaxTrainLength, calculateShippingCapacity } from './shippingCapacity';
import { calculateArtifactModifiers } from '@/lib/artifacts';
import type { Modifiers as ColleggtibleModifiers } from 'lib/collegtibles';

/**
 * Compute ELR using the full pipeline with given research levels, artifact mods, max habs/vehicles.
 * This is a "realistic" calculation because it assumes optimal deployment (4x CU, max vehicles).
 */
export function computeRealisticELR(
  researchLevels: Record<string, number>,
  artifactMods: ReturnType<typeof calculateArtifactModifiers>,
  epicResearchLevels: Record<string, number>,
  colleggtibleModifiers: ColleggtibleModifiers,
): { layRate: number; shippingRate: number; effectiveRate: number } {
  const habCapOutput = calculateHabCapacity_Full({
    habIds: [18, 18, 18, 18] as (number | null)[],
    researchLevels,
    habCapMultiplier: colleggtibleModifiers.habCap,
    artifactMultiplier: artifactMods.habCapacity.totalMultiplier,
    artifactEffects: artifactMods.habCapacity.effects,
  });
  const population = habCapOutput.totalFinalCapacity;

  const layRateOutput = calculateLayRate({
    researchLevels,
    epicComfyNestsLevel: epicResearchLevels['epic_egg_laying'] || 0,
    elrMultiplier: colleggtibleModifiers.elr,
    population,
    artifactMultiplier: artifactMods.eggLayingRate.totalMultiplier,
    artifactEffects: artifactMods.eggLayingRate.effects,
  });

  const totalSlots = calculateMaxVehicleSlots(researchLevels);
  const maxTrainLen = calculateMaxTrainLength(researchLevels);
  const vehicles = Array(totalSlots).fill(null).map(() => ({ vehicleId: 11, trainLength: maxTrainLen }));

  const shippingOutput = calculateShippingCapacity({
    vehicles,
    researchLevels,
    transportationLobbyistLevel: epicResearchLevels['transportation_lobbyist'] || 0,
    shippingCapMultiplier: colleggtibleModifiers.shippingCap,
    artifactMultiplier: artifactMods.shippingRate.totalMultiplier,
    artifactEffects: artifactMods.shippingRate.effects,
  });

  const layRate = layRateOutput.totalRatePerSecond;
  const shippingRate = shippingOutput.totalFinalCapacity;

  return {
    layRate,
    shippingRate,
    effectiveRate: Math.min(layRate, shippingRate),
  };
}
