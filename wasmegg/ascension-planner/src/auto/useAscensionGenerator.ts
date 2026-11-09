import type { EngineState } from '@/engine/types';
import { ref, computed, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useInitialStateStore } from '@/stores/initialState';
import { useActionsStore } from '@/stores/actions';
import { useTruthEggsStore } from '@/stores/truthEggs';
import { useAutoPlannerStore } from '@/stores/autoPlanner';
import { formatNumber, formatUnixToDateInput, formatUnixToTimeInput } from '@/lib/format';
import { getSimulationContext, createBaseEngineState } from '@/engine/adapter';
import { computeSnapshot } from '@/engine/compute';
import { getLocalTimestampInTimezone } from 'lib/planners/events';
import { runUntilShift, deriveNextStartState, runContinueCurrent, runAscensionFromC3Variant } from '@/auto/ascension';
import { runC3Variants } from '@/auto/shifts/c3';
import { rollUpPendingTE } from '@/lib/modes';
import { addEggsSinceLastSync, applyAutoStartingTE } from '@/auto/startingTE';
import { getOptimalEarningsSet } from '@/lib/artifacts';
import { makeContinueState, VIRTUE_EGGS_MAP } from '@/auto/continueState';
import { triggerPlanExport, type ExportedPlan } from '@/auto/export';
import { buildLibraryPlansFromExport } from '@/auto/buildLibraryPlans';
import { savePlanToLibrary, type PlanData } from '@/lib/storage/db';
import { usePersistence } from '@/composables/usePersistence';
import type { AscensionSummary } from '@/auto/types';
import type { ChainedAscension, VariantKey, VariantResult } from '@/stores/autoPlanner';
import { pickVariant } from '@/stores/autoPlanner';
import { hashLoadoutInputs, socketEarningsStones, type AutoLoadoutInputs } from '@/auto/loadout';


// Below this starting TE, an ascension's build phase can't realistically reach a Tier 13 unlock —
// so `runC3Variants` is told to skip every tier13 combo outright for that ascension (see its own
// `skipTier13Attempts` doc comment) rather than spend time simulating attempts that would almost
// always come back impossible anyway.
const TIER_13_MIN_STARTING_TE = 190;

function pickVariantSummary(
  item: ChainedAscension,
  overrides: Record<number, VariantKey>,
  endTimeOverrides: Record<number, number>,
): AscensionSummary {
  return pickVariant(item.variants, overrides[item.index], !!endTimeOverrides[item.index]).summary;
}

/**
 * Determines how much of the existing ascension chain can be reused as-is versus needs fresh
 * simulation, given the (already TE-target-matched) `effectiveTargets` and the two override maps.
 * Assumes the caller has already ruled out `initialParamsDirty` (a changed start date/time/TE
 * forces `firstDiffIdx = 0` unconditionally, before this function would even be worth calling).
 *
 * The two override clamps below are NOT the same shape, deliberately: a variant override only
 * changes which already-simulated variant `pickVariant` prefers, so ascension `k` itself can safely
 * be reused as-is and regeneration only needs to start at `k + 1`. An end-time override changes
 * something upstream of that — it's fed into the simulation itself (a different deadline changes
 * `buildPhaseEnd` filtering, per-variant TE distribution, and each variant's actual endTime/endTE) —
 * so ascension `k`'s own stored `variants` are themselves stale the moment its override changes, not
 * just which of them gets picked. Regeneration must therefore start AT `k`, not after it, or `k`
 * silently keeps showing pre-override data forever (bug: 2026-08-16 — the override appeared to
 * apply, since the "Overridden" badge reads the store flag directly, but the displayed end time was
 * whatever the last non-overridden generation had already computed as that ascension's
 * best-by-duration variant, because `k` itself was never actually re-simulated).
 */
