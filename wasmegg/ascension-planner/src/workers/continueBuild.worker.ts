/**
 * Web Worker for Chain Finder: simulates the rest of a part-done build in the ascension in progress
 * (lib/instantSearch/currentAscension.ts `simulateContinueBuilds`), which can take from seconds to a
 * minute on a slow farm, so the page stays responsive while it runs.
 */
import { simulateContinueBuilds, type ContinueBuildInput } from '@/lib/instantSearch/continueBuilds';
import type { BuildParams } from '@/lib/instantSearch/precomputedLeg';

export interface ContinueBuildRequest {
  requestId: number;
  input: ContinueBuildInput;
}

export type ContinueBuildResponse =
  | { type: 'builds'; requestId: number; builds: BuildParams[] }
  | { type: 'error'; requestId: number; message: string };

// `Worker`, not `DedicatedWorkerGlobalScope`: see researchCalc.worker.ts (dom and webworker libs clash).
const ctx = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent<ContinueBuildRequest>) => {
  const { requestId, input } = event.data;
  try {
    ctx.postMessage({ type: 'builds', requestId, builds: simulateContinueBuilds(input) } satisfies ContinueBuildResponse);
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      requestId,
      message: err instanceof Error ? err.message : String(err),
    } satisfies ContinueBuildResponse);
  }
};
