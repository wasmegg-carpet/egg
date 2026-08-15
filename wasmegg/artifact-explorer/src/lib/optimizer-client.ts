// Main-thread client for the optimizer worker. See OPTIMIZER.md.

import {
  optionsToWire,
  solutionsFromWire,
  type OptimizerRequest,
  type OptimizerResponse,
} from './optimizer-worker-protocol';
import type { CraftBudget, LaunchOption, OptimizerSolution, RecipeDAG } from './types';

export interface OptimizerRequestInput {
  options: LaunchOption[];
  recipeDag: RecipeDAG;
  desiredArtifactNodeIds: string[];
  fuelCapacity: number;
  timeCapacityPerSlot: number;
  maximumCost: number | undefined;
  baseYield: Map<string, number>;
  craftBudget?: CraftBudget;
}

export interface OptimizerClient {
  // Resolves with null if a newer request superseded this one, or if the
  // client was terminated: "no result is coming, leave state alone".
  run(input: OptimizerRequestInput): Promise<OptimizerSolution[] | null>;
  terminate(): void;
}

export function createOptimizerClient(): OptimizerClient {
  let nextId = 1;
  let latestId = 0;
  const pending = new Map<number, { resolve(v: OptimizerSolution[] | null): void; reject(e: Error): void }>();

  // Request ids keep counting across workers, so a reply can never be mistaken
  // for one destined to a different generation of the same client.
  let worker: Worker | null = null;
  let terminated = false;

  function spawn(): Worker {
    const w = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<OptimizerResponse>) => {
      // A discarded worker can still have a queued message; it must not settle
      // a request belonging to its replacement.
      if (w !== worker) return;
      const res = e.data;
      const entry = pending.get(res.id);
      if (!entry) return;
      pending.delete(res.id);
      if (res.id !== latestId) {
        entry.resolve(null); // superseded
        return;
      }
      if (res.ok) entry.resolve(solutionsFromWire(res.solutions));
      else entry.reject(new Error(res.error));
    };
    w.onerror = e => {
      if (w !== worker) return;
      // Drop the worker rather than reuse it: posting into a dead one is
      // silently ignored, which would strand every later request.
      const err = new Error(e.message || 'optimizer worker failed');
      worker = null;
      w.terminate();
      for (const [, entry] of pending) entry.reject(err);
      pending.clear();
    };
    return w;
  }

  return {
    run(input: OptimizerRequestInput): Promise<OptimizerSolution[] | null> {
      // No respawn after teardown: that would leak a worker past unmount.
      if (terminated) return Promise.resolve(null);
      const w = (worker ??= spawn());
      const id = nextId++;
      latestId = id;
      const request: OptimizerRequest = { ...input, id, options: optionsToWire(input.options) };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage(request);
      });
    },
    terminate() {
      terminated = true;
      worker?.terminate();
      worker = null;
      // Settle rather than drop: a cleared entry strands its awaiting frame.
      for (const [, entry] of pending) entry.resolve(null);
      pending.clear();
    },
  };
}