export function computeFirstDiffIdx(
  effectiveTargets: number[],
  existingChain: ChainedAscension[],
  planVariantOverrides: Record<number, VariantKey>,
  endTimeOverrides: Record<number, number>,
  /** Index-aligned `hashLoadoutInputs` of what each ascension would be simulated with now (setup
   * inputs or its override). An ascension whose stored `loadoutHash` differs is itself stale, like
   * an end-time override: regeneration starts AT it. Omitted = don't check. */
  expectedLoadoutHashes?: string[],
): number {
  let matchCount = 0;
  for (let i = 0; i < effectiveTargets.length; i++) {
    if (i < existingChain.length && effectiveTargets[i] === existingChain[i].goal.te) {
      matchCount++;
    } else {
      break;
    }
  }
  let firstDiffIdx = matchCount;

  for (const k of Object.keys(planVariantOverrides).map(Number)) {
    if (firstDiffIdx > k + 1 && existingChain.length > k + 1) {
      firstDiffIdx = k + 1;
    }
  }

  for (const k of Object.keys(endTimeOverrides).map(Number)) {
    if (firstDiffIdx > k && existingChain.length > k) {
      firstDiffIdx = k;
    }
  }

  if (expectedLoadoutHashes) {
    for (let k = 0; k < Math.min(firstDiffIdx, existingChain.length); k++) {
      if ((existingChain[k].loadoutHash ?? null) !== expectedLoadoutHashes[k]) {
        firstDiffIdx = k;
        break;
      }
    }
  }

  return firstDiffIdx;
}

