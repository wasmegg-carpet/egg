import type { Action } from '@/types/actions/meta';
import { createSimAction } from '@/types/actions/meta';
import type { EngineState, SimulationContext, ShiftResult } from '../../types';
import { computeSnapshot } from '../../../engine/compute';
import { applyAction } from '../../../engine/apply';
import { advanceTimeFlat } from './advanceTime';
import { simulateHabPurchases, type HabMultipliers } from '../../../calculations/habPurchasePlan';
import { calculateTotalResearchMultipliers } from '../../../calculations/habCapacity';
import { calculateArtifactModifiers } from '../../../lib/artifacts';
import type { HabCostModifiers } from '../../../lib/habs';

/**
 * `simulateHabPurchases` plans against a snapshot up front (growth-aware — population ramps
 * toward hab capacity during each wait); this executes that plan step-by-step against a mutable
 * `EngineState`, using the flat-rate `advanceTimeFlat`.
 *
 * Hab sales aren't checked (`isSaleActive` is hardcoded `false` below) — a deliberate
 * simplification, not an oversight. Wire in a hab-sale calendar check here if that ever matters
 * for I1's timing.
 */
export function runHabPurchasePlan(
  startState: EngineState,
  context: SimulationContext,
  timeLimit: number
): ShiftResult {
  let currentState: EngineState = { ...startState };
  let elapsedSeconds = 0;
  const actions: Action[] = [];

  const mods: HabCostModifiers = {
    cheaperContractorsLevel: context.epicResearchLevels['cheaper_contractors'] || 0,
    habCostMultiplier: context.colleggtibleModifiers.habCost || 1,
  };

  const { universal, portalOnly } = calculateTotalResearchMultipliers(currentState.researchLevels);
  const artifactMods = calculateArtifactModifiers(currentState.artifactLoadout);
  const multipliers: HabMultipliers = {
    universalMultiplier: universal,
    portalMultiplier: portalOnly,
    habCapMultiplier: context.colleggtibleModifiers.habCap || 1,
    artifactMultiplier: artifactMods.habCapacity.totalMultiplier,
  };

  const startSnapshot = computeSnapshot(currentState, context, { skipGrowth: true });
  const plan = simulateHabPurchases(
    startSnapshot,
    currentState.habIds,
    mods,
    false,
    multipliers,
    elapsed => elapsed > timeLimit
  );

  for (const step of plan.steps) {
    if (elapsedSeconds + step.waitSeconds > timeLimit) break;

    const advanced = advanceTimeFlat(currentState, actions, elapsedSeconds, context, step.waitSeconds);
    currentState = advanced.currentState;
    elapsedSeconds = advanced.elapsedSeconds;

    const action = createSimAction('buy_hab', { slotIndex: step.slotIndex, habId: step.habId }, step.cost);
    currentState = applyAction(currentState, action);

    const finalSnap = computeSnapshot(currentState, context, { skipGrowth: true });
    action.endState = finalSnap;
    action.totalTimeSeconds = 0;
    action.bankDelta = -step.cost;

    actions.push(action);
  }

  return {
    actions,
    elapsedSeconds,
    endState: currentState,
  };
}
