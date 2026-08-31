import { type Action, generateActionId } from '@/types/actions/meta';
import { computeSnapshot } from '@/engine/compute';
import { countTEThresholdsPassed, getThresholdForTE } from '@/lib/truthEggs';
import { timeToEarnTE } from './te-thresholds';
import { computeShiftCosts } from './se-tracker';
import { calculateEggsLaidDuringActions } from './engine/eggs';
import type { EngineState, SimulationContext, AscensionSummary, ShiftResult } from './types';
import { runC1 } from './shifts/c1';
import { runK1 } from './shifts/k1';
import { runI1 } from './shifts/i1';
import { runC2 } from './shifts/c2';
import { runK2 } from './shifts/k2';
import { runR1 } from './shifts/r1';
import { runC3, type C3Params, type C3Variant } from './shifts/c3';
import { runH1 } from './shifts/h1';
import { runK3 } from './shifts/k3';
import { runC4, runI2, runR2, runH2, runTEWaitShift, distributeTargetTE, solveTEDistributionForDeadline } from './shifts/te-wait';
import { countSalesThrough, isResearchSaleActive, isEarningsBoostActive } from '@/lib/events';
import { calculateArtifactModifiers } from '@/lib/artifacts';
import { computeRealisticELR } from '@/calculations/realisticELR';
import { calculateEggValue } from '@/calculations/eggValue';
import { calculateEarnings } from '@/calculations/earnings';
import { getTiers, isTierUnlocked } from '@/calculations/commonResearch';
import type { VirtueEgg } from '@/types';
import { DEBUG_SHIFT_TIMING } from '@/lib/debugFlags';

function logShiftTimings(label: string, timings: { name: string; ms: number }[]): void {
  if (!DEBUG_SHIFT_TIMING) return;
  const totalMs = timings.reduce((sum, t) => sum + t.ms, 0);
  console.log(
    `[${label}] ${totalMs.toFixed(1)}ms total\n` + timings.map(t => `  ${t.name}: ${t.ms.toFixed(1)}ms`).join('\n')
  );
}

function computeLastTEDuration(finalTE: Record<VirtueEgg, number>, peakELR: number): number {
  const maxTE = Math.max(...Object.values(finalTE));
  if (maxTE <= 0 || peakELR <= 0) return 0;
  const prevEggs = maxTE > 1 ? getThresholdForTE(maxTE - 1) : 0;
  return timeToEarnTE(prevEggs, peakELR, 1);
}

/**
 * Derives the starting state for the next ascension in a sequential chain.
 * Carries forward permanent metrics (TE, SE, shifts) and resets farm-specific progress.
 */
export function deriveNextStartState(
  prevSummary: AscensionSummary,
  baseBackupState: EngineState
): EngineState {
  const totalTE = Object.values(prevSummary.finalTE).reduce((a, b) => a + b, 0);

  return {
    ...JSON.parse(JSON.stringify(baseBackupState)), // Copy permanent upgrades, artifact sets, etc.
    
    // Carried forward metrics
    te: totalTE,
    teEarned: { ...prevSummary.finalTE },
    soulEggs: prevSummary.endSoulEggs,
    shiftCount: prevSummary.endShiftCount,

    // Reset farm-specific progress
    currentEgg: 'curiosity',
    population: 1,
    bankValue: 0,
    researchLevels: {},
    habIds: [0, null, null, null],
    vehicles: [{ vehicleId: 0, trainLength: 1 }],
    lastStepTime: 0,
    eggsDelivered: { ...prevSummary.eggsDelivered },
    
    // Reset active modifiers
    activeSales: {
      research: false,
      hab: false,
      vehicle: false,
    },
    earningsBoost: {
      active: false,
      multiplier: 1,
    },
  };
}

// Every shift with genuinely variable arguments (C3, and the TE-earning K3/C4/I2/R2/H2 quintet) is
// now dispatched by name via its own concrete function rather than through this generic type — see
// the `shift.name === ...` branches below — since those shifts no longer share a common call shape
// (C3 takes `C3Params`; the TE-earning shifts take a `maxWaitSeconds` number). `allShifts` still
// lists all of them (for their `name`, used both for that dispatch and to define shift order), but
// `ShiftRunner` itself now only needs to describe the shifts actually still invoked generically via
// `shift.run` — the plain 2-arg ones (C2, K2, R1, H1) — every other listed shift's own function is
// still assignable here regardless, since a function is assignable wherever fewer arguments than it
// declares are required of it.
type ShiftRunner = (state: EngineState, context: SimulationContext) => ShiftResult;

