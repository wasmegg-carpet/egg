import { formatNumber, formatDuration, formatUnixToDateInput, formatUnixToTimeInput } from '@/lib/format';
import { createEmptySnapshot } from '@/types';
import { migrateExportedPlanV1, type ExportedPlan, type ExportedPlanV1 } from './export';
import { pickVariant, type VariantKey, type VariantResult } from '@/stores/autoPlanner';

/** Human-readable form of a `VariantKey` for library plan names, e.g. `1-sale`, `2-sale Tier 13`,
 * `Continue`. */
function formatVariantLabel(key: VariantKey): string {
  if (key === 'continue') return 'Continue';
  return key.endsWith('-tier13') ? `${key.slice(0, -'-tier13'.length)} Tier 13` : key;
}

export function buildLibraryPlansFromExport(
  importedRaw: ExportedPlan | ExportedPlanV1,
  namePrefix: string
): { name: string; data: Record<string, unknown> }[] {
  const imported: ExportedPlan = importedRaw.version === 1 ? migrateExportedPlanV1(importedRaw) : importedRaw;

  const overrides =
    imported.planVariantOverrides ?? (imported.a1ForceMode === 'continue' ? { 0: 'continue' as const } : {});
  const endTimeOverrides = imported.endTimeOverrides ?? {};

  return imported.ascensions.map((a, idx) => {
    const best = pickVariant(a.variants, overrides[idx], !!endTimeOverrides[idx]);
    const bestKey = (Object.entries(a.variants) as [VariantKey, VariantResult | undefined][]).find(
      ([, v]) => v === best
    )?.[0];

    const state = JSON.parse(JSON.stringify(imported.initialState));

    if (idx > 0) {
      const prevBest = pickVariant(imported.ascensions[idx - 1].variants, overrides[idx - 1], !!endTimeOverrides[idx - 1]);
      state.initialTeEarned = { ...prevBest.summary.finalTE };
      state.initialEggsDelivered = { ...prevBest.summary.eggsDelivered };
      state.soulEggs = prevBest.summary.endSoulEggs;
      state.initialShiftCount = prevBest.summary.endShiftCount;
    }

    let finalActions: any[] = best.actions;
    if (finalActions.length === 0 || finalActions[0].type !== 'start_ascension') {
      const startAction = {
        id: 'start_' + Math.random().toString(36).substring(2, 9),
        index: 0,
        timestamp: best.summary.startTime * 1000,
        type: 'start_ascension',
        payload: { initialEgg: 'curiosity' },
        cost: 0, elrDelta: 0, offlineEarningsDelta: 0, eggValueDelta: 0,
        habCapacityDelta: 0, layRateDelta: 0, shippingCapacityDelta: 0,
        ihrDelta: 0, bankDelta: 0, populationDelta: 0, totalTimeSeconds: 0,
        endState: {
          ...createEmptySnapshot(),
          currentEgg: 'curiosity',
          eggsDelivered: { ...state.initialEggsDelivered },
          teEarned: { ...state.initialTeEarned },
        },
        dependsOn: [], dependents: [],
      };
      finalActions = [startAction, ...finalActions];
      finalActions.forEach((action: any, i: number) => { action.index = i; });
    }

    // `virtueState.ascensionTime` below only has minute resolution (an "HH:MM" form input), but
    // `best.summary.startTime` — this ascension's real start, which every action's `lastStepTime`
    // is relative to — is essentially never exactly on a minute boundary for any ascension after
    // the first in a chain (it's simply whichever fractional-second instant the previous ascension
    // happened to end at). Round-tripping through the minute-only date/time strings and back via
    // `getLocalTimestampInTimezone` (what happens the moment this plan is loaded) would silently
    // floor away that sub-minute remainder from `ascensionStartTime`, then every action's displayed/
    // recomputed absolute time — including sale/boost boundary crossings — would land that same
    // amount too early (confirmed against a real export: purchases and "wait for research sale"
    // landing ~30s before the actual 9am Pacific boundary, showing as e.g. 10:59 instead of 11:00
    // Central). Bank the dropped remainder into the `start_ascension` action's own `lastStepTime` —
    // exactly what `planStartOffset` (`stores/actions/index.ts`) reads it as — so the rest of the
    // app's existing `ascensionStartTime + (lastStepTime - planStartOffset)` convention (used
    // consistently everywhere else absolute time is derived, e.g. `engine/simulate.ts`,
    // `engine/apply/duration.ts`) reconstructs the exact original instant with no further changes
    // needed downstream.
    const flooredStartTime = Math.floor(best.summary.startTime / 60) * 60;
    const droppedSeconds = best.summary.startTime - flooredStartTime;
    const startAscensionAction: any = finalActions[0];
    startAscensionAction.endState.lastStepTime = (startAscensionAction.endState.lastStepTime || 0) - droppedSeconds;

    const summary = best.summary;
    const startStr = new Date(summary.startTime * 1000).toISOString().split('T')[0];
    const peakELR = formatNumber(summary.maxELR * 3600, 3);
    const duration = formatDuration(summary.totalDurationSeconds);
    const variantSuffix = bestKey ? `${formatVariantLabel(bestKey)}` : '';
    const name = `${namePrefix} A${idx + 1} - ${peakELR}/hr from ${summary.startTE} to ${summary.endTE} - ${variantSuffix} - ${duration} - starting ${startStr}`;

    return {
      name,
      data: {
        version: 1,
        actions: finalActions,
        initialState: state,
        virtueState: {
          shiftCount: state.initialShiftCount || 0,
          initialTE: Object.values(state.initialTeEarned || {}).reduce((s: number, v: any) => s + (v || 0), 0),
          ascensionDate: formatUnixToDateInput(best.summary.startTime, imported.timezone),
          ascensionTime: formatUnixToTimeInput(best.summary.startTime, imported.timezone),
          ascensionTimezone: imported.timezone,
        },
        fuelTankState: {
          tankLevel: state.initialTankLevel || 0,
          fuelAmounts: state.initialFuelAmounts || {},
        },
        truthEggsState: {
          eggsDelivered: state.initialEggsDelivered || {},
          teEarned: state.initialTeEarned || {},
        },
        notesState: { notes: [] },
      },
    };
  });
}
