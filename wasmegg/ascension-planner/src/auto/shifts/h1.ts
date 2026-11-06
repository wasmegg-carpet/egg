import type { EngineState, SimulationContext, ShiftResult } from '../types';
import { getOptimalELRSetFromSource } from '@/lib/artifacts/virtue';
import { createSimAction } from '@/types/actions/meta';
import { applyShiftAction, applyDecoratedAction } from './helpers/actionHelpers';
import { contextDeliverySource } from '../loadout/resolve';

/**
 * H1: Shift to Humility and switch to optimal ELR artifacts.
 *
 * The delivery set comes from `context.loadoutInputs` when set (the auto planner's artifact/stone
 * inputs: `auto` mode searches its candidates, `fixed` mode keeps the user's artifacts — stones are
 * placed from the pool either way), else from the backup's inventory.
 */
export function runH1(state: EngineState, context: SimulationContext): ShiftResult {
  const source = contextDeliverySource(context);
  if (!source) {
    return {
      actions: [],
      elapsedSeconds: 0,
      endState: state,
    };
  }

  // Compute optimal ELR set based on current state
  const optimalSet = getOptimalELRSetFromSource(source, {
    commonResearch: state.researchLevels,
    epicResearchLevels: context.epicResearchLevels,
    colleggtibleModifiers: context.colleggtibleModifiers,
    proPermit: state.proPermit,
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