// C1 -> {K1, I1} is not in this list: their order is chosen dynamically by runC1K1I1Segment,
// which both loops below run as an explicit first step.
const allShifts: { name: string; run: ShiftRunner }[] = [
  { name: 'C2', run: runC2 },
  { name: 'K2', run: runK2 },
  { name: 'R1', run: runR1 },
  { name: 'C3', run: runC3 },
  { name: 'H1', run: runH1 },
  { name: 'K3', run: runK3 },
  { name: 'C4', run: runC4 },
  { name: 'I2', run: runI2 },
  { name: 'R2', run: runR2 },
  { name: 'H2', run: runH2 },
];

/**
 * Runs the C1 -> {K1, I1} opening of an ascension, choosing between shift orders based on how
 * long I1 takes when run immediately after C1:
 *  - If I1 (run right after C1) would take under an hour of simulated time, that's the better
 *    order: C1, I1, K1.
 *  - Otherwise, fall back to the default order: C1, K1, I1.
 *
 * I1 has no time cap (see `runI1`) — it always runs to completion (all 4 hab slots maxed) — so
 * its duration from a given input state is deterministic. That means the speculative "run I1
 * right after C1" call below doubles as the real result whenever that order is chosen: no need
 * to simulate I1 twice. It's only discarded (and I1 re-simulated from the post-K1 state) when
 * the default order wins instead, since I1's output depends on its input state and K1 changes
 * that state first.
 */
function runC1K1I1Segment(
  startState: EngineState,
  context: SimulationContext
): ShiftResult & { shiftTimings: { name: string; ms: number }[] } {
  const actions: Action[] = [];
  let elapsedSeconds = 0;
  let currentState = startState;
  const shiftTimings: { name: string; ms: number }[] = [];

  const pushShiftResult = (name: string, result: ShiftResult, ms: number) => {
    const eggsLaid = calculateEggsLaidDuringActions(result.actions, currentState, context);
    if (result.actions.length > 0 && result.actions[0].type === 'shift') {
      result.actions[0].payload.eggsLaid = eggsLaid;
    }
    actions.push(...result.actions);
    currentState = result.endState;
    elapsedSeconds += result.elapsedSeconds;
    shiftTimings.push({ name, ms });
  };

  const timed = (name: string, fn: () => ShiftResult) => {
    const t0 = performance.now();
    pushShiftResult(name, fn(), performance.now() - t0);
  };

  currentState.lastStepTime = elapsedSeconds;
  timed('C1', () => runC1(currentState, context));

  currentState.lastStepTime = elapsedSeconds;
  const t0I1 = performance.now();
  const speculativeI1 = runI1(currentState, context);
  const speculativeI1Ms = performance.now() - t0I1;

  const I1_ORDER_SWAP_THRESHOLD_SECONDS = 3600;
  if (speculativeI1.elapsedSeconds < I1_ORDER_SWAP_THRESHOLD_SECONDS) {
    pushShiftResult('I1', speculativeI1, speculativeI1Ms);
    currentState.lastStepTime = elapsedSeconds;
    timed('K1', () => runK1(currentState, context));
  } else {
    timed('K1', () => runK1(currentState, context));
    currentState.lastStepTime = elapsedSeconds;
    timed('I1', () => runI1(currentState, context));
  }

  return { actions, elapsedSeconds, endState: currentState, shiftTimings };
}

/**
 * Runs the simulation until a specific shift name is reached.
 * Useful for precomputing common phases or debugging.
 */
export function runUntilShift(
  startState: EngineState,
  context: SimulationContext,
  stopBeforeShift: string
) {
  let currentState = JSON.parse(JSON.stringify(startState));
  let currentActions: Action[] = [];
  let totalElapsedSeconds = 0;

  const shiftTimings: { name: string; ms: number }[] = [];

  if (stopBeforeShift === 'C1') {
    return { state: currentState, actions: currentActions, elapsedSeconds: totalElapsedSeconds };
  }
  if (stopBeforeShift === 'K1' || stopBeforeShift === 'I1') {
    // K1/I1 no longer have a fixed slot — see runC1K1I1Segment — so stopping "before" either one
    // specifically isn't well-defined. Every current caller passes 'C3', well past this segment.
    throw new Error(
      `runUntilShift: cannot stop before '${stopBeforeShift}' — its position in the shift order is chosen dynamically at runtime`
    );
  }

  {
    const segmentResult = runC1K1I1Segment(currentState, context);
    shiftTimings.push(...segmentResult.shiftTimings);

    currentActions.push(...segmentResult.actions);
    currentState = segmentResult.endState;
    totalElapsedSeconds += segmentResult.elapsedSeconds;
  }

  for (const shift of allShifts) {
    if (shift.name === stopBeforeShift) break;
    currentState.lastStepTime = totalElapsedSeconds;
    const t0 = performance.now();
    const result = shift.run(currentState, context);
    shiftTimings.push({ name: shift.name, ms: performance.now() - t0 });

    // Calculate eggs laid during this shift (assuming full habs)
    const eggsLaid = calculateEggsLaidDuringActions(result.actions, currentState, context);
    if (result.actions.length > 0 && result.actions[0].type === 'shift') {
      result.actions[0].payload.eggsLaid = eggsLaid;
    }

    currentActions.push(...result.actions);
    currentState = result.endState;
    totalElapsedSeconds += result.elapsedSeconds;
  }

  logShiftTimings('C1 to R1', shiftTimings);

  return { state: currentState, actions: currentActions, elapsedSeconds: totalElapsedSeconds };
}

