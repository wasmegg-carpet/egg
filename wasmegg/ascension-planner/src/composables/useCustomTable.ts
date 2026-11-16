/**
 * The player's custom Chain Finder table, kept in their cloud library (lib/cloud): choosing between it and
 * the default table, saving a table loaded by hand (a file, or a shared link) as it, downloading it (the plain
 * .bin.gz, as the store's tables download), and removing it.
 */
import { computed, reactive, watch } from 'vue';
import type { CustomTableEntry } from 'lib/cloud/library';
import { useCloudLibrary } from 'lib/planners/composables/useCloudLibrary';
import { useInstantSearchStore } from '@/stores/instantSearch';

const PREF_KEY = 'chainFinderUseCustomTable';

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== '0';
  } catch {
    return true;
  }
}

function writePref(value: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, value ? '1' : '0');
  } catch {
    // storage blocked: the choice lasts this visit
  }
}

const state = reactive({
  /** Search with the custom table when there is one (the default), or with the default table. */
  preferCustom: readPref(),
  /** A table was put in by hand (a file or a shared link); nothing replaces it by itself. */
  handPicked: false,
  /** The table put in by hand: its gzipped bytes and the label it was loaded under, so it can be saved. */
  picked: null as null | { name: string; label: string; bytes: Uint8Array<ArrayBuffer> },
  busy: '' as '' | 'loading' | 'saving' | 'deleting',
  error: '',
});

/** What the Chain Finder shows the custom table as (store.tableSource). */
export function customLabel(entry: CustomTableEntry): string {
  return `Your table: ${entry.name}`;
}

/** A table file as stored: gzipped (raw .bin files are gzipped here, as the store's are served). */
async function gzipped(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A copy of the bytes for the search worker (loading hands the buffer over, detaching it). */
const forWorker = (bytes: Uint8Array) => bytes.slice().buffer;

export function useCustomTable() {
  const cloud = useCloudLibrary();
  const store = useInstantSearchStore();

  const entry = computed(() => cloud.state.customTable);
  const usingCustom = computed(() => !!entry.value && store.tableSource === customLabel(entry.value));
  /** The loaded table is the one put in by hand, read without error: it can be saved. */
  const canSavePicked = computed(
    () => !!state.picked && store.tableStatus === 'ready' && store.tableSource === state.picked.label && !!store.header
  );

  async function run<T>(busy: typeof state.busy, work: () => Promise<T>): Promise<T | undefined> {
    state.busy = busy;
    state.error = '';
    try {
      return await work();
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      return undefined;
    } finally {
      state.busy = '';
    }
  }

  async function loadCustom(): Promise<void> {
    const e = entry.value;
    if (!e) return;
    await run('loading', async () => {
      const bytes = await cloud.loadCustomTable();
      if (!bytes) throw new Error('Your saved table couldn’t be found in your cloud library.');
      await store.loadExternal(forWorker(bytes), customLabel(e));
    });
  }

  async function useCustom(): Promise<void> {
    state.preferCustom = true;
    writePref(true);
    state.handPicked = false;
    await loadCustom();
  }

  async function useDefault(): Promise<void> {
    state.preferCustom = false;
    writePref(false);
    state.handPicked = false;
    await run('loading', () => store.loadTable());
  }

  /** "Load a table file…": search with it now, and remember it so it can be saved. */
  async function pickFile(file: File): Promise<void> {
    await run('loading', async () => {
      const raw = new Uint8Array(await file.arrayBuffer());
      state.picked = { name: file.name, label: file.name, bytes: await gzipped(raw) };
      state.handPicked = true;
      await store.loadExternal(forWorker(raw), file.name);
    });
  }

  /** Put in a table from a share link: search with it now; it can then be saved like a file. */
  async function pickShared(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const label = `Shared table: ${name}`;
    state.picked = { name, label, bytes };
    state.handPicked = true;
    await store.loadExternal(forWorker(bytes), label);
  }

  /** Save the table put in by hand as the custom table (replacing any), and search with it. */
  async function savePicked(): Promise<void> {
    const picked = state.picked;
    const header = store.header;
    if (!picked || !header || !canSavePicked.value) return;
    const saved = await run('saving', () =>
      cloud.saveTable(picked.bytes, {
        name: picked.name,
        from: header.from,
        to: header.to,
        delivery: (header.delivery ?? []).filter((d): d is string => typeof d === 'string'),
        silo: !!header.deferForEarnings,
      })
    );
    if (!saved) return;
    state.picked = null;
    state.handPicked = false;
    state.preferCustom = true;
    writePref(true);
    await loadCustom();
  }

  /** Save the custom table as a file: the plain .bin.gz, readable anywhere a table file is. */
  async function download(): Promise<void> {
    const e = entry.value;
    if (!e) return;
    await run('loading', async () => {
      const bytes = await cloud.loadCustomTable();
      if (!bytes) throw new Error('Your saved table couldn’t be found in your cloud library.');
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/gzip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = e.name.endsWith('.gz') ? e.name : `${e.name.replace(/\.bin$/, '')}.bin.gz`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  }

  async function remove(): Promise<void> {
    const wasUsing = usingCustom.value;
    await run('deleting', () => cloud.deleteTable());
    if (wasUsing && !state.error) await run('loading', () => store.loadTable());
  }

  /** The custom table's bytes, for sharing. */
  const customBytes = () => cloud.loadCustomTable();

  /**
   * Search with the custom table by itself when there is one, it's preferred, and nothing was put in by hand.
   * Waits for the store's own pick to finish first. Call once, from the component that shows the choice.
   */
  function autoLoad(): void {
    const tried = new Set<string>();
    watch(
      () => [entry.value?.id, entry.value?.savedAt, state.preferCustom, state.handPicked, store.tableStatus, store.tableSource] as const,
      () => {
        const e = entry.value;
        if (!e || !state.preferCustom || state.handPicked || state.busy || usingCustom.value) return;
        if (store.tableStatus === 'loading') return;
        const key = `${e.id}:${e.savedAt}`;
        if (tried.has(key)) return;
        tried.add(key);
        void loadCustom();
      },
      { immediate: true }
    );
  }

  return { state, entry, usingCustom, canSavePicked, useCustom, useDefault, pickFile, pickShared, savePicked, download, remove, customBytes, autoLoad };
}
