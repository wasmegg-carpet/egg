/**
 * Web Worker entry point for the four heavy research-plan simulations behind the Milestones and
 * Smart Buy views (milestone chain, 70% Return, Buy Until Sale Ends, Quick Buy). Each was a plain
 * synchronous call on the main thread — fine for a `computed`/`watchEffect`'s dependency tracking,
 * but a large one (near the 2000-simulated-purchase cap `calculations/*` enforces) can block the
 * main thread long enough to trip Chrome's "Page Unresponsive" hang detector. That detector only
 * watches the main thread's ability to respond, not a Web Worker's — a worker can peg its own
 * thread for as long as it needs without the tab ever being flagged as hung, which is the entire
 * reason this file exists.
 *
 * Thin dispatcher only: every request kind maps 1:1 to one of the pure functions
 * `calculations/milestoneChain.ts`/`calculations/smartBuyPreview.ts` already had — nothing here
 * re-implements or shortcuts them. Do NOT import `engine/adapter.ts`'s Pinia-bound helpers
 * (`getSimulationContext`, the no-snapshot fallback branch of `createBaseEngineState`) here — they
 * throw immediately outside a Pinia context, which a worker never has. Building `context`/
 * `startSnapshot` stays useResearchCalcWorker.ts's callers' job, on the main thread, exactly as
 * before; this worker only ever receives them already resolved, over `postMessage`. (This same
 * split — and the fact that `engine/compute.ts`/`engine/apply.ts`/`calculations/*` are themselves
 * Pinia-free and safe to import in a worker — was previously verified for the same modules by the
 * beam search feature's worker, removed in commit `ce0be3af` but still in git history as a working
 * reference: `src/workers/beamSearch.worker.ts`.)
 *
 * Loaded via Vite's native worker support — no bundler config needed:
 *   new Worker(new URL('./researchCalc.worker.ts', import.meta.url), { type: 'module' })
 */
import { computeTierMilestoneChain, computeResearchMilestoneChain } from '@/calculations/milestoneChain';
import { simulateSaleAwareBuy, simulateSaleEndsBuy, simulateThresholdBuy } from '@/calculations/smartBuyPreview';
import { createBaseEngineState } from '@/engine/adapter';
import { sanitizeLongs } from '@/lib/artifacts/utils';
import type { WorkerRequest, WorkerResponse } from './researchCalc.protocol';

// Typed as `Worker` — the DOM-lib interface describing a worker instance as seen from the *main*
// thread (postMessage/onmessage/onerror) — rather than the `webworker` lib's own
// `DedicatedWorkerGlobalScope`. Deliberate, same workaround the (now-removed) beam search worker
// used: tsconfig.json's `lib` array is `["esnext", "dom"]`, shared by the whole program (no
// per-file/per-folder tsconfig here), and TypeScript's `dom` and `webworker` libs declare
// conflicting globals (`self`, `postMessage`, ...) when both are in scope. `Worker`'s shape is close
// enough for everything this file needs, without touching the shared tsconfig or adding a second
// one just for this file.
const ctx = self as unknown as Worker;

function post(message: WorkerResponse): void {
  ctx.postMessage(message);
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  try {
    switch (msg.kind) {
      case 'milestoneChain': {
        const { target, startSnapshot, context, mods, absoluteSimTime, deadline } = msg;
        const result =
          target.kind === 'tier'
            ? computeTierMilestoneChain(target, startSnapshot, context, mods, absoluteSimTime, deadline)
            : computeResearchMilestoneChain(
                target,
                createBaseEngineState(startSnapshot),
                startSnapshot,
                context,
                mods,
                absoluteSimTime,
                deadline
              );
        post({ type: 'result', requestId: msg.requestId, result });
        break;
      }

      case 'saleAwareBuy': {
        const {
          researchLevels,
          startSnapshot,
          context,
          mods,
          absoluteSimTime,
          deadline,
          nextSaleStart,
          roiMode,
          deliveryImpactOnly,
          fullRoiDeadline,
        } = msg;
        // `roiDeadlineOverride` (the OLD single-gate mode) is always `undefined` here — this request
        // kind only ever backs the real Smart Buy UI flow, which always supplies `fullRoiDeadline`
        // (the NEW dual-gate mode); the OLD mode is only used internally by `milestoneChain.ts`'s
        // `sweepUntilNextSale`, a plain function call that never goes through this worker message.
        const result = simulateSaleAwareBuy(
          researchLevels,
          startSnapshot,
          context,
          mods,
          absoluteSimTime,
          deadline,
          nextSaleStart,
          roiMode,
          deliveryImpactOnly,
          undefined,
          fullRoiDeadline
        );
        post({ type: 'result', requestId: msg.requestId, result });
        break;
      }

      case 'saleEndsBuy': {
        const {
          researchLevels,
          startSnapshot,
          context,
          mods,
          absoluteSimTime,
          deadline,
          elrViewMode,
          elrSortMode,
          rawBackup,
        } = msg;
        // Defense-in-depth against the postMessage/structuredClone boundary this message itself
        // just crossed: protobufjs Long-typed int64 fields on `rawBackup` (e.g. artifact item ids,
        // read by the realistic-ELR sort this feeds) silently lose their `Long` prototype through
        // structuredClone, becoming plain `{low,high,unsigned}` objects with none of Long's methods.
        // `sanitizeLongs`'s duck-typed check works identically whether it's handed a live Long or
        // that already-stripped equivalent, so this is correct regardless of whether the caller
        // (useResearchCalcWorker.ts) also happens to sanitize before sending.
        const sanitizedBackup = rawBackup ? sanitizeLongs(rawBackup) : rawBackup;
        const result = simulateSaleEndsBuy(
          researchLevels,
          startSnapshot,
          context,
          mods,
          absoluteSimTime,
          deadline,
          elrViewMode,
          elrSortMode,
          sanitizedBackup
        );
        post({ type: 'result', requestId: msg.requestId, result });
        break;
      }

      case 'thresholdBuy': {
        const { researchLevels, startSnapshot, context, mods, isSale, thresholdSeconds } = msg;
        const result = simulateThresholdBuy(researchLevels, startSnapshot, context, mods, isSale, thresholdSeconds);
        post({ type: 'result', requestId: msg.requestId, result });
        break;
      }
    }
  } catch (err) {
    post({ type: 'error', requestId: msg.requestId, message: err instanceof Error ? err.message : String(err) });
  }
};
