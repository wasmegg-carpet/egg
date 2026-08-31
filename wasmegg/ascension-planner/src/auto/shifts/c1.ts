import type { Action } from '@/types/actions/meta';
import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { isTierUnlocked, getTiers, getResearchById } from '../../calculations/commonResearch';
import { rankResearchByROI, buyWhilePassingCheck } from '../../calculations/researchRanking';
import {
  runBuyResearchLevelByLevel,
  runTierUnlockMilestone,
  runSmartBuyForSeconds,
  createMilestoneShiftHelpers,
} from './helpers/milestones';
import { computeSnapshot } from '../../engine/compute';
import { isResearchSaleActive, getNextSaleEnd } from '@/lib/events';

const FLEET_RESEARCH_IDS = [
  'vehicle_reliablity',
  'excoskeletons',
  'traffic_management',
  'egg_loading_bots',
  'autonomous_vehicles',
];
const GRAVITON_COUPLING_ID = 'micro_coupling';

/**
 * C1 Shift Strategy:
 * 1. Climb tier-by-tier up to the highest tier any fleet_size research needs (currently Tier 10,
 *    for autonomous_vehicles), running a 3-second smart-buy sweep before each tier-unlock attempt.
 *    This is what catches a big/expensive earnings research a tier unlock exposes as soon as it's
 *    available, rather than leaving it stranded until step 5's closing ROI sweep — which might
 *    never run at all if the time budget is spent by then. `unlockTierIfNeeded` no-ops for tiers
 *    already unlocked, so this is safe to run unconditionally even mid-ascension.
 * 2. One more smart-buy sweep once every fleet_size tier is unlocked.
 * 3. Buy each of FLEET_RESEARCH_IDS to max, one level at a time (`runBuyResearchLevelByLevel`),
 *    strictly in order — no sweep interleaved here, since step 1 already swept every tier crossing
 *    below this point and nothing new unlocks mid-loop. Each level is only bought if its ENTIRE
 *    purchase chain fits within the remaining time budget — never a partial down payment toward a
 *    level that won't finish before the shift ends.
 * 4. If every fleet_size research got maxed, try to unlock Tier 12 and buy Graviton Coupling
 *    (micro_coupling — also fleet_size, just gated behind the most expensive tier), same
 *    level-by-level, finish-or-don't-start rule as step 3. A single level counts as success; if the
 *    attempt buys zero levels, it's rolled back in full (state/time/actions all restored to their
 *    pre-attempt checkpoint) so the time it would've burned goes to step 5 instead.
 * 5. Spend whatever time remains buying research in ROI order.
 */
