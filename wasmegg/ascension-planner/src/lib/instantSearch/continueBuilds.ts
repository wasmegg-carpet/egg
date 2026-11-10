/**
 * Continuing an ascension part-way through its build, for Chain Finder: the rest of the build from the
 * start of its step (auto/continueBuild.ts), up to K3's wait, as table builds the route search prices.
 * Pinia-free, so workers/continueBuild.worker.ts can run it.
 */
import { continueBuildPrefix } from '@/auto/continueBuild';
import { runC3Variants } from '@/auto/shifts/c3';
import { paramsOf } from '@/buildTable/cell';
import type { BuildStep } from '@/auto/buildStep';
import type { EngineState, SimulationContext } from '@/auto/types';
import type { BuildParams } from './precomputedLeg';

/** The farm part-way through its build, as `simulateContinueBuilds` takes it: plain data, so it can
 *  be posted to a worker. */
export interface ContinueBuildInput {
  step: BuildStep;
  /** The farm at `context.ascensionStartTime`, the catch-up's eggs counted. */
  state: EngineState;
  context: SimulationContext;
  skipTier13Attempts: boolean;
}

/** Continuing a part-done build, as builds the route search can price (`FindOptions.contBuilds`): the
 *  rest of the build from the start of its step, one per C3 variant still possible. */
export function simulateContinueBuilds(input: ContinueBuildInput): BuildParams[] {
  const prefix = continueBuildPrefix(input.state, input.context, input.step);
  return runC3Variants(prefix.state, input.context, 3, input.skipTier13Attempts)
    .filter(v => !v.impossible)
    .map(v => paramsOf(prefix, v, input.context));
}
