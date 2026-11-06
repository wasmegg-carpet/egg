/**
 * Web Worker for the Table Builder's table build: runs one table cell (or the table's K3 record) per
 * request, with the same `runTask`/`k3Record` scripts/buildTable.ts's worker processes run. The
 * pool and scheduling live in lib/chainFinder/tableBuild.ts.
 */
import { maxedContext } from '@/buildTable/maxedAccount';
import { k3Record, runTask } from '@/buildTable/task';
import type { SimulationContext } from '@/auto/types';
import type { ChainFinderWorkerRequest, ChainFinderWorkerResponse } from './chainFinderTable.protocol';

// `Worker`, not `DedicatedWorkerGlobalScope`: see researchCalc.worker.ts (dom and webworker libs clash).
const ctx = self as unknown as Worker;

// A build sends one delivery set (and silo mode) many times: build its context once.
let cached: { key: string; context: SimulationContext } | null = null;
function contextFor(deliveryIds: string[], deferForEarnings: boolean): SimulationContext {
  const key = `${deliveryIds.join(',')}|${deferForEarnings}`;
  if (cached?.key !== key) cached = { key, context: maxedContext(deliveryIds, deferForEarnings) };
  return cached.context;
}

function post(message: ChainFinderWorkerResponse): void {
  ctx.postMessage(message);
}

ctx.onmessage = (event: MessageEvent<ChainFinderWorkerRequest>) => {
  const msg = event.data;
  try {
    const context = contextFor(msg.deliveryIds, msg.deferForEarnings);
    if (msg.kind === 'cell') post({ type: 'cell', requestId: msg.requestId, result: runTask(msg.task, context) });
    else post({ type: 'k3', requestId: msg.requestId, result: k3Record(context) });
  } catch (err) {
    post({ type: 'error', requestId: msg.requestId, message: err instanceof Error ? err.message : String(err) });
  }
};
