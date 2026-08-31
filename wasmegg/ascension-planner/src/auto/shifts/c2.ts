import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { getResearchById, isTierUnlocked } from '../../calculations/commonResearch';
import { applyShiftAction } from './helpers/actionHelpers';
import { runTierUnlockMilestone, runBuyResearchLevelByLevel } from './helpers/milestones';

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
 * Steps 2-3 both go through `runBuyResearchLevelByLevel` — shared with C1 for the same reason — so
 * every milestone call, across both steps, shares one running 4-hour clock, matching this shift's
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

  return { actions, elapsedSeconds, endState: currentState };
}
