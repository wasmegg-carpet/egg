import type { Action } from '@/types/actions/meta';
import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { computeSnapshot } from '../../engine/compute';
import { applyAction } from '../../engine/apply';
import { createSimAction } from '@/types/actions/meta';
import { shiftCost } from 'lib';
import { TE_BREAKPOINTS, countTEThresholdsPassed, getThresholdForTE } from '@/lib/truthEggs';
import { computeTEEarned, timeToEarnTE } from '../te-thresholds';
import type { VirtueEgg } from '@/types/actions/virtue';

const ALL_VIRTUE_EGGS: VirtueEgg[] = ['curiosity', 'integrity', 'resilience', 'humility', 'kindness'];

/**
 * Distributes a target total TE across the 5 virtue eggs in a way that
 * minimizes total time, by greedily assigning each next TE to whichever egg
 * needs the fewest additional eggs delivered to cross its next threshold.
 *
 * Mirrors `BulkWaitForTEActions.vue`'s `calculateGreedyGains`: cost is based on
 * each egg's actual `eggsDelivered` (which may sit strictly between two TE
 * thresholds), not just its current TE count — comparing raw threshold values
 * would ignore partial progress and effectively just equalize TE counts.
 *
 * `runAscension` calls this fresh before every TE-earning shift (K3, C4, I2, R2, H2), since each
 * shift's actual result can drift from its previously-assigned target (e.g. K3 may overshoot its
 * kindness target because it also has to wait out the build-phase sale window). Eggs whose shift
 * has already run this ascension are "locked in" — nothing will revisit them — so they must be
 * excluded from the greedy candidate pool via `lockedEggs`, or this function can end up assigning
 * the marginal TE to an egg that will never actually earn it, silently undershooting the target.
 *
 * @param eggsDelivered - Map of lifetime eggs delivered per egg
 * @param targetTotalTE - Goal total TE for the entire ascension
 * @param lockedEggs - Eggs whose TE-earning shift has already run this ascension and won't run
 *   again; excluded from receiving any of the marginal TE being distributed here.
 * @returns Map of target TE per egg
 */
export function distributeTargetTE(
  eggsDelivered: Record<VirtueEgg, number>,
  targetTotalTE: number,
  lockedEggs: VirtueEgg[] = []
): Record<VirtueEgg, number> {
  const targets: Record<VirtueEgg, number> = {} as Record<VirtueEgg, number>;
  const delivered: Record<VirtueEgg, number> = {} as Record<VirtueEgg, number>;

  for (const egg of ALL_VIRTUE_EGGS) {
    delivered[egg] = eggsDelivered[egg] || 0;
    targets[egg] = countTEThresholdsPassed(delivered[egg]);
  }

  let currentTotal = Object.values(targets).reduce((a, b) => a + b, 0);

  while (currentTotal < targetTotalTE) {
    // Find the egg where the next TE needs the fewest additional eggs delivered,
    // considering only eggs that can still actually be acted on this ascension.
    let bestEgg: VirtueEgg | null = null;
    let bestCost = Infinity;

    for (const egg of ALL_VIRTUE_EGGS) {
      if (lockedEggs.includes(egg)) continue;

      const currentTE = targets[egg];
      if (currentTE >= TE_BREAKPOINTS.length) continue;

      const nextThreshold = TE_BREAKPOINTS[currentTE];
      const cost = Math.max(0, nextThreshold - delivered[egg]);
      if (cost < bestCost) {
        bestCost = cost;
        bestEgg = egg;
      }
    }

    if (!bestEgg) break; // No unlocked egg left that can take more TE (or target > max total TE)

    targets[bestEgg]++;
    delivered[bestEgg] = TE_BREAKPOINTS[targets[bestEgg] - 1];
    currentTotal++;
  }

  return targets;
}

