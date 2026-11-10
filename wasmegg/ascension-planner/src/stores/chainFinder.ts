/**
 * Table Builder state: the delivery picks and the in-browser table build. Its own store, apart from
 * the manual and auto planners', so a build keeps running when the user switches tabs.
 */
import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';
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
import {
  allDeliverySelections,
  existingFor,
  storeDeliveryTables,
  type ExistingTable,
  type ReadTable,
} from '@/lib/chainFinder/existingTable';
import { fetchCatalog, tableUrl } from '@/lib/instantSearch/tableCatalog';
import { fetchTableHeader } from '@/lib/instantSearch/tableFetch';
import type { TableHeader } from '@/lib/instantSearch/table';

/** Every start TE the CLI covers with `--to 489` (490 is the last target, not a start). */
export const CHAIN_FINDER_TE_FROM = 120;
export const CHAIN_FINDER_TE_TO = 489;
const CHAIN_FINDER_TES = Array.from(
  { length: CHAIN_FINDER_TE_TO - CHAIN_FINDER_TE_FROM + 1 },
  (_, i) => CHAIN_FINDER_TE_FROM + i
);

/** Whether the store's tables have been read: `error` when the catalog couldn't be had. */
export type ExistingTableStatus = 'idle' | 'checking' | 'ready' | 'error';

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

  const existingStatus = ref<ExistingTableStatus>('idle');
  /** Every delivery table the store has, with its header. */
  const storeTables = shallowRef<ReadTable[]>([]);
  /** Headers by file (sha256), which never change. */
  const headers = new Map<string, Promise<TableHeader>>();
  let checkId = 0;

  /**
   * Reads the catalog and the header of every delivery table in it, for the picks' table and the
   * summary of every table. Run on opening the tab: tables are uploaded while the site is up.
   */
  async function checkExisting() {
    const id = ++checkId;
    existingStatus.value = 'checking';
    try {
      const catalog = await fetchCatalog();
      if (id !== checkId) return;
      if (!catalog) {
        existingStatus.value = 'error';
        return;
      }
      const read = await Promise.all(
        storeDeliveryTables(catalog).map(async entry => {
          let header = headers.get(entry.sha256);
          if (!header) {
            header = fetchTableHeader(tableUrl(entry.name));
            headers.set(entry.sha256, header);
            header.catch(() => headers.delete(entry.sha256));
          }
          try {
            return { entry, header: await header };
          } catch {
            return null;
          }
        })
      );
      if (id !== checkId) return;
      storeTables.value = read.filter((r): r is ReadTable => !!r);
      existingStatus.value = 'ready';
    } catch {
      if (id !== checkId) return;
      existingStatus.value = 'error';
    }
  }

  /** The store's table for the picks and silo setting, or null. */
  const existing = computed<ExistingTable | null>(() =>
    existingFor(storeTables.value, chainFinderDeliveryIds(deliverySelection.value), siloMode.value)
  );

  /** Every table the Table Builder can build at the silo setting, best gear first, and the store's
   *  table for each. */
  const allTables = computed(() =>
    allDeliverySelections().map(selection => ({
      selection,
      table: existingFor(storeTables.value, chainFinderDeliveryIds(selection), siloMode.value),
    }))
  );

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
    existingStatus,
    existing,
    allTables,
    checkExisting,
    startBuild,
    cancelBuild,
    downloadResult,
  };
});
