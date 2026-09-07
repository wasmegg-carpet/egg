/**
 * Generic single-action apply-and-decorate helpers, shared across shift files.
 *
 * Every purchase/toggle/shift action in every shift file follows the same sequence:
 * `applyAction` → `computeSnapshot` → set `endState`/`totalTimeSeconds`/`bankDelta` → (caller
 * pushes to its own `actions` array). `applyDecoratedAction` is that sequence, extracted once.
 * `applyShiftAction` is the "shift to egg X" version built on top of it.
 */

import type { Action, VirtueEgg } from '@/types';
import { createSimAction } from '@/types/actions/meta';
import { shiftCost } from 'lib';
import type { EngineState, SimulationContext } from '../../types';
import { computeSnapshot } from '../../../engine/compute';
import { applyAction } from '../../../engine/apply';
import { isResearchSaleActive } from '@/lib/events';

/**
 * Apply `action` to `state`, then decorate it with `endState`/`totalTimeSeconds`/`bankDelta` the
 * same way every shift file's purchase helpers already do. `action` is mutated in place (matching
 * the existing convention of decorating a `createSimAction` result before pushing it) and also
 * returned for convenience.
 *
 * `bankDelta` defaults to 0 — correct for actions that don't move `bankValue` directly (shifts,
 * artifact-set swaps); purchase call sites should pass `-price`.
 */
export function applyDecoratedAction(
  state: EngineState,
  context: SimulationContext,
  action: Action,
  bankDelta: number = 0
): { state: EngineState; action: Action } {
  const newState = applyAction(state, action);
  action.endState = computeSnapshot(newState, context, { skipGrowth: true });
  action.totalTimeSeconds = 0;
  action.bankDelta = bankDelta;
  return { state: newState, action };
}

/**
 * Shift to `toEgg`, decorated the same way every shift file's own copy of this block already
 * does. Shifting is instantaneous and spends soul eggs, not bank value, so it doesn't advance
 * `elapsedSeconds` and uses `applyDecoratedAction`'s default `bankDelta` of 0.
 *
 * When `toEgg` is Curiosity, also syncs `activeSales.research` to calendar truth at the shift
 * instant and returns the sync as a second, optional `saleToggleAction` — most commonly turning the
 * sale ON when the shift lands mid-sale (the case a player would see happen automatically in the
 * real game), but it's a full sync either direction, matching `advanceTimeWithBoundaries`'s own
 * `isResearchSaleActive` check (`helpers/advanceTime.ts`) rather than a one-way "only ever turn on"
 * special case. That existing check only runs when TIME actually advances, though — shifting itself
 * never does (see the paragraph above), so a shift landing exactly on an already-active sale would
 * otherwise carry over whatever `activeSales.research` was before the shift (normally `false`, off
 * from a non-Curiosity phase) and silently under-price every purchase made immediately after,
 * exactly the gap this closes. Every caller shifting to a NON-Curiosity egg gets `saleToggleAction:
 * undefined` and can ignore it entirely — there's no research-sale concept to sync for those.
 */
export function applyShiftAction(
  state: EngineState,
  context: SimulationContext,
  toEgg: VirtueEgg
): { state: EngineState; action: Action; saleToggleAction?: Action } {
  const cost = shiftCost(state.soulEggs, state.shiftCount);
  const action = createSimAction(
    'shift',
    {
      fromEgg: state.currentEgg,
      toEgg,
      newShiftCount: state.shiftCount + 1,
    },
    cost
  );
  const shifted = applyDecoratedAction(state, context, action);

  let saleToggleAction: Action | undefined;
  if (toEgg === 'curiosity') {
    // `state.lastStepTime` (BEFORE the shift, but shifting never changes it — see
    // `applyDecoratedAction`, which only touches `endState`/`totalTimeSeconds`/`bankDelta`) is the
    // shift's own instant in the plan's timeline; same "subtract `planStartOffset`" conversion used
    // everywhere else this exact formula appears (e.g. c3.ts's `baseAbsTime`).
    const absoluteSimTime = context.ascensionStartTime + ((state.lastStepTime || 0) - context.planStartOffset);
    const isSaleNow = isResearchSaleActive(absoluteSimTime);
    if (shifted.state.activeSales?.research !== isSaleNow) {
      const toggleAction = createSimAction('toggle_sale', {
        saleType: 'research',
        active: isSaleNow,
        multiplier: 0.3,
      });
      const toggled = applyDecoratedAction(shifted.state, context, toggleAction);
      shifted.state = toggled.state;
      saleToggleAction = toggled.action;
    }
  }

  return { state: shifted.state, action: shifted.action, saleToggleAction };
}