/**
 * Calculates the peak ELR reachable at the end of the build phase (K3).
 * This simulates buying a full fleet of the best vehicles.
 */
function calculatePeakELR(state: EngineState, context: SimulationContext): number {
  const currentState = JSON.parse(JSON.stringify(state));
  const maxSlots = 17; // Max slots in Egg Inc
  const maxLen = 10;   // Max cars per train (conservative estimate, will be updated by K3)
  
  // Fill fleet with Hyperloops (ID 11)
  currentState.vehicles = [];
  for (let i = 0; i < maxSlots; i++) {
    currentState.vehicles.push({ vehicleId: 11, trainLength: maxLen });
  }

  const artMods = calculateArtifactModifiers(currentState.artifactLoadout);
  const elrResult = computeRealisticELR(
    currentState.researchLevels,
    artMods,
    context.epicResearchLevels,
    context.colleggtibleModifiers
  );
  
  return elrResult.effectiveRate;
}

/**
 * Converts a peak ELR (eggs/second) into its money/second equivalent at `te`, using `state`'s
 * research/artifact levels for egg value and `context` for the earnings multipliers. Mirrors the
 * egg-value and earnings steps of `computeSnapshot` (engine/compute.ts), but with the caller's own
 * ELR override rather than the pipeline's own hab/lay/shipping calculation.
 */
function calculatePeakEarningsRate(
  state: EngineState,
  context: SimulationContext,
  peakELR: number,
  te: number
): number {
  const artifactMods = calculateArtifactModifiers(state.artifactLoadout);

  const eggValueOutput = calculateEggValue({
    baseValue: 1,
    researchLevels: state.researchLevels,
    artifactMultiplier: artifactMods.eggValue.totalMultiplier,
    artifactEffects: artifactMods.eggValue.effects,
  });

  const earningsOutput = calculateEarnings({
    eggValue: eggValueOutput.finalValue,
    effectiveLayRate: peakELR,
    te,
    earningsMultiplier: context.colleggtibleModifiers.earnings,
    awayEarningsMultiplier: context.colleggtibleModifiers.awayEarnings,
    artifactAwayMultiplier: artifactMods.awayEarnings.totalMultiplier,
    videoDoublerMultiplier: context.assumeDoubleEarnings ? 2 : 1,
    eventMultiplier: state.earningsBoost.active ? state.earningsBoost.multiplier : 1,
    artifactEffects: artifactMods.awayEarnings.effects,
  });

  return earningsOutput.onlineEarnings;
}

/**
 * Orchestrates a complete 12-shift ascension (C1 does not count as a shift).
 * 
 * @param startState - Starting engine state
 * @param context - Simulation context
 * @param buildPhaseEnd - Unix timestamp when the build phase should end (C3 end/sale boundary)
 * @param startTime - Unix timestamp when the ascension starts
 * @param id - Optional ID for the ascension
 * @param targetTE - Final target total TE for the entire ascension. Takes priority over
 *   `targetEndTime` when both are given.
 * @param targetEndTime - A hard wall-clock deadline for the ascension's own end, used only when
 *   `targetTE` is absent (e.g. a user-overridden ascension end date/time). The K3-H2 TE-earning
 *   shifts are clipped to land exactly on this instant via `solveTEDistributionForDeadline`,
 *   including fractional (sub-threshold) progress on whichever egg the deadline lands mid-wait on —
 *   unlike a `targetTE` goal, `endTime` will not overrun this value, but may finish a little short of
 *   it (e.g. once every egg is already at the 98-TE cap). `buildPhaseEnd` must itself be at or before
 *   `targetEndTime` — the build phase (through K3's own mandatory wait) cannot be truncated; callers
 *   choosing between C3 variants are expected to filter out any variant whose `buildPhaseEnd` doesn't
 *   fit before committing to this deadline.
 * @param resumeData - Optional data to skip ahead in the simulation
 * @param c3Params - Optional params forwarded to C3 (e.g. attemptTier13Unlock)
 */
