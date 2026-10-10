import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { getResearchById, isTierUnlocked } from '../../calculations/commonResearch';
import { rankResearchByROI } from '../../calculations/researchRanking';
import { computeSnapshot } from '../../engine/compute';
import { MAX_SILOS } from '@/stores/silos';
import { isResearchSaleActive, getNextSaleEnd } from '@/lib/events';
import { buildR1LookaheadNotePayload } from '@/lib/actions/notes';
import type { DeferralCheckpoint } from './helpers/earningsEventDeferral';
import { applyShiftAction } from './helpers/actionHelpers';
import {
  createMilestoneShiftHelpers,
  runTierUnlockMilestone,
  runBuyResearchLevelByLevel,
} from './helpers/milestones';
import { runK2 } from './k2';
import { runR1 } from './r1';

const FLEET_RESEARCH_IDS = [
  'vehicle_reliablity',
  'excoskeletons',
  'traffic_management',
  'egg_loading_bots',
  'autonomous_vehicles',
];
const GRAVITON_COUPLING_ID = 'micro_coupling';
const C2_TIME_LIMIT_SECONDS = 14400; // 4 hours

/**
 * C2 Shift Strategy:
 * 1. Shift to Curiosity.
 * 2. Buy every fleet_size research to its max level, one level at a time.
 * 3. Unlock graviton_coupling's tier if C1 didn't already (its Phase 2 can roll this back), then
 *    buy graviton_coupling levels, one at a time, each level only if its ENTIRE purchase chain
 *    (target level plus whatever earnings research speeds up reaching it) fits within the
 *    remaining time budget — never a partial down payment toward a level that won't finish before
 *    the shift ends (see `runBuyResearchLevelByLevel`'s own comment). If the attempt buys zero
 *    levels, the whole attempt (unlock included) is rolled back — no point paying to unlock the tier
 *    if nothing gets bought once it's open (mirrors C1's own Graviton Coupling checkpoint/rollback).
 *
 * 4. Spend whatever budget is left buying earnings research if, and only if, doing so pays off by
 *    the end of R1 — see `runR1LookaheadEarningsBuy`.
 *
 * Steps 2-3 both go through `runBuyResearchLevelByLevel` — shared with C1 for the same reason — so
 * every milestone call, across steps 2-4, shares one running 4-hour clock, matching this shift's
 * overall time budget.
 */
export function runC2(startState: EngineState, context: SimulationContext): ShiftResult {
  const shifted = applyShiftAction(startState, context, 'curiosity');

  let currentState = shifted.state;
  let elapsedSeconds = 0;
  const actions = shifted.saleToggleAction ? [shifted.action, shifted.saleToggleAction] : [shifted.action];

  const remainingBudget = () => C2_TIME_LIMIT_SECONDS - elapsedSeconds;

  const runMilestone = (result: ShiftResult) => {
    currentState = result.endState;
    elapsedSeconds += result.elapsedSeconds;
    actions.push(...result.actions);
  };

  const buyLevelByLevel = (id: string) => {
    runMilestone(runBuyResearchLevelByLevel(currentState, context, id, remainingBudget()));
  };

  // 2. Buy every fleet_size research to its max level, one level at a time
  for (const id of FLEET_RESEARCH_IDS) {
    buyLevelByLevel(id);
  }

  // 3. Graviton coupling. Checkpoint first so a failed attempt (whether the tier unlock itself
  // falls short, or it unlocks but no level ends up affordable) can be discarded in full, rather
  // than stranding a naked tier unlock with nothing bought against it. Mirrors C1's own Graviton
  // Coupling checkpoint/rollback (`runC1`).
  const gcResearch = getResearchById(GRAVITON_COUPLING_ID);
  if (gcResearch) {
    const checkpointState = currentState;
    const checkpointElapsedSeconds = elapsedSeconds;
    const checkpointActionsLength = actions.length;
    const gravitonLevelBefore = currentState.researchLevels[GRAVITON_COUPLING_ID] || 0;

    if (!isTierUnlocked(currentState.researchLevels, gcResearch.tier)) {
      runMilestone(runTierUnlockMilestone(currentState, context, gcResearch.tier, remainingBudget()));
    }
    if (isTierUnlocked(currentState.researchLevels, gcResearch.tier)) {
      buyLevelByLevel(GRAVITON_COUPLING_ID);
    }

    const gravitonLevelAfter = currentState.researchLevels[GRAVITON_COUPLING_ID] || 0;
    if (gravitonLevelAfter <= gravitonLevelBefore) {
      currentState = checkpointState;
      elapsedSeconds = checkpointElapsedSeconds;
      actions.length = checkpointActionsLength;
    }
  }

  // 4. After graviton coupling, since its level sets the train length K2 maxes out to, which the
  // lookahead's own K2/R1 simulation depends on.
  runMilestone(runR1LookaheadEarningsBuy(currentState, context, remainingBudget()));

  return { actions, elapsedSeconds, endState: currentState };
}