/**
 * Among eggs that aren't locked and haven't hit the 98-TE cap, finds whichever needs the least
 * additional TIME to earn its next single TE at a constant `peakELR`. Shared by
 * `solveTEForTimeBudget` (which only cares about whole TE reached) and
 * `solveTEDistributionForDeadline` (which also wants this exact candidate — egg and time — to
 * compute fractional progress on whichever egg the budget runs out on).
 *
 * @param targets - Current whole-TE count per egg (the loop's running totals, not necessarily
 *   the ascension's starting counts).
 * @param eggsDelivered - Current lifetime eggs delivered per egg, consistent with `targets`.
 */
function findCheapestNextTE(
  targets: Record<VirtueEgg, number>,
  eggsDelivered: Record<VirtueEgg, number>,
  peakELR: number,
  lockedEggs: VirtueEgg[]
): { egg: VirtueEgg; time: number } | null {
  let bestEgg: VirtueEgg | null = null;
  let minTime = Infinity;

  for (const egg of ALL_VIRTUE_EGGS) {
    if (lockedEggs.includes(egg)) continue;

    if (targets[egg] < TE_BREAKPOINTS.length) {
      const time = timeToEarnTE(eggsDelivered[egg] || 0, peakELR, 1);
      if (time < minTime) {
        minTime = time;
        bestEgg = egg;
      }
    }
  }

  return bestEgg ? { egg: bestEgg, time: minTime } : null;
}

/**
 * Finds the maximum total TE goal that can be reached within a given time budget.
 * Uses a greedy approach similar to distributeTargetTE but constrained by time.
 *
 * @param lockedEggs - Eggs whose TE-earning shift has already run this ascension and won't run
 *   again; excluded from the candidate pool for the same reason as in `distributeTargetTE`.
 */
export function solveTEForTimeBudget(
  currentTEs: Record<VirtueEgg, number>,
  currentEggsDelivered: Record<VirtueEgg, number>,
  peakELR: number,
  timeBudgetSeconds: number,
  lockedEggs: VirtueEgg[] = []
): number {
  if (timeBudgetSeconds <= 0) return Object.values(currentTEs).reduce((a, b) => a + b, 0);
  if (peakELR <= 0) return Object.values(currentTEs).reduce((a, b) => a + b, 0);

  const targets = { ...currentTEs };
  const eggsDelivered = { ...currentEggsDelivered };
  let remainingTime = timeBudgetSeconds;

  while (remainingTime > 0) {
    const next = findCheapestNextTE(targets, eggsDelivered, peakELR, lockedEggs);
    if (!next || next.time > remainingTime) break;

    remainingTime -= next.time;
    targets[next.egg]++;
    // Update eggsDelivered to the threshold we just hit
    eggsDelivered[next.egg] = getThresholdForTE(targets[next.egg]);
  }

  const finalTotal = Object.values(targets).reduce((a, b) => a + b, 0);
  return finalTotal;
}

export interface TEDeadlineDistribution {
  /** Whole-TE target per egg, each reachable without exceeding the time budget — same shape as
   * `distributeTargetTE`'s return value, and, taken together, requiring no more real execution
   * time than `timeBudgetSeconds` regardless of which order the 5 TE-earning shifts visit eggs in
   * (constant `peakELR` means total time to reach a *set* of whole per-egg targets is the sum of
   * each egg's own time from its own starting point — order-independent). */
  targets: Record<VirtueEgg, number>;
  /** The one egg — always whichever egg `findCheapestNextTE` would have assigned the NEXT whole TE
   * to — that has leftover fractional progress toward its own next TE at the exact deadline, short
   * of a full threshold (so it does NOT appear incremented in `targets`). `null` when the budget
   * was exhausted exactly on a threshold, when every un-locked egg is already at the 98-TE cap, or
   * when `peakELR <= 0` (no progress possible at all). */
  partial: { egg: VirtueEgg; eggsDelivered: number } | null;
}

