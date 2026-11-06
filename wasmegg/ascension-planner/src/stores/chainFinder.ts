/**
 * Table Builder state: the delivery picks and the in-browser table build. Its own store, apart from
 * the manual and auto planners', so a build keeps running when the user switches tabs.
 */
import { defineStore } from 'pinia';
import { ref, shallowRef, watch } from 'vue';
import {
  chainFinderDeliveryIds,
  defaultDeliverySelection,
  deliverySelectionTag,
  type ChainFinderDeliverySelection,
} from '@/lib/chainFinder/deliveryArtifacts';
import {
  buildChainFinderTable,
  type TableBuildProgress,
  type TableBuildResult,
} from '@/lib/chainFinder/tableBuild';
import { holdWakeLock } from '@/lib/chainFinder/wakeLock';

/** Every start TE the CLI covers with `--to 489` (490 is the last target, not a start). */
export const CHAIN_FINDER_TE_FROM = 120;
export const CHAIN_FINDER_TE_TO = 489;
const CHAIN_FINDER_TES = Array.from(
  { length: CHAIN_FINDER_TE_TO - CHAIN_FINDER_TE_FROM + 1 },
  (_, i) => CHAIN_FINDER_TE_FROM + i
);

export type TableBuildStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

/** All cores but one, so the page stays responsive. */
export function defaultWorkerCount(): number {
  return Math.max(1, (navigator.hardwareConcurrency || 2) - 1);
}

export const useChainFinderStore = defineStore('chainFinder', () => {
  const deliverySelection = ref<ChainFinderDeliverySelection>(defaultDeliverySelection());
  const workerCount = ref(defaultWorkerCount());
  /** The auto-planner's silo mode (defer for earnings), turned on by typing "g" in the workers input. */
  const siloMode = ref(false);
  const status = ref<TableBuildStatus>('idle');
  const progress = shallowRef<TableBuildProgress | null>(null);
  const result = shallowRef<(TableBuildResult & { fileName: string }) | null>(null);
  const error = ref('');
  /** Whether the screen wake lock is held (false if the browser lacks or refused it). */
  const keepingAwake = ref(false);
  let controller: AbortController | null = null;
  let setWorkers: ((workers: number) => void) | null = null;

  // The workers input can change mid-build; an empty or partial entry is ignored until it's a count.
  watch(workerCount, n => {
    if (Number.isInteger(n) && n >= 1) setWorkers?.(n);
  });

  async function startBuild() {
    if (status.value === 'running') return;
    const selection = { ...deliverySelection.value };
    const silo = siloMode.value;
    controller = new AbortController();
    status.value = 'running';
    progress.value = null;
    result.value = null;
    error.value = '';
    const releaseWakeLock = holdWakeLock(held => (keepingAwake.value = held));
    try {
      const built = await buildChainFinderTable({
        deliveryIds: chainFinderDeliveryIds(selection),
        deferForEarnings: silo,
        tes: CHAIN_FINDER_TES,
        workers: workerCount.value,
        onResizable: fn => (setWorkers = fn),
        onProgress: p => (progress.value = p),
        signal: controller.signal,
      });
      const tag = `${deliverySelectionTag(selection)}${silo ? '-silo' : ''}`;
      result.value = { ...built, fileName: `table-${tag}-te${built.from}-${built.to}.bin.gz` };
      status.value = 'done';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        status.value = 'cancelled';
      } else {
        status.value = 'error';
        error.value = err instanceof Error ? err.message : String(err);
        console.error('Table Builder table build failed:', err);
      }
    } finally {
      controller = null;
      setWorkers = null;
      releaseWakeLock();
    }
  }

  function cancelBuild() {
    controller?.abort();
  }

  function downloadResult() {
    if (!result.value) return;
    const url = URL.createObjectURL(new Blob([result.value.gzipped], { type: 'application/gzip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = result.value.fileName;
    a.click();
    // Let the download start before the URL goes away.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    deliverySelection,
    workerCount,
    siloMode,
    status,
    progress,
    result,
    error,
    keepingAwake,
    startBuild,
    cancelBuild,
    downloadResult,
  };
});
