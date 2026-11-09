import { ref } from 'vue';
import { formatUnixToDateInput, formatUnixToTimeInput } from '@/lib/format';
import { initPlanFuture } from '@/lib/modes';
import { useAutoPlannerStore, pickVariant, type ChainedAscension, type VariantKey } from '@/stores/autoPlanner';
import { useInitialStateStore } from '@/stores/initialState';
import { useTruthEggsStore } from '@/stores/truthEggs';
import { useUIStore } from '@/stores/ui';
import { buildLibraryPlansFromExport } from '@/auto/buildLibraryPlans';
import { migrateExportedPlanV1, type ExportedPlan } from '@/auto/export';

/** Importing an auto-plan roadmap file into the plan library: restore it, or split it into plans. */
export function useAutoPlanImport() {
  const autoPlannerStore = useAutoPlannerStore();
  const initialStateStore = useInitialStateStore();
  const truthEggsStore = useTruthEggsStore();
  const uiStore = useUIStore();

  const showAutoPlanDialog = ref(false);
  const autoPlanToImport = ref<any>(null);
  const autoPlanName = ref('');
  const autoPlanAscensionCount = ref(0);
  let autoPlanResolver: ((resolution: 'restore' | 'individual' | 'cancel') => void) | null = null;

  async function importAutoPlan(imported: any, planName: string) {
    if (!(imported.version && imported.ascensions && imported.initialState)) return undefined;

    // Sequential Roadmap (Auto-Plan). Migrate version-1 exports (result1/result2/result3?) to
    // the current variants-map shape up front so everything below only ever deals with one shape.
    const plan: ExportedPlan =
      imported.version === 1 ? migrateExportedPlanV1(imported) : (imported as ExportedPlan);

    showAutoPlanDialog.value = true;
    autoPlanToImport.value = plan;
    autoPlanName.value = planName;
    autoPlanAscensionCount.value = plan.ascensions.length;

    const resolution = await new Promise<'restore' | 'individual' | 'cancel'>(resolve => {
      autoPlanResolver = resolve;
    });

    if (resolution === 'cancel') return null;

    if (resolution === 'restore') {
      // 1. Switch tab
      uiStore.plannerTab = 'automatic';
      uiStore.isHeaderCollapsed = true;

      // 2. Load fresh backup first (ensures we have latest epic research/artifacts as a baseline)
      //    We do this because switching to the Auto Planner tab normally triggers a backup fetch.
      uiStore.loading = true;
      try {
        if (initialStateStore.playerId) {
          await initPlanFuture(initialStateStore.playerId);
        }

        // 3. Restore to Auto Planner (now overwriting the fresh backup state)
        const importedOverrides: Record<number, VariantKey> =
          plan.planVariantOverrides ?? (plan.a1ForceMode === 'continue' ? { 0: 'continue' } : {});
        const importedEndTimeOverrides: Record<number, number> = plan.endTimeOverrides ?? {};

        const chain: ChainedAscension[] = plan.ascensions.map(a => {
          const item: ChainedAscension = {
            index: a.index,
            variants: a.variants,
            goal: a.goal,
          };
          if (a.result3SkippedReason) item.result3SkippedReason = a.result3SkippedReason;
          if (a.loadoutHash) item.loadoutHash = a.loadoutHash;
          return item;
        });

        const nextGoalsMap: Record<number, { te: number | null, date: string, time: string }> = {};
        plan.ascensions.forEach((a, idx) => {
          // Populate with the original goal
          nextGoalsMap[idx] = { ...a.goal };

          // If it was a TE goal, pre-fill the date/time fields with the actual result for better UX
          if (a.goal.type === 'te' || !a.goal.date) {
            const bestResult = pickVariant(a.variants, importedOverrides[idx], !!importedEndTimeOverrides[idx]);
            nextGoalsMap[idx].date = formatUnixToDateInput(bestResult.summary.endTime, plan.timezone);
            nextGoalsMap[idx].time = formatUnixToTimeInput(bestResult.summary.endTime, plan.timezone);
          }
        });
        // Add the next step goal (empty placeholder for new ascension)
        const lastImportedA = plan.ascensions[plan.ascensions.length - 1];
        const lastIdx = plan.ascensions.length - 1;
        const lastBestResult = pickVariant(
          lastImportedA.variants, importedOverrides[lastIdx], !!importedEndTimeOverrides[lastIdx]
        );
        nextGoalsMap[chain.length] = {
          te: Math.min(490, lastBestResult.summary.endTE + 30),
          date: '',
          time: ''
        };

        const firstA = plan.ascensions[0];
        const bestFirstA = pickVariant(firstA.variants, importedOverrides[0], !!importedEndTimeOverrides[0]);
        const a1EndTime = bestFirstA.summary.endTime;

        autoPlannerStore.setPlan({
          ascensionChain: chain,
          timezone: plan.timezone,
          startDate: formatUnixToDateInput(plan.startTime, plan.timezone),
          startTime: formatUnixToTimeInput(plan.startTime, plan.timezone),
          targetTE: plan.ascensions.map(a => a.goal.te || pickVariant(a.variants).summary.endTE).join(' '),
          // Always populate date/time fields with results for visibility
          targetEndDate: formatUnixToDateInput(a1EndTime, plan.timezone),
          targetEndTime: formatUnixToTimeInput(a1EndTime, plan.timezone),
          nextGoals: nextGoalsMap,
          planVariantOverrides: importedOverrides,
          endTimeOverrides: plan.endTimeOverrides ?? {},
          loadoutInputs: plan.loadoutInputs ?? null,
          loadoutOverrides: plan.loadoutOverrides ?? {},
        });

        // Hydrate stores so the form shows the correct numbers from the plan
        initialStateStore.hydrate(plan.initialState);
        truthEggsStore.hydrate(plan.initialState);
      } catch (e) {
        console.error('Failed to restore roadmap:', e);
        alert('Failed to restore roadmap simulation state.');
      } finally {
        uiStore.loading = false;
      }
    }

    if (resolution === 'individual') {
      // 2. Import Individual Ascensions into Library
      const exportDate = new Date(plan.exportedAt).toISOString().split('T')[0];

      return buildLibraryPlansFromExport(plan, exportDate);
    }

    // Restore only — we're done
    return null;
  }

  function resolveAutoPlan(resolution: 'restore' | 'individual') {
    showAutoPlanDialog.value = false;
    autoPlanResolver?.(resolution);
    autoPlanResolver = null;
  }

  function cancelAutoPlan() {
    showAutoPlanDialog.value = false;
    autoPlanResolver?.('cancel');
    autoPlanResolver = null;
  }

  return { showAutoPlanDialog, autoPlanName, autoPlanAscensionCount, importAutoPlan, resolveAutoPlan, cancelAutoPlan };
}
