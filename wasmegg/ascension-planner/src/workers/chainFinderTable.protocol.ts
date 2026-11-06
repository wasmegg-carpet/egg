/**
 * Messages between the Table Builder's table build (lib/chainFinder/tableBuild.ts) and its Web
 * Workers (chainFinderTable.worker.ts). Every request carries the delivery set, not a context: the
 * worker builds the context itself, so nothing reactive or Pinia-bound crosses the boundary.
 */
import type { K3Record, Task, TaskResult } from '@/buildTable/task';

export type ChainFinderWorkerRequest =
  | { kind: 'cell'; requestId: number; deliveryIds: string[]; deferForEarnings: boolean; task: Task }
  | { kind: 'k3'; requestId: number; deliveryIds: string[]; deferForEarnings: boolean };

export type ChainFinderWorkerResponse =
  | { type: 'cell'; requestId: number; result: TaskResult }
  | { type: 'k3'; requestId: number; result: K3Record }
  | { type: 'error'; requestId: number; message: string };