export function runAscension(
  startState: EngineState,
  context: SimulationContext,
  buildPhaseEnd: number,
  startTime: number,
  id: string = 'asc_0',
  targetTE?: number,
  targetEndTime?: number,
  resumeData?: { actions: Action[]; state: EngineState; elapsedSeconds: number; resumeShiftName: string },
  c3Params?: C3Params
): { actions: Action[]; summary: AscensionSummary } {
  const actualStartState = JSON.parse(JSON.stringify(startState));
  
  if (!resumeData) {
    actualStartState.activeSales.research = isResearchSaleActive(startTime);
    actualStartState.earningsBoost.active = isEarningsBoostActive(startTime);
    actualStartState.earningsBoost.multiplier = 2;
  }
  
  let currentState = resumeData ? JSON.parse(JSON.stringify(resumeData.state)) : JSON.parse(JSON.stringify(actualStartState));
  let currentActions: Action[] = resumeData ? [...resumeData.actions] : [];
  let totalElapsedSeconds = resumeData ? resumeData.elapsedSeconds : 0;

  let skip = resumeData ? true : false;
  const ascShiftTimings: { name: string; ms: number }[] = [];
  // Set once H1 finishes below — H1 and K3 are adjacent in `allShifts`, so "end of H1" and
  // "start of K3" are the same instant.
  let buildDurationSeconds = 0;
  // Eggs whose TE-earning shift (K3/C4/I2/R2/H2) has already run this ascension. Passed to
  // distributeTargetTE/solveTEDistributionForDeadline so they stop being candidates for the *next* shift's
  // marginal TE allocation — otherwise a later recompute can "spend" the remaining TE budget on an
  // egg that will never be visited again, silently undershooting the requested target.
  const lockedEggs: VirtueEgg[] = [];

  if (!resumeData) {
    const segmentResult = runC1K1I1Segment(currentState, context);
    ascShiftTimings.push(...segmentResult.shiftTimings);

    currentActions.push(...segmentResult.actions);
    currentState = segmentResult.endState;
    totalElapsedSeconds += segmentResult.elapsedSeconds;
  } else if (
    resumeData.resumeShiftName === 'C1' ||
    resumeData.resumeShiftName === 'K1' ||
    resumeData.resumeShiftName === 'I1'
  ) {
    // K1/I1 no longer have a fixed slot — see runC1K1I1Segment — so resuming "at" either one
    // specifically isn't well-defined. The only current caller (runAscensionFromC3Variant)
    // always resumes at 'H1', well past this segment.
    throw new Error(
      `runAscension: cannot resume at '${resumeData.resumeShiftName}' — its position in the shift order is chosen dynamically at runtime`
    );
  }

  for (const shift of allShifts) {
    if (skip) {
      if (shift.name === resumeData!.resumeShiftName) skip = false;
      else continue;
    }

    currentState.lastStepTime = totalElapsedSeconds;

    const t0 = performance.now();
    let result: ShiftResult;
    if (shift.name === 'C3') {
      result = runC3(currentState, context, buildPhaseEnd, undefined, c3Params);
    } else if (shift.name === 'K3' || shift.name === 'C4' || shift.name === 'I2' || shift.name === 'R2' || shift.name === 'H2') {
      // For these shifts, we need the target TE split
      const currentTEs: Record<VirtueEgg, number> = {
        curiosity: countTEThresholdsPassed(currentState.eggsDelivered['curiosity'] || 0),
        integrity: countTEThresholdsPassed(currentState.eggsDelivered['integrity'] || 0),
        resilience: countTEThresholdsPassed(currentState.eggsDelivered['resilience'] || 0),
        humility: countTEThresholdsPassed(currentState.eggsDelivered['humility'] || 0),
        kindness: countTEThresholdsPassed(currentState.eggsDelivered['kindness'] || 0),
      };

      const activeEgg: VirtueEgg =
        shift.name === 'K3' ? 'kindness' :
        shift.name === 'C4' ? 'curiosity' :
        shift.name === 'I2' ? 'integrity' :
        shift.name === 'R2' ? 'resilience' : 'humility';

      let peakELR = currentState.maxELR || 0;
      if (shift.name === 'K3' && peakELR === 0) {
        peakELR = calculatePeakELR(currentState, context);
      }

      // Two mutually exclusive goal modes: an explicit whole-ascension TE target (`targetTE`), or a
      // hard end-time deadline (`targetEndTime`) — an end-date override recomputed fresh at every
      // one of these 5 shifts, exactly like `targetTE`'s own `distributeTargetTE` call always was,
      // so a shift's actual drift from its predicted share (e.g. K3 overshooting kindness while
      // riding out the build phase's own mandatory wait) is absorbed by the next shift's recompute
      // rather than compounding. `maxWaitSeconds` stays Infinity (a no-op clamp) in `targetTE` mode.
      let targets: Record<VirtueEgg, number>;
      let maxWaitSeconds = Infinity;

      if (targetTE) {
        // lockedEggs excludes eggs already processed by an earlier shift this ascension — see the
        // comment on `lockedEggs` above for why that's required (bug: 2026-08-05, off-by-one-TE).
        targets = distributeTargetTE(currentState.eggsDelivered, targetTE, lockedEggs);
      } else if (targetEndTime) {
        const remaining = Math.max(0, targetEndTime - (startTime + totalElapsedSeconds));
        const dist = solveTEDistributionForDeadline(currentTEs, currentState.eggsDelivered, peakELR, remaining, lockedEggs);
        targets = dist.targets;
        maxWaitSeconds = remaining;
        // This shift's own egg is the one with fractional leftover progress at the deadline: ask
        // for one TE more than its last confirmed-affordable whole target. `solveTEDistributionForDeadline`
        // already guarantees that request can't fully complete within `remaining`, so
        // `runTEWaitShift`/`runK3`'s own `maxWaitSeconds` clamp is guaranteed to bind, landing
        // exactly on the fractional `computeTEEarned` result rather than a whole extra threshold.
        if (dist.partial && dist.partial.egg === activeEgg) {
          targets = { ...targets, [activeEgg]: targets[activeEgg] + 1 };
        }
      } else {
        // No goal at all (shouldn't normally happen — every caller supplies one or the other):
        // don't force any additional progress.
        targets = currentTEs;
      }

      if (shift.name === 'K3') {
        result = runK3(currentState, context, buildPhaseEnd, targets[activeEgg], maxWaitSeconds);
      } else if (shift.name === 'C4') {
        result = runC4(currentState, context, targets[activeEgg], peakELR, maxWaitSeconds);
      } else if (shift.name === 'I2') {
        result = runI2(currentState, context, targets[activeEgg], peakELR, maxWaitSeconds);
      } else if (shift.name === 'R2') {
        result = runR2(currentState, context, targets[activeEgg], peakELR, maxWaitSeconds);
      } else {
        result = runH2(currentState, context, targets[activeEgg], peakELR, maxWaitSeconds);
      }

      lockedEggs.push(activeEgg);
    } else {
      result = shift.run(currentState, context);
    }

    // Calculate eggs laid during this shift (assuming full habs)
    const eggsLaid = calculateEggsLaidDuringActions(result.actions, currentState, context);
    if (result.actions.length > 0 && result.actions[0].type === 'shift') {
      result.actions[0].payload.eggsLaid = eggsLaid;
    }

    ascShiftTimings.push({ name: shift.name, ms: performance.now() - t0 });

    currentActions.push(...result.actions);
    currentState = result.endState;
    totalElapsedSeconds += result.elapsedSeconds;

    if (shift.name === 'H1') buildDurationSeconds = totalElapsedSeconds;
  }

  logShiftTimings(`Ascension ${id} (${resumeData ? `resume from ${resumeData.resumeShiftName}` : 'C1 to H2'})`, ascShiftTimings);

  // Prepend start action if not resuming
  if (!resumeData) {
    const startSnapshot = computeSnapshot(actualStartState, context);
    const startAction: Action = {
      id: generateActionId(),
      index: 0,
      timestamp: startTime * 1000,
      type: 'start_ascension',
      payload: { initialEgg: actualStartState.currentEgg as VirtueEgg },
      cost: 0,
      elrDelta: 0,
      offlineEarningsDelta: 0,
      eggValueDelta: 0,
      habCapacityDelta: 0,
      layRateDelta: 0,
      shippingCapacityDelta: 0,
      ihrDelta: 0,
      bankDelta: 0,
      populationDelta: 0,
      totalTimeSeconds: 0,
      endState: startSnapshot,
      dependsOn: [],
      dependents: [],
    };
    currentActions.unshift(startAction);
  }

  // Ensure indices are correct
  currentActions.forEach((a, idx) => {
    a.index = idx;
  });

  // SE cost tracking (C1 does not count as a shift; count actual shift actions in case some were skipped)
  const actualShiftCount = currentActions.filter(a => a.type === 'shift').length;
  const seResult = computeShiftCosts(startState.soulEggs, startState.shiftCount, actualShiftCount);

  // Calculate sale count in build phase
  const saleCount = countSalesThrough(startTime, buildPhaseEnd);

  // finalTE is the source of truth for TE totals: it's derived directly from
  // eggsDelivered, whereas currentState.te is an incrementally-maintained counter
  // that build-phase shifts (passive egg accumulation) don't update, so it can
  // under-count relative to finalTE.
  const finalTE = {
    curiosity: countTEThresholdsPassed(currentState.eggsDelivered['curiosity'] || 0),
    integrity: countTEThresholdsPassed(currentState.eggsDelivered['integrity'] || 0),
    resilience: countTEThresholdsPassed(currentState.eggsDelivered['resilience'] || 0),
    humility: countTEThresholdsPassed(currentState.eggsDelivered['humility'] || 0),
    kindness: countTEThresholdsPassed(currentState.eggsDelivered['kindness'] || 0),
  };
  const endTE = Object.values(finalTE).reduce((a, b) => a + b, 0);

  const tier13Unlocked = isTierUnlocked(currentState.researchLevels, Math.max(...getTiers()));

  // Build the summary
  const summary: AscensionSummary = {
    id,
    startTime,
    endTime: startTime + totalElapsedSeconds,
    totalDurationSeconds: totalElapsedSeconds,
    buildPhaseEndTime: buildPhaseEnd,
    buildPhaseSaleCount: saleCount,
    buildDurationSeconds,
    startTE: startState.te,
    endTE,
    teGained: endTE - startState.te,
    maxELR: currentState.maxELR || 0,
    maxEarningsRate: calculatePeakEarningsRate(currentState, context, currentState.maxELR || 0, endTE),
    startSoulEggs: startState.soulEggs,
    endSoulEggs: seResult.endingSE,
    startShiftCount: startState.shiftCount,
    endShiftCount: seResult.endingShiftCount,
    totalShiftCost: seResult.totalCost,
    eggsDelivered: { ...currentState.eggsDelivered },
    teEarned: {
      curiosity: (currentState.teEarned['curiosity'] || 0) - (startState.teEarned['curiosity'] || 0),
      integrity: (currentState.teEarned['integrity'] || 0) - (startState.teEarned['integrity'] || 0),
      resilience: (currentState.teEarned['resilience'] || 0) - (startState.teEarned['resilience'] || 0),
      humility: (currentState.teEarned['humility'] || 0) - (startState.teEarned['humility'] || 0),
      kindness: (currentState.teEarned['kindness'] || 0) - (startState.teEarned['kindness'] || 0),
    },
    finalTE,
    strategyLabel: `${saleCount}-sale build`,
    isMaxELRAscension: false,
    lastTEDurationSeconds: computeLastTEDuration(finalTE, currentState.maxELR || 0),
    tier13Unlocked,
  };

  return {
    actions: currentActions,
    summary,
  };
}

