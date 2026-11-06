/**
 * Composable for Earnings calculations.
 * Combines egg value and ELR with TE multiplier and colleggtible bonuses.
 */

import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';
import { useInitialStateStore } from '@/stores/initialState';
import { usePlanStore } from '@/stores/plan';
import { useEggValue } from './useEggValue';
import { useEffectiveLayRate } from './useEffectiveLayRate';
import { useSalesStore } from 'lib/planners/stores/sales';
import { calculateEarningBonus, calculateEarnings } from '@/calculations/earnings';
import type { EarningsInput, EarningsOutput } from '@/types';

/**
 * Composable that provides reactive earnings calculations.
 */
export function useEarnings(): {
  input: ComputedRef<EarningsInput>;
  output: ComputedRef<EarningsOutput>;
} {
  const initialStateStore = useInitialStateStore();
  const planStore = usePlanStore();
  const salesStore = useSalesStore();
  const { output: eggValueOutput } = useEggValue();
  const { output: elrOutput } = useEffectiveLayRate();


  const input = computed<EarningsInput>(() => {
    const artifactMod = initialStateStore.artifactModifiers.awayEarnings;
    return {
      eggValue: eggValueOutput.value.finalValue,
      effectiveLayRate: elrOutput.value.effectiveLayRate,
      earningBonus: calculateEarningBonus({
        soulEggs: initialStateStore.soulEggs,
        prophecyEggs: initialStateStore.prophecyEggs,
        te: initialStateStore.truthEggs,
        soulFoodLevel: initialStateStore.epicResearchLevels['soul_eggs'] || 0,
        prophecyBonusLevel: initialStateStore.epicResearchLevels['prophecy_bonus'] || 0,
        artifactSoulEggBonus: initialStateStore.artifactModifiers.soulEggBonus.totalMultiplier,
        artifactProphecyEggBonus: initialStateStore.artifactModifiers.prophecyEggBonus.totalMultiplier,
      }),
      earningsMultiplier: initialStateStore.colleggtibleModifiers.earnings,
      awayEarningsMultiplier: initialStateStore.colleggtibleModifiers.awayEarnings,
      artifactAwayMultiplier: artifactMod.totalMultiplier,
      videoDoublerMultiplier: initialStateStore.assumeDoubleEarnings ? 2 : 1,
      eventMultiplier: salesStore.earningsBoostActive ? salesStore.earningsBoostMultiplier : 1,
      proPermit: initialStateStore.proPermit,
      artifactEffects: artifactMod.effects,
    };
  });

  const output = computed<EarningsOutput>(() => calculateEarnings(input.value));

  return {
    input,
    output,
  };
}
