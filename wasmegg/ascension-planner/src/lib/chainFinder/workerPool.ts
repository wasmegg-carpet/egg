/**
 * A fixed pool of chainFinderTable.worker.ts Web Workers fed from one FIFO queue, the browser
 * counterpart of scripts/buildTable.ts's forked processes.
 *
 * Callbacks, not promises: a finished seed must queue its hours before the worker that ran it asks
 * for more work, or `onDrain` would start the next start TE early. A callback runs synchronously
 * in the message handler, ahead of that request; a promise continuation would run after it.
 *
 * `resize` changes the worker count mid-build. A worker dropped while busy finishes its task first,
 * so no work is lost or redone.
 */
import type { K3Record, Task, TaskResult } from '@/buildTable/task';
import type { ChainFinderWorkerRequest, ChainFinderWorkerResponse } from '@/workers/chainFinderTable.protocol';

type Request = { kind: 'cell'; task: Omit<Task, 'id'> } | { kind: 'k3' };
type Handler = (response: ChainFinderWorkerResponse) => void;

interface Slot {
  worker: Worker;
  busy: boolean;
  /** Dropped by `resize`: terminates when its current task finishes instead of taking another. */
  retiring: boolean;
}

export class ChainFinderWorkerPool {
  /** Called when the queue is empty and a worker is about to go idle; may submit more work. */
  onDrain: (() => void) | null = null;
  /** A worker failed to load or a request threw. The pool is terminated first. */
  onError: ((err: Error) => void) | null = null;

  private slots: Slot[];
  private readonly queue: { message: ChainFinderWorkerRequest; handler: Handler }[] = [];
  private readonly handlers = new Map<number, Handler>();
  private nextRequestId = 0;
  private terminated = false;

  constructor(
    size: number,
    private readonly deliveryIds: string[],
    private readonly deferForEarnings: boolean
  ) {
    this.slots = Array.from({ length: Math.max(1, size) }, () => this.spawn());
  }

  /** Workers that will take more work (not counting ones finishing their last task before retiring). */
  get size(): number {
    return this.slots.filter(s => !s.retiring).length;
  }

  get busyCount(): number {
    return this.slots.filter(s => s.busy).length;
  }

  cell(task: Omit<Task, 'id'>, onResult: (result: TaskResult) => void): void {
    this.submit({ kind: 'cell', task }, r => r.type === 'cell' && onResult(r.result));
  }

  k3(onResult: (result: K3Record) => void): void {
    this.submit({ kind: 'k3' }, r => r.type === 'k3' && onResult(r.result));
  }

  /** Hand every idle worker work (after the first submissions, or to begin with `onDrain`). */
  start(): void {
    for (const slot of this.slots) if (!slot.busy && !slot.retiring) this.feed(slot);
  }

  /**
   * Grow or shrink to `size` workers. New workers start on queued work right away. When shrinking,
   * idle workers go first; busy ones retire after their current task. Retiring workers are taken back
   * before any new ones are spawned.
   */
  resize(size: number): void {
    if (this.terminated) return;
    const target = Math.max(1, Math.floor(size));
    let active = this.slots.filter(s => !s.retiring);
    if (target < active.length) {
      // Idle first, so busy workers keep their tasks.
      const drop = [...active].sort((a, b) => Number(a.busy) - Number(b.busy)).slice(0, active.length - target);
      for (const slot of drop) {
        slot.retiring = true;
        if (!slot.busy) this.retire(slot);
      }
      return;
    }
    for (const slot of this.slots) {
      if (active.length >= target) break;
      if (slot.retiring) {
        slot.retiring = false;
        active = [...active, slot];
      }
    }
    while (active.length < target) {
      const slot = this.spawn();
      this.slots.push(slot);
      active = [...active, slot];
      this.feed(slot);
    }
  }

  terminate(): void {
    this.terminated = true;
    for (const slot of this.slots) {
      slot.worker.terminate();
      slot.busy = false;
    }
    this.queue.length = 0;
    this.handlers.clear();
  }

  private spawn(): Slot {
    const worker = new Worker(new URL('../../workers/chainFinderTable.worker.ts', import.meta.url), {
      type: 'module',
    });
    const slot: Slot = { worker, busy: false, retiring: false };
    worker.onmessage = (event: MessageEvent<ChainFinderWorkerResponse>) => this.receive(slot, event.data);
    worker.onerror = (event: ErrorEvent) => this.fail(new Error(event.message || 'Table Builder worker failed'));
    return slot;
  }

  private retire(slot: Slot): void {
    slot.worker.terminate();
    slot.busy = false;
    this.slots = this.slots.filter(s => s !== slot);
  }

  private submit(request: Request, handler: Handler): void {
    if (this.terminated) return;
    const requestId = ++this.nextRequestId;
    const { deliveryIds, deferForEarnings } = this;
    const message: ChainFinderWorkerRequest =
      request.kind === 'cell'
        ? { kind: 'cell', requestId, deliveryIds, deferForEarnings, task: { ...request.task, id: requestId } }
        : { kind: 'k3', requestId, deliveryIds, deferForEarnings };
    this.queue.push({ message, handler });
    const idle = this.slots.find(s => !s.busy && !s.retiring);
    if (idle) this.feed(idle);
  }

  private feed(slot: Slot): void {
    // Busy while it looks for work, so work submitted from onDrain goes to the other idle workers.
    slot.busy = true;
    if (!this.queue.length) this.onDrain?.();
    const next = this.queue.shift();
    if (!next || this.terminated) {
      slot.busy = false;
      return;
    }
    this.handlers.set(next.message.requestId, next.handler);
    slot.worker.postMessage(next.message);
  }

  private receive(slot: Slot, response: ChainFinderWorkerResponse): void {
    if (this.terminated) return;
    if (response.type === 'error') return this.fail(new Error(response.message));
    const handler = this.handlers.get(response.requestId);
    this.handlers.delete(response.requestId);
    handler?.(response);
    if (this.terminated) return;
    if (slot.retiring) this.retire(slot);
    else this.feed(slot);
  }

  private fail(err: Error): void {
    if (this.terminated) return;
    this.terminate();
    this.onError?.(err);
  }
}