export function useAscensionGenerator() {
  const isGenerating = ref(false);
  const generateProgress = ref('');
  const simulationError = ref<string | null>(null);
  const isValidationErrorOpen = ref(false);
  const validationErrorMessage = ref('');
  const copySuccess = ref(false);

  const autoPlannerStore = useAutoPlannerStore();
  const truthEggsStore = useTruthEggsStore();
  const initialStateStore = useInitialStateStore();
  const actionsStore = useActionsStore();

  const { ascensionChain, targetTE, timezone, startDate, startTime } = storeToRefs(autoPlannerStore);

  const getTargets = () => {
    if (!targetTE.value) return [];
    return targetTE.value
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter(n => !isNaN(n) && n > 0);
  };

  // The artifact/stone inputs ascension `idx` runs with: its own override, else the setup form's.
  const resolveLoadoutInputs = (idx: number): AutoLoadoutInputs | null =>
    autoPlannerStore.loadoutOverrides[idx] ?? autoPlannerStore.loadoutInputs ?? null;

  const currentTE = computed(() => {
    const snapshot = actionsStore.effectiveSnapshot;
    if (!snapshot?.teEarned) return 0;
    return Object.values(snapshot.teEarned).reduce((a, b) => a + b, 0);
  });

  const bestResults = computed(() => {
    return ascensionChain.value.map(item => {
      const hasEndTimeOverride = !!autoPlannerStore.endTimeOverrides[item.index];
      const override = autoPlannerStore.planVariantOverrides[item.index];
      const best = pickVariant(item.variants, override, hasEndTimeOverride);
      const present = (Object.entries(item.variants) as [VariantKey, VariantResult | undefined][])
        .filter((entry): entry is [VariantKey, VariantResult] => !!entry[1]);
      const bestKey = present.find(([, v]) => v === best)?.[0];

      // Always exactly one comparison badge. Under an end-time override every surviving variant was
      // clipped to the same shared deadline, so "days faster/slower" compares equal, fixed numbers —
      // TE reached by that deadline is the only thing that actually varies, so that's what's
      // compared instead. Reuses the same `comparison`/`message` shape `AscensionOverview.vue`
      // already renders, so no template change is needed for either mode.
      let comparison: { daysFaster: number; otherPlanLabel: string; message?: string } | undefined;
      if (hasEndTimeOverride) {
        const sortedByTE = [...present].sort((a, b) => b[1].summary.endTE - a[1].summary.endTE);
        const highestTE = sortedByTE[0][1];
        const isHighest = best.summary.endTE >= highestTE.summary.endTE;
        if (isHighest && sortedByTE.length > 1) {
          const teLead = best.summary.endTE - sortedByTE[1][1].summary.endTE;
          if (teLead > 0) {
            comparison = { daysFaster: 0, otherPlanLabel: '', message: `+${teLead} TE vs. the next best build by this deadline` };
          }
        } else if (!isHighest) {
          const teBehind = highestTE.summary.endTE - best.summary.endTE;
          if (teBehind > 0) {
            comparison = { daysFaster: 0, otherPlanLabel: '', message: `${teBehind} TE less than the best build by this deadline` };
          }
        }
      } else {
        const sortedByDuration = [...present].sort(
          (a, b) => a[1].summary.totalDurationSeconds - b[1].summary.totalDurationSeconds
        );
        const fastest = sortedByDuration[0][1];
        const isFastest = best.summary.totalDurationSeconds <= fastest.summary.totalDurationSeconds;

        if (isFastest && sortedByDuration.length > 1) {
          const secondFastest = sortedByDuration[1][1];
          const daysFaster = (secondFastest.summary.totalDurationSeconds - best.summary.totalDurationSeconds) / 86400;
          if (daysFaster > 0.01) {
            comparison = { daysFaster, otherPlanLabel: 'the next fastest plan' };
          }
        } else if (!isFastest) {
          const daysSlower = (best.summary.totalDurationSeconds - fastest.summary.totalDurationSeconds) / 86400;
          if (daysSlower > 0.01) {
            comparison = {
              daysFaster: 0,
              otherPlanLabel: '',
              message: `${daysSlower.toFixed(1)} days slower than the fastest plan`,
            };
          }
        }
      }

      const alternativeELRs = present
        .map(([key, v]) => ({
          elr: v.summary.maxELR,
          label: key === 'continue' ? 'Continue' : key,
          isActive: key === bestKey,
        }));

      return {
        ...best,
        summary: {
          ...best.summary,
          comparison,
          alternativeELRs,
        },
        targetTE: item.goal.te,
        variants: item.variants,
        variantKey: bestKey,
        result3SkippedReason: item.result3SkippedReason,
      };
    });
  });

  const generate = async (onComplete?: () => void) => {
    if (isGenerating.value) return;
    isGenerating.value = true;
    simulationError.value = null;
    generateProgress.value = 'Initializing simulation...';

    await new Promise(resolve => setTimeout(resolve, 30));

    try {
      const targets = getTargets();
      if (targets.length === 0) {
        throw new Error('Please specify at least one Target TE');
      }

      for (let i = 1; i < targets.length; i++) {
        if (targets[i] <= targets[i - 1]) {
          validationErrorMessage.value = `Target TE #${i + 1} (${targets[i]}) must be greater than the preceding Target TE (${targets[i - 1]})`;
          isValidationErrorOpen.value = true;
          throw new Error('validation_error');
        }
      }

      // Silently append a 490-TE ascension when the user's final target isn't already 490.
      const forced490 = targets[targets.length - 1] !== 490 && targets[targets.length - 1] < 490;
      const effectiveTargets = forced490 ? [...targets, 490] : targets;

      // Starting TE from whichever source the form shows: the backup, or the user's override.
      await applyAutoStartingTE({ refreshSnapshot: false });

      const teEarned = truthEggsStore.teEarned;
      const currentTotal = Object.values(teEarned).reduce((a, b) => a + b, 0);

      const startEgg = initialStateStore.currentFarmState
        ? VIRTUE_EGGS_MAP[initialStateStore.currentFarmState.eggType] || 'curiosity'
        : 'curiosity';

      const otherEggsSum = Object.entries(teEarned).reduce(
        (sum, [egg, val]) => sum + (egg !== startEgg ? (val as number) : 0),
        0
      );

      if (targets[0] <= otherEggsSum) {
        validationErrorMessage.value = `First Target TE (${targets[0]}) must be greater than the sum of TE from other eggs (${otherEggsSum}).`;
        isValidationErrorOpen.value = true;
        throw new Error('validation_error');
      }

      if (targets[0] <= currentTotal) {
        validationErrorMessage.value = `First Target TE (${targets[0]}) must be greater than your current total TE (${currentTotal}). It is not possible to generate a plan gaining 0 or negative TE.`;
        isValidationErrorOpen.value = true;
        throw new Error('validation_error');
      }

      const absStartTime = getLocalTimestampInTimezone(startDate.value, startTime.value, timezone.value);

      // A backup start also counts the eggs shipped since the last sync, on the egg the player is on —
      // the game credits them when they prestige. Before the roll-up, so any TE they pass is claimed.
      if (!autoPlannerStore.teOverride) addEggsSinceLastSync(absStartTime);

      rollUpPendingTE();

      const context = getSimulationContext();
      const baseState = createBaseEngineState(null);
      const initialSnapshot = computeSnapshot(baseState, context);
      // Pass silent:true so this snapshot update doesn't trigger the manual-mode
      // RecalculationOverlay — the auto planner uses its own progress indicator.
      actionsStore.setInitialSnapshot(initialSnapshot, { silent: true });

      const initialParamsToSave = {
        startDate: startDate.value,
        startTime: startTime.value,
        teEarned: { ...truthEggsStore.teEarned },
      };

      const lastA1 = ascensionChain.value[0];
      const initialParamsDirty =
        !lastA1 ||
        !lastA1.initialParams ||
        startDate.value !== lastA1.initialParams.startDate ||
        startTime.value !== lastA1.initialParams.startTime ||
        JSON.stringify(truthEggsStore.teEarned) !== JSON.stringify(lastA1.initialParams.teEarned);

      const firstDiffIdx = initialParamsDirty
        ? 0
        : computeFirstDiffIdx(
            effectiveTargets, ascensionChain.value,
            autoPlannerStore.planVariantOverrides, autoPlannerStore.endTimeOverrides,
            effectiveTargets.map((_, k) => hashLoadoutInputs(resolveLoadoutInputs(k)))
          );

      let currentBaseState: EngineState;
      let currentStartTime: number;
      let currentSummary: AscensionSummary | null = null;
      const newChain: ChainedAscension[] = [];
      const loops = effectiveTargets.length;

      if (firstDiffIdx > 0) {
        for (let i = 0; i < firstDiffIdx; i++) {
          newChain.push(ascensionChain.value[i]);
        }
        const lastValid = newChain[firstDiffIdx - 1];
        const lastValidSummary = pickVariantSummary(
          lastValid, autoPlannerStore.planVariantOverrides, autoPlannerStore.endTimeOverrides
        );

        const baseBackupState = createBaseEngineState(null);
        currentBaseState = deriveNextStartState(lastValidSummary, baseBackupState);
        currentStartTime = lastValidSummary.endTime;
        currentSummary = lastValidSummary;

        if (firstDiffIdx < loops && effectiveTargets[firstDiffIdx] <= currentSummary!.endTE) {
          throw new Error(
            `Target TE (${effectiveTargets[firstDiffIdx]}) for A${firstDiffIdx + 1} must be greater than A${firstDiffIdx} end TE (${currentSummary!.endTE})`
          );
        }
      } else {
        baseState.currentEgg = 'curiosity';
        baseState.population = 1;
        baseState.bankValue = 0;
        baseState.researchLevels = {};
        currentBaseState = baseState;
        currentStartTime = absStartTime;
      }

      for (let i = firstDiffIdx; i < loops; i++) {
        // An end-time override supersedes this step's Target TE goal entirely — `runAscension`/
        // `runContinueCurrent` only look at `targetEndTime` when `targetTE` is absent (see their own
        // doc comments), so leaving `stepTargetTE` set here would silently ignore the override.
        const hasEndTimeOverride = autoPlannerStore.endTimeOverrides[i] !== undefined;
        const stepTargetTE: number | undefined = hasEndTimeOverride ? undefined : (effectiveTargets[i] || undefined);
        const stepEndTime: number | undefined = hasEndTimeOverride ? autoPlannerStore.endTimeOverrides[i] : undefined;
        const t_asc = performance.now();

        const stepLoadoutInputs = resolveLoadoutInputs(i);
        const currentContext = getSimulationContext();
        currentContext.ascensionStartTime = currentStartTime;
        currentContext.planStartOffset = 0;
        if (stepLoadoutInputs) currentContext.loadoutInputs = stepLoadoutInputs;

        generateProgress.value = `Simulating A${i + 1} of ${loops} (build phase precompute)...`;
        await new Promise(resolve => setTimeout(resolve, 15));

        // Single C1-R1 precompute, shared across every build variant below (a hard requirement,
        // since K3-H2 completion is the expensive part of an ascension and this reuse keeps that
        // from being repeated).
        const precomputed = runUntilShift(currentBaseState, currentContext, 'C3');
        const preC3 = {
          actions: precomputed.actions,
          state: precomputed.state,
          elapsedSeconds: precomputed.elapsedSeconds,
        };

        // Cheap: runs C3 alone (not a full ascension) for every (saleCount, attemptTier13Unlock)
        // combination, descending-order-pruning Tier 13 attempts once a larger saleCount proves it
        // impossible. Below TIER_13_MIN_STARTING_TE, a Tier 13 unlock is never realistically
        // reachable within one ascension's build phase, so every tier13 variant is skipped outright
        // for this ascension rather than paying to simulate combinations that would come back
        // impossible anyway.
        const ascensionStartTE = currentSummary?.endTE ?? currentTE.value;
        const c3Variants = runC3Variants(
          precomputed.state, currentContext, 3, ascensionStartTE < TIER_13_MIN_STARTING_TE
        );
        // Variants where the requested Tier 13 unlock couldn't finish in time are dropped here, not
        // completed through K3-H2: `runC3` returns early on that failure, before actually reaching
        // buildPhaseEnd, so there's no valid build-phase-complete state to hand off to H1 onward.
        let survivingVariants = c3Variants.filter(v => !v.impossible);

        // An end-time override rules out any build variant whose own build phase doesn't even
        // finish before the deadline — K3's mandatory wait-to-buildPhaseEnd can't be truncated (see
        // `runK3`'s own doc comment), so such a variant isn't just "slower," it's not evaluable at
        // all under this deadline.
        if (stepEndTime !== undefined) {
          const feasibleVariants = survivingVariants.filter(v => v.buildPhaseEnd <= stepEndTime);
          if (feasibleVariants.length === 0) {
            const earliestBuildPhaseEnd = Math.min(...survivingVariants.map(v => v.buildPhaseEnd));
            throw new Error(
              `The overridden end time for A${i + 1} is too early — even the fastest build (1-sale) ` +
              `can't finish its build phase before ${new Date(earliestBuildPhaseEnd * 1000).toLocaleString()}.`
            );
          }
          survivingVariants = feasibleVariants;
        }

        const variants: ChainedAscension['variants'] = {};
        for (let vIdx = 0; vIdx < survivingVariants.length; vIdx++) {
          const variant = survivingVariants[vIdx];
          const key: VariantKey = variant.attemptTier13Unlock
            ? (`${variant.saleCount}-sale-tier13` as VariantKey)
            : (`${variant.saleCount}-sale` as VariantKey);

          generateProgress.value =
            `Simulating A${i + 1} of ${loops} (build variant ${vIdx + 1} of ${survivingVariants.length})...`;
          await new Promise(resolve => setTimeout(resolve, 15));

          variants[key] = runAscensionFromC3Variant(
            currentBaseState, preC3, variant, currentContext, currentStartTime,
            `asc_${i}`, stepTargetTE, stepEndTime
          );
        }

        let result3SkippedReason: string | null = null;

        if (i === 0 && (stepTargetTE || stepEndTime) && initialStateStore.currentFarmState) {
          const nowSecs = Date.now() / 1000;
          if (absStartTime > nowSecs + 3600) {
            result3SkippedReason = 'startTimeTooFar';
          } else {
            generateProgress.value = `Simulating A${i + 1} of ${loops} (Continue Current)...`;
            await new Promise(resolve => setTimeout(resolve, 15));

            const optimalEarnings = stepLoadoutInputs
              ? socketEarningsStones(stepLoadoutInputs.earnings, stepLoadoutInputs.stones)
              : initialStateStore.rawBackup
                ? getOptimalEarningsSet(initialStateStore.rawBackup, initialStateStore.proPermit)
                : currentBaseState.artifactSets.earnings || null;

            const continueState = makeContinueState(
              currentBaseState,
              initialStateStore.currentFarmState,
              initialStateStore.rawBackup,
              optimalEarnings
            );

            // No catch-up here: the base state's eggs delivered already include the eggs shipped since
            // the last sync (or, under a TE override, deliberately leave them out), and
            // `runContinueCurrent` only catches up from a real (epoch) lastStepTime.
            continueState.lastStepTime = 0;

            const continueContext = getSimulationContext();
            continueContext.ascensionStartTime = currentStartTime;
            continueContext.planStartOffset = 0;
            if (stepLoadoutInputs) continueContext.loadoutInputs = stepLoadoutInputs;
            const continueSnapshot = computeSnapshot(continueState, continueContext, { skipGrowth: true });
            const realELR = continueSnapshot.elr;

            if (realELR > 0) {
              variants.continue = runContinueCurrent(
                continueState, continueContext, currentStartTime,
                realELR, stepTargetTE, `asc_${i}_continue`, stepEndTime
              );
            }
          }
        }

        // Picked before `goalToSave` (rather than after, as in the pre-override code) because an
        // overridden slot's own goal.te needs the *actual achieved* TE, which isn't known until a
        // variant has actually been picked.
        const best = pickVariant(variants, autoPlannerStore.planVariantOverrides[i], hasEndTimeOverride);
        currentSummary = best.summary;

        // Overridden slots save `type: 'date'` and the deadline's real achieved TE, not the Target TE
        // text field's own (superseded) value for that slot — a request vs. an outcome, not
        // interchangeable — but nothing here needs to compare the two: the main Generate/Update Plan
        // button always regenerates fresh (see `regeneratePlan`), and a per-ascension override is
        // regenerated directly by `handleSetEndTimeOverride`, so no staleness check ever reads this.
        const goalToSave = hasEndTimeOverride
          ? { type: 'date' as const, te: currentSummary.endTE, date: '', time: '' }
          : { type: 'te' as const, te: stepTargetTE || null, date: '', time: '' };
        const chainItem: ChainedAscension = {
          index: i, variants, goal: goalToSave, loadoutHash: hashLoadoutInputs(stepLoadoutInputs),
        };
        if (result3SkippedReason) chainItem.result3SkippedReason = result3SkippedReason;
        if (i === 0) chainItem.initialParams = initialParamsToSave;
        // Tag the last item when it was silently added to cover the 490-TE milestone.
        if (forced490 && i === loops - 1) chainItem.forcedTarget490 = true;
        newChain.push(chainItem);

        if (i < loops - 1) {
          const baseBackupState = createBaseEngineState(null);
          currentBaseState = deriveNextStartState(currentSummary, baseBackupState);
          currentStartTime = currentSummary.endTime;

          if (effectiveTargets[i + 1] <= currentSummary.endTE) {
            throw new Error(
              `Target TE (${effectiveTargets[i + 1]}) for A${i + 2} must be greater than A${i + 1} end TE (${currentSummary.endTE})`
            );
          }
        }

        console.log(`[A${i+1} total time] ${(performance.now()-t_asc).toFixed(1)}ms`);
      }

      if (newChain.length > 0) {
        targetTE.value = targets.join(' ');
      }

      ascensionChain.value = newChain;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== 'validation_error') {
        console.error('Simulation error:', err);
        simulationError.value = message || 'An unknown error occurred during simulation.';
      }
    } finally {
      isGenerating.value = false;
      generateProgress.value = '';
      onComplete?.();
    }
  };

  const { partitionHash, broadcastLibraryUpdate } = usePersistence();

  const buildExportedPlan = (): ExportedPlan => ({
    version: 2,
    exportedAt: new Date().toISOString(),
    startTime: getLocalTimestampInTimezone(startDate.value, startTime.value, timezone.value),
    timezone: timezone.value,
    planVariantOverrides: { ...autoPlannerStore.planVariantOverrides },
    endTimeOverrides: { ...autoPlannerStore.endTimeOverrides },
    loadoutInputs: autoPlannerStore.loadoutInputs ? JSON.parse(JSON.stringify(autoPlannerStore.loadoutInputs)) : null,
    loadoutOverrides: JSON.parse(JSON.stringify(autoPlannerStore.loadoutOverrides)),
    initialState: {
      epicResearchLevels: { ...initialStateStore.epicResearchLevels },
      colleggtibleTiers: { ...initialStateStore.colleggtibleTiers },
      artifactLoadout: JSON.parse(JSON.stringify(initialStateStore.artifactLoadout)),
      soulEggs: initialStateStore.soulEggs,
      isUltra: initialStateStore.isUltra,
      proPermit: initialStateStore.proPermit,
      initialTankLevel: initialStateStore.initialTankLevel,
      initialFuelAmounts: { ...initialStateStore.initialFuelAmounts },
      initialEggsDelivered: { ...initialStateStore.initialEggsDelivered },
      initialTeEarned: { ...initialStateStore.initialTeEarned },
    },
    ascensions: ascensionChain.value.filter(item => !item.forcedTarget490).map((item, idx) => {
      const asc: ExportedPlan['ascensions'][number] = {
        index: idx,
        targetTE: item.goal.te || pickVariant(item.variants).summary.endTE,
        variants: item.variants,
        goal: item.goal,
      };
      if (item.result3SkippedReason) asc.result3SkippedReason = item.result3SkippedReason;
      if (item.loadoutHash !== undefined) asc.loadoutHash = item.loadoutHash;
      return asc;
    }),
  });

  const isExporting = ref(false);

  const exportCurrentPlan = async () => {
    if (ascensionChain.value.length === 0) return;
    isExporting.value = true;
    await nextTick();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
      await triggerPlanExport(buildExportedPlan());
    } finally {
      isExporting.value = false;
    }
  };

  const isSavingToLibrary = ref(false);
  const saveToLibrarySuccess = ref(false);

  const saveToLibrary = async () => {
    if (ascensionChain.value.length === 0 || !partitionHash.value) return;
    isSavingToLibrary.value = true;
    try {
      const plan = buildExportedPlan();
      const datePrefix = new Date().toISOString().split('T')[0];
      const plansToSave = buildLibraryPlansFromExport(plan, datePrefix);
      for (const p of plansToSave) {
        const entry: PlanData = {
          id: crypto.randomUUID(),
          name: p.name,
          timestamp: Date.now(),
          data: p.data,
        };
        await savePlanToLibrary(partitionHash.value, entry);
      }
      // Increment tick directly so this tab refreshes too (BroadcastChannel skips the sender)
      actionsStore.libraryUpdateTick++;
      broadcastLibraryUpdate();
      saveToLibrarySuccess.value = true;
      setTimeout(() => { saveToLibrarySuccess.value = false; }, 2000);
    } finally {
      isSavingToLibrary.value = false;
    }
  };

  const savingIndex = ref<number | null>(null);
  const savedIndex = ref<number | null>(null);

  const saveSingleAscensionToLibrary = async (idx: number) => {
    if (!partitionHash.value) return;
    savingIndex.value = idx;
    try {
      const plan = buildExportedPlan();
      const datePrefix = new Date().toISOString().split('T')[0];
      const plansToSave = buildLibraryPlansFromExport(plan, datePrefix);
      const p = plansToSave[idx];
      if (!p) return;
      const entry: PlanData = {
        id: crypto.randomUUID(),
        name: p.name,
        timestamp: Date.now(),
        data: p.data,
      };
      await savePlanToLibrary(partitionHash.value, entry);
      actionsStore.libraryUpdateTick++;
      broadcastLibraryUpdate();
      savedIndex.value = idx;
      setTimeout(() => { if (savedIndex.value === idx) savedIndex.value = null; }, 2000);
    } finally {
      savingIndex.value = null;
    }
  };

  const copySummary = async () => {
    if (ascensionChain.value.length === 0) return;

    const startTE = ascensionChain.value[0].initialParams?.teEarned
      ? Object.values(ascensionChain.value[0].initialParams.teEarned).reduce((a, b) => a + b, 0)
      : currentTE.value;

    const bestPlans = ascensionChain.value
      .filter(item => !item.forcedTarget490)
      .map(item => pickVariantSummary(item, autoPlannerStore.planVariantOverrides, autoPlannerStore.endTimeOverrides));

    const finalTE = bestPlans[bestPlans.length - 1].endTE;
    let totalSeconds = 0;
    let totalSE = 0;
    const lines = [`Ascension Plan - Starting TE: ${startTE}`];

    bestPlans.forEach((plan, idx) => {
      const ascStartTE = idx === 0 ? startTE : bestPlans[idx - 1].endTE;
      const saleStr = plan.strategyLabel.replace(' build', '');
      const durationDays = Math.floor(plan.totalDurationSeconds / 86400);
      const durationHours = Math.floor((plan.totalDurationSeconds % 86400) / 3600);
      lines.push(
        `  A${idx + 1}: ${ascStartTE} → ${plan.endTE} TE (${saleStr}, ${durationDays}d ${durationHours}h, ${formatNumber(plan.maxELR * 3600, 3)}/hr)`
      );
      totalSeconds += plan.totalDurationSeconds;
      totalSE += plan.startSoulEggs - plan.endSoulEggs;
    });

    lines.push(`Total: ${startTE} → ${finalTE} TE in ~${(totalSeconds / 86400).toFixed(1)} days, ${formatNumber(totalSE)} SE consumed`);

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      copySuccess.value = true;
      setTimeout(() => { copySuccess.value = false; }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handleSetPlanVariant = (idx: number, variant: VariantKey) => {
    autoPlannerStore.planVariantOverrides = {
      ...autoPlannerStore.planVariantOverrides,
      [idx]: variant,
    };
    generate();
  };

  // Sets (or clears, when `endTime` is null) an ascension's end-time override and regenerates —
  // same "mutate the override map, then call generate() directly" shape as `handleSetPlanVariant`.
  const handleSetEndTimeOverride = (idx: number, endTime: number | null) => {
    if (endTime === null) {
      const { [idx]: _removed, ...rest } = autoPlannerStore.endTimeOverrides;
      autoPlannerStore.endTimeOverrides = rest;
    } else {
      autoPlannerStore.endTimeOverrides = {
        ...autoPlannerStore.endTimeOverrides,
        [idx]: endTime,
      };
    }
    generate();
  };

  // The main Generate/Update Plan button's handler: always available (no dirty-check gating it —
  // an earlier attempt at one, comparing the Target TE text field against each ascension's stored
  // goal, went stale/wrong the moment an end-time-overridden slot's goal no longer meant the same
  // thing as a plain target; see git history around 2026-08-17 for the bug that came from it),
  // and always a full fresh start: clearing both override maps first means every ascension's target
  // is read straight from the Target TE field with nothing left over to reinterpret it.
  //
  // Loadout overrides are the exception: the caller asks the user first (see AutomaticPlanner.vue)
  // and passes `clearLoadoutOverrides: false` to keep them — they take more effort to re-enter, and
  // a small tweak elsewhere usually wants them kept.
  const regeneratePlan = (onComplete?: () => void, opts: { clearLoadoutOverrides?: boolean } = {}) => {
    autoPlannerStore.planVariantOverrides = {};
    autoPlannerStore.endTimeOverrides = {};
    if (opts.clearLoadoutOverrides ?? true) autoPlannerStore.loadoutOverrides = {};
    // Without a start-time override the plan starts now. Resampled only here, on a fresh generate:
    // the per-ascension handlers regenerate surgically and must keep the start the chain was built on.
    if (!autoPlannerStore.startTimeOverride) {
      const nowUnix = Date.now() / 1000;
      startDate.value = formatUnixToDateInput(nowUnix, timezone.value);
      startTime.value = formatUnixToTimeInput(nowUnix, timezone.value);
    }
    generate(onComplete);
  };

  // Sets (`inputs`) or removes (`null`) the artifact/stone override on every ascension in `indices`,
  // then regenerates — `computeFirstDiffIdx`'s loadout-hash check restarts at the earliest one.
  const handleSetLoadoutOverride = (indices: number[], inputs: AutoLoadoutInputs | null) => {
    const next = { ...autoPlannerStore.loadoutOverrides };
    for (const idx of indices) {
      if (inputs) next[idx] = JSON.parse(JSON.stringify(inputs));
      else delete next[idx];
    }
    autoPlannerStore.loadoutOverrides = next;
    generate();
  };

  return {
    isGenerating,
    isExporting,
    isSavingToLibrary,
    saveToLibrarySuccess,
    generateProgress,
    simulationError,
    isValidationErrorOpen,
    validationErrorMessage,
    copySuccess,
    bestResults,
    generate,
    regeneratePlan,
    copySummary,
    exportCurrentPlan,
    saveToLibrary,
    savingIndex,
    savedIndex,
    saveSingleAscensionToLibrary,
    handleSetPlanVariant,
    handleSetEndTimeOverride,
    handleSetLoadoutOverride,
    resolveLoadoutInputs,
  };
}
