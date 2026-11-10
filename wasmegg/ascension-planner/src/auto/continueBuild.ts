/**
 * Continue for a farm part-way through its build: the rest of an auto planner ascension, from the
 * very beginning of the build step the farm is on (`detectBuildStep`), on the farm as it is.
 */
import { createSimAction, type Action } from '@/types/actions/meta';
import type { EngineState, SimulationContext, AscensionSummary } from './types';
import { runUntilShift, runAscensionFromC3Variant, startAscensionAction } from './ascension';
import { runC3Variants } from './shifts/c3';
import { applyDecoratedAction } from './shifts/helpers/actionHelpers';
import type { BuildStep } from './buildStep';

/**
 * The build from the start of `step` up to C3, from `startState` (a `makeContinueState` farm,
 * `lastStepTime` 0 at `context.ascensionStartTime`): what every C3 variant continues from.
 *
 * It opens by making the gear the player has on the earnings set and equipping it — mid-build, that
 * is what they farm with — in place of C1's own earnings set.
 */
export function continueBuildPrefix(
  startState: EngineState,
  context: SimulationContext,
  step: BuildStep
): { actions: Action[]; state: EngineState; elapsedSeconds: number } {
  let state: EngineState = JSON.parse(JSON.stringify(startState));
  const gearActions: Action[] = [];
  for (const action of [
    createSimAction('update_artifact_set', { setName: 'earnings', newLoadout: state.artifactLoadout }),
    createSimAction('equip_artifact_set', { setName: 'earnings' }),
  ]) {
    const applied = applyDecoratedAction(state, context, action);
    state = applied.state;
    gearActions.push(applied.action);
  }

  const build =
    step === 'C3'
      ? { actions: [], state, elapsedSeconds: 0 }
      : runUntilShift(state, context, 'C3', { from: step, equipEarningsSet: false });
  return { actions: [...gearActions, ...build.actions], state: build.state, elapsedSeconds: build.elapsedSeconds };
}

/**
 * Plans the rest of the ascension from the start of `step`, from `startState` (a
 * `makeContinueState` farm, `lastStepTime` 0 at `startTime`): `continueBuildPrefix`, then every C3
 * variant (as the other build variants do), each finished through H2. The best one is returned,
 * picked as `pickVariant` picks among an ascension's variants: the shortest, or under a deadline
 * (`targetEndTime`, used only without `targetTE`) the most TE. Null when no variant can finish its
 * build phase before that deadline.
 */
export function runContinueBuild(
  startState: EngineState,
  context: SimulationContext,
  step: BuildStep,
  startTime: number,
  id: string,
  targetTE: number | undefined,
  targetEndTime: number | undefined,
  skipTier13Attempts: boolean
): { actions: Action[]; summary: AscensionSummary } | null {
  const preC3 = continueBuildPrefix(startState, context, step);

  const deadlineMode = !targetTE && targetEndTime !== undefined;
  const variants = runC3Variants(preC3.state, context, 3, skipTier13Attempts).filter(
    v => !v.impossible && (!deadlineMode || v.buildPhaseEnd <= targetEndTime!)
  );
  if (variants.length === 0) return null;

  const best = variants
    .map(v => runAscensionFromC3Variant(startState, preC3, v, context, startTime, id, targetTE, targetEndTime))
    .reduce((a, b) =>
      deadlineMode
        ? a.summary.endTE >= b.summary.endTE ? a : b
        : a.summary.totalDurationSeconds <= b.summary.totalDurationSeconds ? a : b
    );

  const actions = [startAscensionAction(startState, context, startTime, true), ...best.actions];
  actions.forEach((a, i) => {
    a.index = i;
  });
  return {
    actions,
    summary: {
      ...best.summary,
      strategyLabel: `Continue from ${step}, ${best.summary.strategyLabel}`,
      continueFromStep: step,
    },
  };
}
