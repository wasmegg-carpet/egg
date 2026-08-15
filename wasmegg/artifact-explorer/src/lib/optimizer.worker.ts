// Worker entry point for the mission-plan search. Imports `optimizeFull` directly rather than the lib
// barrel, which re-exports the ~18MB loot dataset this bundle has no use for.

import { optimizeFull } from './optimizer-core';
import {
  optionsFromWire,
  solutionsToWire,
  type OptimizerRequest,
  type OptimizerResponse,
} from './optimizer-worker-protocol';

const ctx = self as unknown as Worker;

// Ids only ever increase, so anything below the newest one seen has already
// been superseded on the main thread. A solve is about a second and the UI
// posts one per input change.
//
// The reply still goes out. `optimizer-client` settles every id it has pending
// and resolves a superseded one to null, so dropping the message rather than
// answering it would leave that promise hanging forever.
let newestId = 0;

// Hands control back to the event loop for one macrotask, so `message` events already queued are dispatched
// — and their handlers have raised `newestId` — before we decide whether this request is stale.
// Load-bearing: the solve runs synchronously, so without it `req.id < newestId` is never true for any request.
//
// A microtask yield is not enough: microtasks drain without returning to the task queue, so no `message`
// event is delivered. It has to be a macrotask.
const yieldToPendingMessages = () => new Promise<void>(resolve => setTimeout(resolve, 0));

ctx.onmessage = async (e: MessageEvent<OptimizerRequest>) => {
  const req = e.data;
  if (req.id > newestId) newestId = req.id;
  let response: OptimizerResponse;
  try {
    await yieldToPendingMessages();
    if (req.id < newestId) {
      ctx.postMessage({ id: req.id, ok: true, solutions: [] } satisfies OptimizerResponse);
      return;
    }
    const solution = await optimizeFull({
      options: optionsFromWire(req.options),
      recipeDag: req.recipeDag,
      desiredArtifactNodeIds: req.desiredArtifactNodeIds,
      fuelCapacity: req.fuelCapacity,
      timeCapacityPerSlot: req.timeCapacityPerSlot,
      baseYield: req.baseYield,
      maximumCost: req.maximumCost,
    });
    response = { id: req.id, ok: true, solutions: solutionsToWire([solution]) };
  } catch (err) {
    // Without this a failed solve never resolves and the UI spins forever.
    response = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  ctx.postMessage(response);
};
