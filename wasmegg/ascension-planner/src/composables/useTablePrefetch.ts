/**
 * The Chain Finder's tables fetched in the background (lib/instantSearch/tablePrefetch.ts): once a
 * save is loaded and the page is idle, the files that player's Chain Finder will read, so the answer
 * is ready when they open the tab. Once per save and gear stamp in a session; silent on failure.
 *
 * The gear table's name needs the maxed table's waiting research (its `k3`), which the store's
 * catalog does not carry; the maxed table is in every plan anyway, so it is fetched (the HTTP cache
 * keeps it) and its header read, before the gear names are worked out.
 */
import { watch } from 'vue';
import { useInstantSearchStore } from '@/stores/instantSearch';
import { useInitialStateStore } from '@/stores/initialState';
import { fetchCatalog, maxedTable, TABLE_STORE } from '@/lib/instantSearch/tableCatalog';
import { fetchTableBytes } from '@/lib/instantSearch/tableFetch';
import { readTable } from '@/lib/instantSearch/table';
import { backupGearContext, gearStamp, gearTableNames, tableName } from '@/lib/instantSearch/tableGear';
import { getOptimalEarningsSet } from '@/lib/artifacts';
import { prefetchAllowed, prefetchFiles, prefetchPlan } from '@/lib/instantSearch/tablePrefetch';

const DONE_KEY = 'egg-table-prefetch';

function done(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DONE_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function markDone(key: string): void {
  try {
    sessionStorage.setItem(DONE_KEY, JSON.stringify([...done(), key].slice(-20)));
  } catch {
    // Storage blocked: at worst it is fetched again next time (from the cache).
  }
}

export function useTablePrefetch(): void {
  if (typeof window === 'undefined' || !prefetchAllowed()) return;
  const chainFinder = useInstantSearchStore();
  const initial = useInitialStateStore();
  const base = `${TABLE_STORE}/tables/`;
  let busy = false;

  async function run(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const backup = chainFinder.backup;
      const ctx = backupGearContext(backup);
      const id = (backup as { eiUserId?: string } | null)?.eiUserId;
      const te = chainFinder.saveTE ?? 0;
      if (!ctx || !id || !(te > 0)) return;
      const entries = await fetchCatalog();
      if (!entries) return;
      const own = `${await tableName(id)}.gz`;
      // Their own table alone, when the store has one that starts at or below their TE.
      if (entries.some(e => e.name === own && e.from <= te)) {
        if (!done().includes(own)) {
          markDone(own);
          await prefetchFiles(base, [own]);
        }
        return;
      }
      // The gear table's name needs the maxed table's k3: fetch the maxed table (every plan has it)
      // and read its header; the HTTP cache keeps it for the Chain Finder's own load.
      const maxedName = maxedTable(entries)?.name ?? 'table.bin.gz';
      const maxed = readTable(await fetchTableBytes(`${base}${maxedName.replace(/\.gz$/, '')}`));
      const k3 = maxed.header.k3;
      const stamp = k3?.research ? gearStamp(ctx, getOptimalEarningsSet(ctx.rawBackup!), k3.research) : null;
      const gear = stamp ? (await gearTableNames(stamp)).map(n => `${n}.gz`) : null;
      const key = `${own}|${gear?.[0] ?? ''}`;
      if (done().includes(key)) return;
      markDone(key);
      await prefetchFiles(base, prefetchPlan({ entries, own, gear, te }));
    } catch {
      // A prefetch that fails changes nothing: the Chain Finder fetches what it needs when it opens.
    } finally {
      busy = false;
    }
  }

  // When a save is loaded (a new one too) and the page has settled.
  watch(
    () => [initial.hasData, (initial.rawBackup as { eiUserId?: string } | null)?.eiUserId],
    ([ready]) => {
      if (!ready) return;
      const go = () => void run();
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
        .requestIdleCallback;
      if (ric) setTimeout(() => ric(go, { timeout: 10000 }), 3000);
      else setTimeout(go, 5000);
    },
    { immediate: true }
  );
}
