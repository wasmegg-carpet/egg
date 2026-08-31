/**
 * Owns a single Web Worker (researchCalc.worker.ts) running the four heavy research-plan
 * simulations behind the Milestones and Smart Buy views — milestone chain, 70% Return, Buy Until
 * Sale Ends, Quick Buy. Moving them off the main thread means a large one can no longer trip
 * Chrome's "Page Unresponsive" hang detector: that detector only watches the main thread's ability
 * to respond, and has no visibility into a worker's own thread, so a worker can run for as long as
 * it needs without the tab ever being flagged as hung — the entire reason this file exists, not the
 * total wall-clock time (the worker itself can still take just as long; see researchCalc.worker.ts).
 *
 * One shared worker instance, not one per computation kind: the four kinds never actually needed to
 * run concurrently with each other even before this (the main thread they used to share was itself
 * single-threaded), so multiplexing them onto one worker via `requestId`-tagged messages costs
 * nothing over spawning four and keeps worker startup/module-load overhead paid once, not four
 * times. useResearchViews.ts owns the one instance this composable returns; ResearchActions.vue's
 * own `quickBuyPlan` watchEffect gets `computeThresholdBuy` back out through that composable's
 * return value, rather than spawning a second worker of its own.
 *
 * No cancel/respawn machinery (unlike the old beam search worker this is modeled on, removed in
 * commit `ce0be3af` but still in git history as a working reference): nothing here needs early
 * termination of an in-flight computation — the generation-based staleness check each caller
 * (useResearchViews.ts's/ResearchActions.vue's watchEffects) already does covers "discard a result
 * that's no longer the latest one", and none of these four computations run indefinitely the way a
 * beam search could.
 *
 * Deliberately thin otherwise: this composable's only real job is request/response bookkeeping
 * (`pending`, matched by `requestId`) — building the plain, already-Pinia-resolved request payloads
 * is each caller's job (same data they already built for the old direct synchronous calls), and the
 * actual computation is researchCalc.worker.ts's.
 */
import { onUnmounted } from 'vue';
import { sanitizeLongs } from '@/lib/artifacts/utils';
import type { MilestoneChainResult } from '@/calculations/milestoneChain';
import type { SaleAwareBuyPlan, SaleEndsPlan, SimpleBuyPlan } from '@/calculations/smartBuyPreview';
import type {
  WorkerRequest,
  WorkerResponse,
  MilestoneChainRequest,
  SaleAwareBuyRequest,
  SaleEndsBuyRequest,
  ThresholdBuyRequest,
} from '@/workers/researchCalc.protocol';

interface PendingEntry {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

export function useResearchCalcWorker() {
  const worker = new Worker(new URL('../workers/researchCalc.worker.ts', import.meta.url), { type: 'module' });
  let nextRequestId = 0;
  const pending = new Map<number, PendingEntry>();

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    const entry = pending.get(msg.requestId);
    // No entry is expected and fine, not just tolerated: nothing on this side currently discards a
    // request early (every watchEffect awaits its own call to completion), but a stray/duplicate
    // message should never be able to throw here.
    if (!entry) return;
    pending.delete(msg.requestId);
    if (msg.type === 'error') {
      entry.reject(new Error(msg.message));
    } else {
      entry.resolve(msg.result);
    }
  };

  // A worker-level error (e.g. a syntax error in the worker bundle, not a caught exception inside
  // its message handler — those already come back as a normal `{type: 'error'}` response with a
  // requestId) has no requestId to route by. Reject everything still pending rather than leaving
  // every caller's `await` — and the spinner/disabled state riding on it — hanging forever.
  worker.onerror = (event: ErrorEvent) => {
    const err = new Error(event.message || 'Research calc worker error');
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
  };

  // Every field on a request (`researchLevels` off `commonResearchStore`, `context.epicResearchLevels`
  // off `initialStateStore`, `target` off a `ref()`, ...) can still be a Vue reactive Proxy at this
  // point, even though each caller only ever intends to hand over plain data — Pinia wraps its whole
  // state tree in `reactive()`, and `ref()` does the same for any object value. A reactive Proxy is
  // NOT guaranteed structured-clone-safe: confirmed the hard way, not hypothetically — an earlier
  // version of this function only stripped/sanitized `rawBackup` specifically, and `postMessage`
  // still threw `DataCloneError` on the *other* fields. `sanitizeLongs` already deep-rebuilds a value
  // into an equivalent plain, Proxy-free structure from scratch (see its own doc comment) — reused
  // here for exactly that, on top of its original Long-object job, applied to the whole message.
  //
  // `context.rawBackup` (set by `getSimulationContext()`, present on every request kind — it's part
  // of `SimulationContext`) is dropped outright rather than sanitized-and-sent: nothing any of the
  // four `calculations/*` functions this worker runs ever reads it (confirmed by grep across
  // `engine/`+`calculations/` — only ever *set*, never read), and it can easily be the single
  // largest thing in the payload (a full backup). `saleEndsBuy`'s own separate, explicit `rawBackup`
  // field *is* actually used (its realistic-ELR delivery sort), so that one goes through
  // `sanitizeLongs` along with everything else instead of being dropped.
  function prepareForPostMessage(message: WorkerRequest): WorkerRequest {
    return sanitizeLongs({ ...message, context: { ...message.context, rawBackup: undefined } });
  }

  function request<TResult>(message: WorkerRequest): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      pending.set(message.requestId, { resolve: result => resolve(result as TResult), reject });
      worker.postMessage(prepareForPostMessage(message));
    });
  }

  function computeMilestoneChain(
    args: Omit<MilestoneChainRequest, 'kind' | 'requestId'>
  ): Promise<MilestoneChainResult> {
    return request({ kind: 'milestoneChain', requestId: ++nextRequestId, ...args });
  }

  function computeSaleAwareBuy(args: Omit<SaleAwareBuyRequest, 'kind' | 'requestId'>): Promise<SaleAwareBuyPlan> {
    return request({ kind: 'saleAwareBuy', requestId: ++nextRequestId, ...args });
  }

  function computeSaleEndsBuy(args: Omit<SaleEndsBuyRequest, 'kind' | 'requestId'>): Promise<SaleEndsPlan> {
    return request({ kind: 'saleEndsBuy', requestId: ++nextRequestId, ...args });
  }

  function computeThresholdBuy(args: Omit<ThresholdBuyRequest, 'kind' | 'requestId'>): Promise<SimpleBuyPlan> {
    return request({ kind: 'thresholdBuy', requestId: ++nextRequestId, ...args });
  }

  // Tied to this composable instance, not to the live plan — leaving the tab (ResearchActions.vue,
  // the only caller, unmounting when the user switches off the Research tab entirely) tears the
  // worker down rather than leaving it around with nothing left to message it.
  onUnmounted(() => worker.terminate());

  return { computeMilestoneChain, computeSaleAwareBuy, computeSaleEndsBuy, computeThresholdBuy };
}