/**
 * How a candidate end-of-C2 state plays out through the end of R1. `totalSeconds` counts the C2
 * time spent getting to that state (from wherever the lookahead started), plus all of K2 and R1.
 */
interface ThroughR1Score {
  siloCount: number;
  totalSeconds: number;
}

/**
 * Runs the real K2 and R1 from `state` rather than an approximation of them, so the score is
 * exactly what those shifts will do if C2 ends here — in particular K2 maxes every Hyperloop's
 * train to whatever graviton coupling now allows, and R1 earns at that maxed shipping rate.
 */
function scoreThroughR1(state: EngineState, context: SimulationContext, c2Seconds: number): ThroughR1Score {
  const k2 = runK2(state, context);
  const r1 = runR1(k2.endState, context);
  return {
    siloCount: r1.endState.siloCount,
    totalSeconds: c2Seconds + k2.elapsedSeconds + r1.elapsedSeconds,
  };
}

/** An extra silo always wins, whatever it costs in time; otherwise less total time wins. */
function isBetterScore(a: ThroughR1Score, b: ThroughR1Score): boolean {
  if (a.siloCount !== b.siloCount) return a.siloCount > b.siloCount;
  return a.totalSeconds < b.totalSeconds;
}

/**
 * C2 step 4: buy earnings research in ROI order with the remaining budget, scoring every stopping
 * point by how it plays out through R1, and keep the best one.
 *
 * C2's own milestone chains only value earnings research for how fast it reaches the next graviton
 * coupling level, at C2's pre-K2 earnings rate. But K2 comes next and maxes every vehicle, after
 * which R1 earns at a much higher shipping rate — so research that looks pointless in C2 can make R1
 * shorter or bring another silo within its hour. Hence `'maxed_vehicles'` ranking here (time to buy
 * at the current rate, payback at the maxed-vehicle rate), unlike C1/C3's `'immediate'`.
 *
 * Silo costs grow so steeply that the payoff comes in jumps: several purchases can change nothing
 * before one more makes the next silo affordable. So this never stops at the first purchase that
 * doesn't help — it keeps buying until the budget or the candidates run out, then rewinds to the
 * best stopping point seen (which may be no purchases at all). The one early exit: once the best
 * plan already reaches `MAX_SILOS`, only time can still improve, and the C2 time spent so far is a
 * lower bound on any later stopping point's total, so once it reaches the best total nothing later
 * can win.
 *
 * Each round buys the highest-ranked candidate that fits in what's left of `timeLimit`, not just the
 * top one — a lower-ranked purchase that fits can still be the one that tips the next silo.
 */
export function runR1LookaheadEarningsBuy(
  startState: EngineState,
  context: SimulationContext,
  timeLimit: number
): ShiftResult {
  const helpers = createMilestoneShiftHelpers(startState, context);

  const baseline = scoreThroughR1(startState, context, 0);
  let best: { score: ThroughR1Score; checkpoint: DeferralCheckpoint; purchaseCount: number; gemsSpent: number } = {
    score: baseline,
    checkpoint: helpers.deferralHost.checkpoint(),
    purchaseCount: 0,
    gemsSpent: 0,
  };
  let purchaseCount = 0;
  let gemsSpent = 0;

  while (!(best.score.siloCount >= MAX_SILOS && helpers.getElapsedSeconds() >= best.score.totalSeconds)) {
    const state = helpers.getState();
    const snapshot = computeSnapshot(state, context, { skipGrowth: true });
    const absTime = helpers.getAbsTime();
    const ranked = rankResearchByROI(
      state.researchLevels,
      snapshot,
      context,
      helpers.getModifiers(),
      isResearchSaleActive(absTime),
      absTime,
      getNextSaleEnd(absTime),
      'maxed_vehicles',
      false
    );

    // `buyResearch` returns false before advancing time or spending anything when the purchase
    // doesn't fit `timeLimit`, so trying candidates in order until one lands is side-effect free.
    // A candidate that never pays for itself even at the maxed rate can't help R1 either.
    const bought = ranked.some(
      item =>
        item.canBuy && isFinite(item.totalRoiSeconds ?? Infinity) && helpers.buyResearch(item.research.id, timeLimit)
    );
    if (!bought) break;

    const actions = helpers.getActions();
    purchaseCount++;
    gemsSpent += actions[actions.length - 1].cost;

    const score = scoreThroughR1(helpers.getState(), context, helpers.getElapsedSeconds());
    if (isBetterScore(score, best.score)) {
      best = { score, checkpoint: helpers.deferralHost.checkpoint(), purchaseCount, gemsSpent };
    }
  }

  helpers.deferralHost.restore(best.checkpoint);

  const notePayload = buildR1LookaheadNotePayload(
    best.purchaseCount,
    helpers.getElapsedSeconds(),
    best.gemsSpent,
    best.score.siloCount - baseline.siloCount,
    baseline.totalSeconds - best.score.totalSeconds
  );
  if (notePayload) helpers.addNotification(notePayload);

  return {
    actions: helpers.getActions(),
    elapsedSeconds: helpers.getElapsedSeconds(),
    endState: helpers.getState(),
  };
}