export function runC1(
  startState: EngineState,
  context: SimulationContext,
  timeLimit: number = 1800,
  peakELR: number = 0
): ShiftResult {
  let currentState: EngineState = { ...startState, maxELR: peakELR };
  let elapsedSeconds = 0;
  const actions: Action[] = [];

  const remainingBudget = () => timeLimit - elapsedSeconds;

  // --- Helper: merge a milestone-helper's ShiftResult into this shift's running state ---
  const mergeMilestone = (result: ShiftResult) => {
    currentState = result.endState;
    elapsedSeconds += result.elapsedSeconds;
    actions.push(...result.actions);
  };

  const unlockTierIfNeeded = (tier: number) => {
    if (isTierUnlocked(currentState.researchLevels, tier)) return;
    mergeMilestone(runTierUnlockMilestone(currentState, context, tier, remainingBudget()));
  };

  // One level at a time, each level only if its ENTIRE purchase chain fits within the remaining
  // time budget — see `runBuyResearchLevelByLevel`'s own comment for why. Shared with C2's identical
  // graviton-coupling need.
  const buyResearchToMax = (researchId: string) => {
    mergeMilestone(runBuyResearchLevelByLevel(currentState, context, researchId, remainingBudget()));
  };

  const smartBuySweep = () => {
    mergeMilestone(runSmartBuyForSeconds(currentState, context, 3, remainingBudget()));
  };

  // 1-2. Climb tier-by-tier (with a quick-buy sweep before each unlock attempt) up to the highest
  // tier any fleet_size research needs, then one final sweep once it's reached.
  const fleetTier = FLEET_RESEARCH_IDS.reduce((maxTier, id) => {
    const research = getResearchById(id);
    return research ? Math.max(maxTier, research.tier) : maxTier;
  }, 1);

  for (const tier of getTiers().filter(t => t > 1 && t <= fleetTier)) {
    if (remainingBudget() <= 0) break;
    smartBuySweep();
    if (remainingBudget() <= 0) break;
    unlockTierIfNeeded(tier);
  }
  smartBuySweep();

  // 3. Buy each fleet_size research to max, strictly in FLEET_RESEARCH_IDS order.
  for (const id of FLEET_RESEARCH_IDS) {
    if (remainingBudget() <= 0) break;
    buyResearchToMax(id);
  }

  // 4. Graviton coupling, only once every fleet research is maxed.
  const allFleetMaxed = FLEET_RESEARCH_IDS.every(id => {
    const research = getResearchById(id);
    return !research || (currentState.researchLevels[id] || 0) >= research.levels;
  });

  if (allFleetMaxed) {
    const gravitonResearch = getResearchById(GRAVITON_COUPLING_ID);
    if (gravitonResearch) {
      // Checkpoint so a failed attempt (zero levels bought) can be discarded in full, leaving the
      // time it would've burned for step 5 instead.
      const checkpointState = currentState;
      const checkpointElapsedSeconds = elapsedSeconds;
      const checkpointActionsLength = actions.length;
      const gravitonLevelBefore = currentState.researchLevels[GRAVITON_COUPLING_ID] || 0;

      unlockTierIfNeeded(gravitonResearch.tier);
      if (isTierUnlocked(currentState.researchLevels, gravitonResearch.tier)) {
        buyResearchToMax(GRAVITON_COUPLING_ID);
      }

      const gravitonLevelAfter = currentState.researchLevels[GRAVITON_COUPLING_ID] || 0;
      if (gravitonLevelAfter <= gravitonLevelBefore) {
        currentState = checkpointState;
        elapsedSeconds = checkpointElapsedSeconds;
        actions.length = checkpointActionsLength;
      }
    }
  }

  // 5. Spend whatever time remains buying research in ROI order, re-ranking after each purchase
  // since buying one thing changes the ROI math for everything else. Stops the moment a purchase
  // fails — whether from running out of time budget or nothing being worth buying. Deliberately buys
  // in plain ROI order with no sale-warning/deadline filter — unlike the sale-aware plans C3 uses
  // (`simulateSaleAwareBuy`/`simulateSaleEndsBuy`), which target a specific sale boundary, this sweep
  // just wants the best ROI use of whatever time is left. Only the ranking/check callback below is
  // C1-specific — the purchase mechanics themselves come from `createMilestoneShiftHelpers`, the same
  // factory `runBuyResearchLevelByLevel`/`runTierUnlockMilestone`/`runSmartBuyForSeconds` build on
  // above, rather than a local reimplementation.
  const roiSweepBudget = remainingBudget();
  const roiHelpers = createMilestoneShiftHelpers(currentState, context);

  buyWhilePassingCheck(
    () => {
      const state = roiHelpers.getState();
      const snapshot = computeSnapshot(state, context, { skipGrowth: true });
      const absTime = roiHelpers.getAbsTime();
      const isSale = isResearchSaleActive(absTime);
      const ranked = rankResearchByROI(
        state.researchLevels,
        snapshot,
        context,
        roiHelpers.getModifiers(),
        isSale,
        absTime,
        getNextSaleEnd(absTime),
        'immediate',
        false
      );
      const next = ranked.find(item => item.canBuy);
      return next ? { researchId: next.research.id } : undefined;
    },
    researchId => roiHelpers.buyResearch(researchId, roiSweepBudget)
  );

  mergeMilestone({
    actions: roiHelpers.getActions(),
    elapsedSeconds: roiHelpers.getElapsedSeconds(),
    endState: roiHelpers.getState(),
  });

  return {
    actions,
    elapsedSeconds,
    endState: currentState,
  };
}
