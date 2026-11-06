/**
 * Composable for Earnings calculations.
 * Combines egg value and ELR with TE multiplier and colleggtible bonuses.
 */

import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';
import { useInitialStateStore } from '@/stores/initialState';
import { useVirtueStore } from '@/stores/virtue';
import { useEggValue } from './useEggValue';
import { useEffectiveLayRate } from './useEffectiveLayRate';
import { useSalesStore } from 'lib/planners/stores/sales';
import { calculateEarnings } from '@/calculations/earnings';
import type { EarningsInput, EarningsOutput } from '@/types';

/**
 * Composable that provides reactive earnings calculations.
 */
export function useEarnings(): {
  input: ComputedRef<EarningsInput>;
  output: ComputedRef<EarningsOutput>;
} {
  const initialStateStore = useInitialStateStore();
  const virtueStore = useVirtueStore();
  const salesStore = useSalesStore();
  const { output: eggValueOutput } = useEggValue();
  const { output: elrOutput } = useEffectiveLayRate();

  const { te } = storeToRefs(virtueStore);

  const input = computed<EarningsInput>(() => {
    const artifactMod = initialStateStore.artifactModifiers.awayEarnings;
    return {
      eggValue: eggValueOutput.value.finalValue,
      effectiveLayRate: elrOutput.value.effectiveLayRate,
      te: te.value,
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
