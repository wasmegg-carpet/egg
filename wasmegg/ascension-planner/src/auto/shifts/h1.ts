import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { getOptimalELRSet } from '@/lib/artifacts/virtue';
import { createSimAction } from '@/types/actions/meta';
import { applyShiftAction, applyDecoratedAction } from './helpers/actionHelpers';

/**
 * H1: Shift to Humility and switch to optimal ELR artifacts.
 */
export function runH1(state: EngineState, context: SimulationContext): ShiftResult {
  const backup = context.rawBackup;
  if (!backup) {
    return {
      actions: [],
      elapsedSeconds: 0,
      endState: state,
    };
  }

  // Compute optimal ELR set based on current state
  const optimalSet = getOptimalELRSet(backup, {
    commonResearch: state.researchLevels,
    epicResearchLevels: context.epicResearchLevels,
    colleggtibleModifiers: context.colleggtibleModifiers,
    assumeMaxHabsVehicles: true, // H1 is near the end, we likely have CU and max vehicles
  });

  // 1. Shift to Humility
  const shifted = applyShiftAction(state, context, 'humility');

  // 2. Update ELR Set
  const updated = applyDecoratedAction(
    shifted.state,
    context,
    createSimAction('update_artifact_set', { setName: 'elr', newLoadout: optimalSet })
  );

  // 3. Equip ELR Set
  const equipped = applyDecoratedAction(
    updated.state,
    context,
    createSimAction('equip_artifact_set', { setName: 'elr' })
  );

  return {
    actions: [shifted.action, updated.action, equipped.action],
    elapsedSeconds: 0, // Shifting and swapping artifacts are both instantaneous
    endState: equipped.state,
  };
}