/**
 * Like `solveTEForTimeBudget`, but for a hard wall-clock deadline rather than a TE goal: instead of
 * discarding whatever time is left over once no egg can afford a full next TE within the budget,
 * reports that leftover as fractional progress (partial eggs delivered, short of the next
 * threshold) on whichever egg would have been next in line. This is what lets an ascension's end
 * time be pinned to an exact, user-chosen instant — including one that lands mid-egg rather than
 * neatly on a TE boundary — instead of always finishing a little early on the last clean threshold.
 *
 * Reuses the exact same greedy "cheapest next TE, globally, wins" ordering `solveTEForTimeBudget`
 * uses for `targets`, so the two functions agree on whole-TE totals for the same inputs; this one
 * just doesn't throw away the remainder.
 *
 * @param lockedEggs - Eggs whose TE-earning shift has already run this ascension and won't run
 *   again; excluded from both `targets` and `partial` for the same reason as in
 *   `distributeTargetTE`/`solveTEForTimeBudget`.
 */
export function solveTEDistributionForDeadline(
  currentTEs: Record<VirtueEgg, number>,
  currentEggsDelivered: Record<VirtueEgg, number>,
  peakELR: number,
  timeBudgetSeconds: number,
  lockedEggs: VirtueEgg[] = []
): TEDeadlineDistribution {
  const targets = { ...currentTEs };

  if (timeBudgetSeconds <= 0 || peakELR <= 0) {
    return { targets, partial: null };
  }

  const eggsDelivered = { ...currentEggsDelivered };
  let remainingTime = timeBudgetSeconds;
  let next = findCheapestNextTE(targets, eggsDelivered, peakELR, lockedEggs);

  while (next && next.time <= remainingTime) {
    remainingTime -= next.time;
    targets[next.egg]++;
    eggsDelivered[next.egg] = getThresholdForTE(targets[next.egg]);
    next = findCheapestNextTE(targets, eggsDelivered, peakELR, lockedEggs);
  }

  // `next` here is either null (nothing left that can ever take more TE) or the cheapest
  // candidate that didn't fit — exactly the egg fractional leftover time should go to.
  if (!next || remainingTime <= 0) {
    return { targets, partial: null };
  }

  const { finalEggsDelivered } = computeTEEarned(eggsDelivered[next.egg] || 0, peakELR, remainingTime);
  return { targets, partial: { egg: next.egg, eggsDelivered: finalEggsDelivered } };
}

/**
 * Runs a TE-earning shift for a specific egg.
 * Waits until the target TE for that egg is reached at peak ELR.
 *
 * @param maxWaitSeconds - Hard ceiling on how long this shift's own wait may run, regardless of
 *   `targetTEForEgg` — defaults to unbounded (existing behavior, unchanged for every pre-existing
 *   caller). An ascension end-time override passes the time remaining until its deadline here, so a
 *   wait that can't fully reach `targetTEForEgg` in time gets clipped instead of overrunning it;
 *   `computeTEEarned` then reports whatever fractional (sub-threshold) progress that clipped
 *   duration actually buys, which is the whole point when this shift is the one
 *   `solveTEDistributionForDeadline` identified as the deadline's `partial` egg (see that function's
 *   own doc comment) — callers signal that by requesting one TE past its last confirmed-affordable
 *   whole target, guaranteeing the natural wait time exceeds `maxWaitSeconds` and the clamp binds.
 */