/**
 * Completes a single `C3Variant` (produced by `runC3Variants`) through the rest of the ascension
 * (H1-H2), resuming from the shared C1-R1 precompute rather than re-running it. `originalStartState`
 * must be the true pre-C1 ascension start state (the same value passed as `runAscension`'s own
 * `startState` for a from-scratch call) — `runAscension`'s post-loop bookkeeping (`startTE`,
 * `startSoulEggs`, `startShiftCount`, `teEarned` deltas) reads directly off that param even when
 * `resumeData` is set, so passing `preC3.state` (the post-C1-R1, pre-C3 state) there instead would
 * silently corrupt those fields — `preC3.state`'s `shiftCount` already includes the 5 shifts C1-R1
 * spent (K1/I1/C2/K2/R1; C1 itself doesn't count as a shift), and its `te`/`soulEggs` have already
 * moved. Caller passes `preC3`/`originalStartState` once per ascension step and reuses both for every
 * variant, per this plan's C1-R1 reuse requirement.
 */
export function runAscensionFromC3Variant(
  originalStartState: EngineState,
  preC3: { actions: Action[]; state: EngineState; elapsedSeconds: number },
  variant: C3Variant,
  context: SimulationContext,
  startTime: number,
  id: string,
  targetTE?: number,
  targetEndTime?: number
): { actions: Action[]; summary: AscensionSummary } {
  const resumeData = {
    actions: [...preC3.actions, ...variant.result.actions],
    state: variant.result.endState,
    elapsedSeconds: preC3.elapsedSeconds + variant.result.elapsedSeconds,
    resumeShiftName: 'H1' as const,
  };
  return runAscension(
    originalStartState,
    context,
    variant.buildPhaseEnd,
    startTime,
    id,
    targetTE,
    targetEndTime,
    resumeData
  );
}

