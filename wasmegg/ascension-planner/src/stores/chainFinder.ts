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
import { fetchCatalog, TABLE_STORE, tableUrl, type IndexEntry } from '@/lib/instantSearch/tableCatalog';
import { fetchTableBytes, fetchTableHeader } from '@/lib/instantSearch/tableFetch';
import { extendProblems, readTableFile, tesToBuild, type BaseTable } from '@/lib/chainFinder/extendTable';
import { deliveryOptions, CHAIN_FINDER_DELIVERY_FAMILIES } from '@/lib/chainFinder/deliveryArtifacts';
import type { TableHeader } from '@/lib/instantSearch/table';

/** The start TEs a table covers by default: the CLI's with `--to 489` (490 is the last target, not a start). */
export const CHAIN_FINDER_TE_FROM = 120;
export const CHAIN_FINDER_TE_TO = 489;
/** The lowest start TE the Table Builder builds from. */
export const CHAIN_FINDER_MIN_TE = 50;

/** The table to extend: a file the player picked, or the store's table for the picks. */
export type BaseChoice =
  | { kind: 'file'; table: BaseTable }
  | { kind: 'store'; entry: IndexEntry; header: TableHeader };

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
  /** The lowest start TE to build, CHAIN_FINDER_MIN_TE..CHAIN_FINDER_TE_TO: up to the top, for a table
   *  of a few rows that is extended later. */
  const minTE = ref(CHAIN_FINDER_TE_FROM);
  /** A table file the player picked to extend, and what went wrong reading the last one. */
  const uploaded = shallowRef<BaseTable | null>(null);
  const uploadError = ref('');
  /** Extend the store's table for the picks (when it can be) rather than build from scratch. */
  const extendStored = ref(true);
  /** What a running build is doing before its first cell, e.g. fetching the table it extends. */
  const preparing = ref('');
  /** Catalog names of stored tables being downloaded, and the last download's error. */
  const downloading = ref<Set<string>>(new Set());
  const downloadError = ref('');
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

  /** The table this build would extend, or null to build from scratch: the picked file first. */
  const base = computed<BaseChoice | null>(() => {
    if (uploaded.value) return { kind: 'file', table: uploaded.value };
    const table = existing.value;
    if (extendStored.value && table) return { kind: 'store', entry: table.entry, header: table.header };
    return null;
  });

  const baseHeader = (b: BaseChoice) => (b.kind === 'file' ? b.table.header : b.header);

  /** Why `base` can't be extended; empty when it can (or there's none). */
  const baseProblems = computed(() => {
    const b = base.value;
    return b ? extendProblems(baseHeader(b), chainFinderDeliveryIds(deliverySelection.value), siloMode.value) : [];
  });

  /** Whether the lowest start TE is a whole number in range: the input can hold anything while it's
   *  typed in, and a build waits until it is. */
  const minTEValid = computed(() => {
    const n = minTE.value;
    return Number.isInteger(n) && n >= CHAIN_FINDER_MIN_TE && n <= CHAIN_FINDER_TE_TO;
  });
  /** The lowest start TE, or the default while the input isn't valid. */
  const lowestTE = computed(() => (minTEValid.value ? minTE.value : CHAIN_FINDER_TE_FROM));

  /** The start TEs a build would simulate now, and the base range it keeps (null: none). */
  const plan = computed(() => {
    const b = base.value;
    const keep = b && !baseProblems.value.length ? baseHeader(b) : null;
    return {
      tes: tesToBuild(lowestTE.value, CHAIN_FINDER_TE_TO, keep ?? undefined),
      keep: keep ? { from: keep.from, to: keep.to } : null,
    };
  });

  /** Reads a picked table file to extend, and sets the delivery picks to the file's when they're offered. */
  async function loadFile(file: File) {
    uploadError.value = '';
    try {
      const { header, cells } = await readTableFile(await file.arrayBuffer());
      uploaded.value = { name: file.name, source: 'file', header, cells };
      const ids = header.delivery ?? [];
      const picks = Object.fromEntries(
        CHAIN_FINDER_DELIVERY_FAMILIES.map(f => [f, ids.find(id => deliveryOptions(f).some(o => o.id === id))])
      );
      if (CHAIN_FINDER_DELIVERY_FAMILIES.every(f => picks[f]))
        deliverySelection.value = picks as ChainFinderDeliverySelection;
    } catch (err) {
      uploaded.value = null;
      uploadError.value = err instanceof Error ? err.message : String(err);
    }
  }

  function clearFile() {
    uploaded.value = null;
    uploadError.value = '';
  }

  /** Saves a stored table's file (gzipped, as the store serves it) under its catalog name. */
  async function downloadStored(entry: IndexEntry) {
    if (downloading.value.has(entry.name)) return;
    downloading.value = new Set([...downloading.value, entry.name]);
    downloadError.value = '';
    try {
      const res = await fetch(`${TABLE_STORE}/tables/${entry.name}`, { cache: 'no-cache' });
      if (!res.ok || /text\/html/.test(res.headers.get('content-type') ?? ''))
        throw new Error(`the store answered ${res.ok ? 'with a web page' : res.status}`);
      saveFile(new Uint8Array(await res.arrayBuffer()), entry.name);
    } catch (err) {
      downloadError.value = `Couldn't download ${entry.name}: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      const left = new Set(downloading.value);
      left.delete(entry.name);
      downloading.value = left;
    }
  }

  let setWorkers: ((workers: number) => void) | null = null;

  // The workers input can change mid-build; an empty or partial entry is ignored until it's a count.
  watch(workerCount, n => {
    if (Number.isInteger(n) && n >= 1) setWorkers?.(n);
  });

  async function startBuild() {
    if (status.value === 'running') return;
    const selection = { ...deliverySelection.value };
    const silo = siloMode.value;
    const deliveryIds = chainFinderDeliveryIds(selection);
    const choice = baseProblems.value.length ? null : base.value;
    if (!minTEValid.value) return;
    const lowest = lowestTE.value;
    controller = new AbortController();
    const signal = controller.signal;
    status.value = 'running';
    progress.value = null;
    result.value = null;
    error.value = '';
    const releaseWakeLock = holdWakeLock(held => (keepingAwake.value = held));
    try {
      let keep: BaseTable | null = null;
      if (choice?.kind === 'file') keep = choice.table;
      if (choice?.kind === 'store') {
        preparing.value = `Downloading ${choice.entry.name} to extend it…`;
        const read = await readTableFile(await fetchTableBytes(tableUrl(choice.entry.name)));
        if (signal.aborted) throw new DOMException('Table build cancelled', 'AbortError');
        // The store may have replaced it since its header was read: check the file as it came.
        const problems = extendProblems(read.header, deliveryIds, silo);
        if (problems.length) throw new Error(`the stored table can't be extended: ${problems.join(' ')}`);
        keep = { name: choice.entry.name, source: 'store', ...read };
      }
      preparing.value = '';
      const tes = tesToBuild(lowest, CHAIN_FINDER_TE_TO, keep?.header);
      if (!tes.length) throw new Error(`${keep?.name ?? 'the table'} already covers start TE ${lowest}–${CHAIN_FINDER_TE_TO}`);
      const built = await buildChainFinderTable({
        deliveryIds,
        deferForEarnings: silo,
        tes,
        keep: keep?.cells,
        workers: workerCount.value,
        onResizable: fn => (setWorkers = fn),
        onProgress: p => (progress.value = p),
        signal,
      });
      const tag = `${deliverySelectionTag(selection)}${silo ? '-silo' : ''}`;
      result.value = { ...built, fileName: `table-${tag}-te${built.from}-${built.to}.bin.gz` };
      status.value = built.partial ? 'cancelled' : 'done';
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
      preparing.value = '';
      releaseWakeLock();
    }
  }

  function cancelBuild() {
    controller?.abort();
  }

  function downloadResult() {
    if (result.value) saveFile(result.value.gzipped, result.value.fileName);
  }

  return {
    minTE,
    minTEValid,
    lowestTE,
    uploaded,
    uploadError,
    extendStored,
    base,
    baseProblems,
    plan,
    preparing,
    downloading,
    downloadError,
    loadFile,
    clearFile,
    downloadStored,
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

/** Hands the browser a file to save. */
function saveFile(bytes: Uint8Array<ArrayBuffer>, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/gzip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Let the download start before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
