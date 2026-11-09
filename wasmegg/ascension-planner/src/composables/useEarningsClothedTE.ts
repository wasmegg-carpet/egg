/**
 * Composable for the earnings artifact set's Clothed TE, evaluated at the
 * current simulation snapshot.
 */

import { computed, type ComputedRef } from 'vue';
import { useActionsStore } from '@/stores/actions';
import { useInitialStateStore } from '@/stores/initialState';
import { getSimulationContext } from '@/engine/adapter';
import { calculateClothedTEForSet } from '@/lib/artifacts/virtue';

export function useEarningsClothedTE(): {
  clothedTE: ComputedRef<number | null>;
} {
  const actionsStore = useActionsStore();
  const initialStateStore = useInitialStateStore();

  const clothedTE = computed<number | null>(() => {
    const snapshot = actionsStore.effectiveSnapshot;
    const earningsSet = snapshot?.artifactSets?.earnings;
    if (!earningsSet) return null;

    const truthEggs = snapshot.teEarned ? Object.values(snapshot.teEarned).reduce((a, b) => a + b, 0) : 0;
    const context = getSimulationContext();

    return calculateClothedTEForSet(earningsSet, {
      truthEggs,
      colleggtibleModifiers: context.colleggtibleModifiers,
      labUpgradeLevel: context.epicResearchLevels['cheaper_research'] ?? 0,
      proPermit: initialStateStore.proPermit,
    });
  });

  return { clothedTE };
}