/**
 * Simulates continuing the current ascension without any purchases or build phase.
 * Only shifts between eggs and waits for TE at the player's current ELR.
 * Visits each of the 5 virtue eggs 0 or 1 times, ending with balanced TE.
 * 
 * @param startState - Current engine state (with existing farm intact)
 * @param context - Simulation context
 * @param startTime - Unix timestamp when the plan starts
 * @param currentELR - The player's current effective lay rate (eggs/second)
 * @param targetTE - Final target total TE. Takes priority over `targetEndTime` when both are given.
 * @param id - Optional ID for the ascension
 * @param targetEndTime - A hard wall-clock deadline, used only when `targetTE` is absent — see
 *   `runAscension`'s own `targetEndTime` doc comment for the general shape. There's no build phase
 *   or fixed shift order here, so instead of clipping a specific shift's own wait mid-flight (as
 *   `runAscension`'s K3-H2 loop does), the whole-TE goal is solved once up front and any fractional
 *   leftover is applied as one extra top-up wait after every whole-TE visit is done — see the
 *   comment at that top-up's call site for why it's resolved after the fact rather than threaded
 *   through the main visit loop.
 */
export function runContinueCurrent(
  startState: EngineState,
  context: SimulationContext,
  startTime: number,
  currentELR: number,
  targetTE?: number,
  id: string = 'asc_continue',
  targetEndTime?: number
): { actions: Action[]; summary: AscensionSummary } {
  const actualStartState: EngineState = JSON.parse(JSON.stringify(startState));

  // Catch-up: add eggs laid since the farm's last sync (lastStepTime) up to the plan
  // start, assuming a constant lay rate. Mirrors the guard in computeSnapshot —
  // lastStepTime > 1e9 distinguishes a real Unix timestamp from a 0-based sim offset.
  const lastSyncTime = actualStartState.lastStepTime;
  if (lastSyncTime > 1e9 && startTime > lastSyncTime) {
    const elapsedSeconds = startTime - lastSyncTime;
    const catchUpEggs = currentELR * elapsedSeconds;
    const currentEgg = actualStartState.currentEgg;
    actualStartState.eggsDelivered[currentEgg] = (actualStartState.eggsDelivered[currentEgg] || 0) + catchUpEggs;

    // Recalculate TE earned for the current egg and total TE
    const newTE = countTEThresholdsPassed(actualStartState.eggsDelivered[currentEgg]);
    actualStartState.teEarned[currentEgg] = Math.max(actualStartState.teEarned[currentEgg] || 0, newTE);
    actualStartState.te = Object.values(actualStartState.teEarned).reduce((a, b) => a + b, 0);
  }

  let currentState: EngineState = JSON.parse(JSON.stringify(actualStartState));
  const currentActions: Action[] = [];
  let totalElapsedSeconds = 0;

  const allEggs: VirtueEgg[] = ['curiosity', 'kindness', 'integrity', 'resilience', 'humility'];

  // Calculate current TE per egg from eggs delivered
  const currentTEs: Record<VirtueEgg, number> = {
    curiosity: countTEThresholdsPassed(currentState.eggsDelivered['curiosity'] || 0),
    integrity: countTEThresholdsPassed(currentState.eggsDelivered['integrity'] || 0),
    resilience: countTEThresholdsPassed(currentState.eggsDelivered['resilience'] || 0),
    humility: countTEThresholdsPassed(currentState.eggsDelivered['humility'] || 0),
    kindness: countTEThresholdsPassed(currentState.eggsDelivered['kindness'] || 0),
  };

  // Distribute the whole-TE goal balanced across eggs. A hard deadline reuses the same
  // deadline-solving machinery `runAscension` uses, but only for the whole-TE part — the fractional
  // leftover (if any) is handled by the top-up pass below, not folded in here, since which egg ends
  // up with it can only be pinned down once the visits below actually happen (see that pass's own
  // comment for why).
  const hasDeadline = !targetTE && targetEndTime !== undefined;
  const targets = targetTE
    ? distributeTargetTE(currentState.eggsDelivered, targetTE)
    : hasDeadline
      ? solveTEDistributionForDeadline(
          currentTEs, currentState.eggsDelivered, currentELR, Math.max(0, targetEndTime! - startTime)
        ).targets
      : { ...currentTEs };

  // Determine which eggs need more TE, sorted by needed TE (ascending — cheapest first)
  const eggsToVisit = allEggs
    .filter(egg => targets[egg] > currentTEs[egg])
    .sort((a, b) => (targets[a] - currentTEs[a]) - (targets[b] - currentTEs[b]));

  // If the player's current egg from backup needs visiting, prioritize it to the front
  const currentEggIdx = eggsToVisit.indexOf(currentState.currentEgg as VirtueEgg);
  if (currentEggIdx !== -1) {
    eggsToVisit.splice(currentEggIdx, 1);
    eggsToVisit.unshift(currentState.currentEgg as VirtueEgg);
  }

  // Run TE wait shifts for each egg that needs visiting. No per-shift time cap needed even in
  // deadline mode: `targets` above is a set of whole per-egg TE goals that `solveTEDistributionForDeadline`
  // already proved fits within the full time budget in total, and — since eggs don't earn TE while
  // a different egg is active — the total time to reach a given set of whole targets is the same
  // regardless of visit order, so running this list in whatever order `eggsToVisit` picked can never
  // overrun the deadline itself (unlike `runAscension`'s K3, there's no extra mandatory wait baked
  // in here that could throw that off).
  for (const egg of eggsToVisit) {
    currentState.lastStepTime = totalElapsedSeconds;
    const result = runTEWaitShift(currentState, context, egg, targets[egg], currentELR);

    currentActions.push(...result.actions);
    currentState = result.endState;
    totalElapsedSeconds += result.elapsedSeconds;
  }

  // Deadline mode only: apply whatever fractional leftover remains as one final top-up wait.
  // Recomputed fresh from the post-loop `currentState` — rather than trying to track which egg
  // `solveTEDistributionForDeadline`'s very first call above called `partial` — because
  // `eggsToVisit`'s own sort (by whole-TE delta, for a reason unrelated to this) doesn't guarantee
  // the same visit order that greedy pick assumed; recomputing after the fact sidesteps that
  // mismatch entirely and just asks "given where things actually ended up, who's cheapest now?".
  if (hasDeadline) {
    const remaining = Math.max(0, targetEndTime! - (startTime + totalElapsedSeconds));
    if (remaining > 0) {
      const postLoopTEs: Record<VirtueEgg, number> = {
        curiosity: countTEThresholdsPassed(currentState.eggsDelivered['curiosity'] || 0),
        integrity: countTEThresholdsPassed(currentState.eggsDelivered['integrity'] || 0),
        resilience: countTEThresholdsPassed(currentState.eggsDelivered['resilience'] || 0),
        humility: countTEThresholdsPassed(currentState.eggsDelivered['humility'] || 0),
        kindness: countTEThresholdsPassed(currentState.eggsDelivered['kindness'] || 0),
      };
      const dist = solveTEDistributionForDeadline(postLoopTEs, currentState.eggsDelivered, currentELR, remaining);
      if (dist.partial) {
        currentState.lastStepTime = totalElapsedSeconds;
        const result = runTEWaitShift(
          currentState, context, dist.partial.egg, postLoopTEs[dist.partial.egg] + 1, currentELR, remaining
        );

        currentActions.push(...result.actions);
        currentState = result.endState;
        totalElapsedSeconds += result.elapsedSeconds;
      }
    }
  }

  // If the player is already on an egg that doesn't need visiting (e.g. kindness with 0 needed),
  // we might end on a different egg. The TE wait shifts handle this via their shift logic.

  // Prepend start action
  const startSnapshot = computeSnapshot(actualStartState, context);
  const startAction: Action = {
    id: generateActionId(),
    index: 0,
    timestamp: startTime * 1000,
    type: 'start_ascension',
    payload: { initialEgg: actualStartState.currentEgg as VirtueEgg },
    cost: 0,
    elrDelta: 0,
    offlineEarningsDelta: 0,
    eggValueDelta: 0,
    habCapacityDelta: 0,
    layRateDelta: 0,
    shippingCapacityDelta: 0,
    ihrDelta: 0,
    bankDelta: 0,
    populationDelta: 0,
    totalTimeSeconds: 0,
    endState: startSnapshot,
    dependsOn: [],
    dependents: [],
  };
  currentActions.unshift(startAction);

  // Fix indices
  currentActions.forEach((a, idx) => {
    a.index = idx;
  });

  // SE cost — count only the shifts we actually did
  const shiftCount = currentActions.filter(a => a.type === 'shift').length;
  const seResult = computeShiftCosts(startState.soulEggs, startState.shiftCount, shiftCount);

  const finalTE = {
    curiosity: countTEThresholdsPassed(currentState.eggsDelivered['curiosity'] || 0),
    integrity: countTEThresholdsPassed(currentState.eggsDelivered['integrity'] || 0),
    resilience: countTEThresholdsPassed(currentState.eggsDelivered['resilience'] || 0),
    humility: countTEThresholdsPassed(currentState.eggsDelivered['humility'] || 0),
    kindness: countTEThresholdsPassed(currentState.eggsDelivered['kindness'] || 0),
  };
  const endTE = Object.values(finalTE).reduce((a, b) => a + b, 0);

  const summary: AscensionSummary = {
    id,
    startTime,
    endTime: startTime + totalElapsedSeconds,
    totalDurationSeconds: totalElapsedSeconds,
    buildPhaseEndTime: startTime, // No build phase
    buildPhaseSaleCount: 1,
    buildDurationSeconds: 0, // No build phase
    startTE: startState.te,
    endTE,
    teGained: endTE - startState.te,
    maxELR: currentELR,
    maxEarningsRate: calculatePeakEarningsRate(currentState, context, currentELR, endTE),
    startSoulEggs: startState.soulEggs,
    endSoulEggs: seResult.endingSE,
    startShiftCount: startState.shiftCount,
    endShiftCount: seResult.endingShiftCount,
    totalShiftCost: seResult.totalCost,
    eggsDelivered: { ...currentState.eggsDelivered },
    teEarned: {
      curiosity: (currentState.teEarned['curiosity'] || 0) - (startState.teEarned['curiosity'] || 0),
      integrity: (currentState.teEarned['integrity'] || 0) - (startState.teEarned['integrity'] || 0),
      resilience: (currentState.teEarned['resilience'] || 0) - (startState.teEarned['resilience'] || 0),
      humility: (currentState.teEarned['humility'] || 0) - (startState.teEarned['humility'] || 0),
      kindness: (currentState.teEarned['kindness'] || 0) - (startState.teEarned['kindness'] || 0),
    },
    finalTE,
    strategyLabel: 'Continue current',
    isMaxELRAscension: false,
    lastTEDurationSeconds: computeLastTEDuration(finalTE, currentELR),
    tier13Unlocked: isTierUnlocked(currentState.researchLevels, Math.max(...getTiers())),
  };

  return {
    actions: currentActions,
    summary,
  };
}