export function runTEWaitShift(
  state: EngineState,
  context: SimulationContext,
  egg: VirtueEgg,
  targetTEForEgg: number,
  peakELR: number,
  maxWaitSeconds: number = Infinity
): ShiftResult {
  let currentState = { ...state };
  let elapsedSeconds = 0;
  const actions: Action[] = [];

  // Skip entirely if this egg already has enough TE, or if there's no time left to spend on it at all.
  const currentTECheck = countTEThresholdsPassed(currentState.eggsDelivered[egg] || 0);
  if (targetTEForEgg <= currentTECheck || maxWaitSeconds <= 0) {
    return { actions: [], elapsedSeconds: 0, endState: state };
  }

  // 1. Shift to target egg if not already there
  if (currentState.currentEgg !== egg) {
    const sCost = shiftCost(currentState.soulEggs, currentState.shiftCount);
    const shiftAction = createSimAction('shift', {
      fromEgg: currentState.currentEgg,
      toEgg: egg,
      newShiftCount: currentState.shiftCount + 1,
    }, sCost);

    currentState = applyAction(currentState, shiftAction);

    // Decoration
    const finalSnap = computeSnapshot(currentState, context, { skipGrowth: true });
    shiftAction.endState = finalSnap;
    shiftAction.totalTimeSeconds = 0;

    actions.push(shiftAction);
  }

  // 2. Wait until target TE is reached, or until maxWaitSeconds runs out — whichever comes first.
  const currentEggsDelivered = currentState.eggsDelivered[egg] || 0;
  const currentTE = countTEThresholdsPassed(currentEggsDelivered);
  const neededTE = Math.max(0, targetTEForEgg - currentTE);

  if (neededTE > 0) {
    const rawWaitTime = timeToEarnTE(currentEggsDelivered, peakELR, neededTE);
    const waitTime = rawWaitTime === Infinity ? rawWaitTime : Math.min(rawWaitTime, maxWaitSeconds);
    if (waitTime > 0 && waitTime !== Infinity) {
      const teResult = computeTEEarned(currentEggsDelivered, peakELR, waitTime);

      const waitAction = createSimAction('wait_for_te', {
        egg,
        // Actual TE reached, not the originally-requested `currentTE + neededTE` — the two only
        // diverge when `maxWaitSeconds` clipped this wait short of its full request (deadline mode).
        targetTE: currentTE + teResult.teEarned,
        teGained: teResult.teEarned,
        eggsToLay: teResult.finalEggsDelivered - currentEggsDelivered,
        timeSeconds: waitTime,
        startEggsDelivered: currentEggsDelivered,
        startTE: currentTE
      });
      
      // Update state manually because applyAction doesn't know about TE tracking or time
      currentState = applyAction(currentState, waitAction);
      const snap = computeSnapshot(currentState, context, { skipGrowth: true });
      currentState.lastStepTime = (currentState.lastStepTime || 0) + waitTime;
      currentState.bankValue += snap.offlineEarnings * waitTime;
      
      currentState.eggsDelivered = { ...currentState.eggsDelivered, [egg]: teResult.finalEggsDelivered };
      currentState.teEarned = { ...currentState.teEarned, [egg]: (currentState.teEarned[egg] || 0) + teResult.teEarned };
      currentState.te += teResult.teEarned;
      
      // Decoration
      const finalSnap = computeSnapshot(currentState, context, { skipGrowth: true });
      waitAction.endState = finalSnap;
      waitAction.totalTimeSeconds = waitTime;
      waitAction.bankDelta = snap.offlineEarnings * waitTime;

      actions.push(waitAction);
      elapsedSeconds += waitTime;
    }
  }

  return {
    actions,
    elapsedSeconds,
    endState: currentState,
  };
}

export function runC4(state: EngineState, context: SimulationContext, targetTEForEgg: number = 0, peakELR: number = 0, maxWaitSeconds: number = Infinity): ShiftResult {
  return runTEWaitShift(state, context, 'curiosity', targetTEForEgg, peakELR, maxWaitSeconds);
}

export function runI2(state: EngineState, context: SimulationContext, targetTEForEgg: number = 0, peakELR: number = 0, maxWaitSeconds: number = Infinity): ShiftResult {
  return runTEWaitShift(state, context, 'integrity', targetTEForEgg, peakELR, maxWaitSeconds);
}

export function runR2(state: EngineState, context: SimulationContext, targetTEForEgg: number = 0, peakELR: number = 0, maxWaitSeconds: number = Infinity): ShiftResult {
  return runTEWaitShift(state, context, 'resilience', targetTEForEgg, peakELR, maxWaitSeconds);
}

export function runH2(state: EngineState, context: SimulationContext, targetTEForEgg: number = 0, peakELR: number = 0, maxWaitSeconds: number = Infinity): ShiftResult {
  return runTEWaitShift(state, context, 'humility', targetTEForEgg, peakELR, maxWaitSeconds);
}
