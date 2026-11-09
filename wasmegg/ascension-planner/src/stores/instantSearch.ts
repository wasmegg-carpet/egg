/**
 * Chain Finder state: the target (a TE, or the highest TE by a date), where the plan starts, the
 * precomputed table and the last answer. Its own store, like the Table Builder's, so an answer stays
 * put when the user switches tabs.
 *
 * The search itself runs on one Web Worker (workers/instantSearch.worker.ts) that keeps the table.
 */
import { defineStore } from 'pinia';
import { computed, markRaw, ref, shallowRef, watch } from 'vue';
import { useInitialStateStore } from '@/stores/initialState';
import { canonicalDelivered, EGG_ORDER } from '@/lib/instantSearch/precomputedLeg';
import {
  mergeBlocked,
  type Blocked,
  type FindOptions,
  type FoundRoutes,
  type Route,
} from '@/lib/instantSearch/routeFinder';
import { chainGaps, type SpaceFilter } from '@/lib/instantSearch/chainSpace';
import { avoidBlocked, hoursBlocked } from '@/lib/instantSearch/blockedTime';
import type { TableHeader } from '@/lib/instantSearch/table';
import { tableHeaderWarnings } from '@/buildTable/header';
import { readTable } from '@/lib/instantSearch/table';
import {
  fetchCatalog,
  deliveryCoreKey,
  findDeliveryTable,
  findTable,
  maxedTable,
  tableUrl,
  TABLE_STORE,
} from '@/lib/instantSearch/tableCatalog';
import { describeTableArtifacts, tableArtifacts } from '@/lib/instantSearch/tableArtifacts';
import { fetchTableBytes, isTableStall } from '@/lib/instantSearch/tableFetch';
import { backupGearContext, gearChanges, gearStamp, gearTableNames, tableName } from '@/lib/instantSearch/tableGear';
import { instantDeliveryScale } from '@/lib/instantSearch/deliveryScale';
import { simChangesSince } from '@/lib/instantSearch/simChanges';
import { getArtifact, getOptimalEarningsSet } from '@/lib/artifacts';
import { readCurrentAscension, type CurrentAscension } from '@/lib/instantSearch/currentAscension';
import {
  chainFinderLoadout,
  chainFinderLoadoutFromBackup,
  deliveryMatchesTable,
  earningsShift as earningsShiftOf,
} from '@/lib/instantSearch/earningsShift';
import {
  cloneLoadoutInputs,
  loadoutInputsEqual,
  seedFixedDeliveryFromAuto,
  type AutoLoadoutInputs,
} from '@/auto/loadout';
import { maxedLoadoutInputs } from '@/buildTable/maxedAccount';
import { parseVirtueProgress } from '@/lib/backupVirtue';
import { fetchPlayerBackup } from '@/lib/modes/fetchBackup';
import { resolveFetchablePlayerId } from '@/lib/modes/utils';
import type { ei } from 'lib';
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import { getLocalTimestampInTimezone, PACIFIC_TIMEZONE } from 'lib/planners/events';
import { formatUnixToDateInput, formatUnixToTimeInput } from '@/lib/format';
import type { InstantSearchRequest, InstantSearchResponse, SpaceSummary } from '@/workers/instantSearch.protocol';

export type InstantTargetMode = 'te' | 'date';
export type StartMode = 'now' | 'hypothetical';

/** The highest TE there is, and By a date's target. */
export const MAX_TE = 490;
/** Most ascensions a route may have (AutoAutoAP's MAX_ASCENSIONS). */
export const MAX_ASCENSIONS = 12;
/** The maxed table built by scripts/buildTable.ts, served by the ap-table-store Worker (the plain
 *  name: tableFetch.ts tries the `.gz` first). Only used when the catalog itself cannot be read. */
export const DEFAULT_TABLE_URL = `${TABLE_STORE}/tables/table.bin`;
/** Where gear tables end and the maxed table takes over: from there it is exact for any gear on the
 *  board (AutoAutoAP's GEAR_TABLE_TO). */
export const GEAR_TABLE_TO = 340;

/** The next July 14th, 9:00 AM in Los Angeles, as a unix second. */
export function defaultDeadline(now = Date.now() / 1000): number {
  const year = Number(formatUnixToDateInput(now, PACIFIC_TIMEZONE).slice(0, 4));
  const at = (y: number) => getLocalTimestampInTimezone(`${y}-07-14`, '09:00', PACIFIC_TIMEZONE);
  return at(year) > now ? at(year) : at(year + 1);
}

/** The answer and what it was asked for, so the results keep showing the question they answer. */
export interface InstantAnswer {
  found: FoundRoutes;
  ms: number;
  mode: InstantTargetMode;
  startTE: number;
  start: number;
  final: number;
  deadline?: number;
  /** The time zone the answer's dates are shown in. */
  timezone: string;
  /** A hypothetical start (a chosen TE and moment), not the save right now. */
  hypothetical: boolean;
  /** The ascension in progress the routes start from (continued, or ended by prestiging now), or null. */
  inProgress: { claimedTE: number } | null;
  /** The filters the search ran with (`blockFilters`): days to avoid and blocked weekly hours, in
   *  `timezone`. */
  blocks: BlockFilters;
  /** Prestiges could wait for eggs (`waitForEggs`). */
  waitForEggs: boolean;
  /** Eggs delivered per egg (EGG_ORDER) at the start: the save's, or the table's share of `startTE`. */
  startDelivered: number[];
  /** The table was built in silo mode (its header's `deferForEarnings`). */
  siloMode: boolean;
  /** Clothed TE the save's earnings artifacts are below the table's: the table was read that much lower,
   *  rounded down (lib/instantSearch/earningsShift.ts). Every TE in the routes is the real one. */
  earningsShift: number;
  /** What the worker was asked, for Chain comparison to price other plans the same way. */
  options: Omit<FindOptions, 'onProgress'>;
}

/** A day at least one prestige should fall near: YYYY-MM-DD in the answer's zone, and how many days
 *  either side count. */
export interface PrestigeWindow {
  date: string;
  days: number;
}

/** Chain comparison's filters, as the page edits them. */
export interface ExplorerFilter {
  /** Most days slower than the explored route (as found, waits and all). */
  slackDays: number;
  /** TE between prestiges (chainSpace.ts `chainGaps`: the final ascension left out). */
  minGap: number;
  maxGap: number;
  windows: PrestigeWindow[];
}

/** Chains are listed once no more than this many match. */
export const SHOW_LIMIT = 1000;
/** Days slower than the fastest chain, to start with. */
export const DEFAULT_SLACK_DAYS = 2;

/** Chain comparison: every chain like one of the answer's routes, filtered down (chainSpace.ts). */
export interface Comparison {
  route: Route;
  filter: ExplorerFilter;
  /** Finding the chains ('finding'), or filtering them ('ready'). */
  status: 'finding' | 'ready' | 'error';
  progress: { stage: 'bound' | 'chains' | 'waits'; done: number; of: number } | null;
  space: SpaceSummary | null;
  /** Chains the filters let through, and those chains (no waits) once no more than SHOW_LIMIT. */
  matches: number | null;
  routes: Route[] | null;
  /** The same chains with their waits for eggs, once worked out. */
  waited: Route[] | null;
  waits: 'none' | 'running' | 'done';
  /** The worker's milliseconds per chain's waits: how many it will do at once. */
  perWait: number;
  error: string;
}

/** What the prestige filters are set to: compared to tell whether an answer is out of date. */
export interface BlockFilters {
  dates: string[];
  hours: number[];
  timezone: string;
}

/** Every number of ascensions, 1 to MAX_ASCENSIONS. */
export const ALL_COUNTS = () => Array.from({ length: MAX_ASCENSIONS }, (_, i) => i + 1);

/** The spans no prestige may start in, for a plan starting at `from`: the avoided days and the
 *  blocked hours laid out from then (lib/instantSearch/blockedTime.ts). */
export function blockedSpans(f: BlockFilters, from: number): Blocked {
  return mergeBlocked([...avoidBlocked(f.dates, f.timezone), ...hoursBlocked(f.hours, f.timezone, from)]);
}

export const useInstantSearchStore = defineStore('instantSearch', () => {
  const initialState = useInitialStateStore();

  const mode = ref<InstantTargetMode>('te');
  const targetTE = ref(MAX_TE);
  /** By a date's deadline, a unix second. The picker shows it in `timezone`; changing the zone keeps
   *  the moment and changes how it reads. */
  const deadline = ref(defaultDeadline());
  const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone);
  /**
   * A date input and a time input over one instant, both read in `timezone`: changing the zone keeps
   * the instant and changes how it reads. An emptied field is ignored.
   */
  function localInputs(instant: { value: number }) {
    const set = (d: string, t: string) => {
      const at = getLocalTimestampInTimezone(d, t, timezone.value);
      if (Number.isFinite(at)) instant.value = at;
    };
    const date = computed({
      get: () => formatUnixToDateInput(instant.value, timezone.value),
      set: v => set(v, time.value),
    });
    const time = computed({
      get: () => formatUnixToTimeInput(instant.value, timezone.value),
      set: v => set(date.value, v),
    });
    return { date, time };
  }
  const { date: deadlineDate, time: deadlineTime } = localInputs(deadline);

  /** 'now': the save as it is, right now. 'hypothetical': a prestige at a TE and moment of the user's
   *  choosing, ignoring the save. */
  const startMode = ref<StartMode>('now');
  /** The hypothetical start: a unix second (default: the next whole hour) and a TE (null: the save's). */
  const hypotheticalStart = ref(Math.ceil(Date.now() / 1000 / 3600) * 3600);
  const hypotheticalTE = ref<number | null>(null);
  const { date: hypotheticalDate, time: hypotheticalTime } = localInputs(hypotheticalStart);
  /** Filter: the numbers of ascensions to show. The search stops at the highest of them, so any lower
   *  count shows without a new search. */
  const ascensionCounts = ref<number[]>(ALL_COUNTS());
  /** Filter: days (YYYY-MM-DD, read in `timezone`) no prestige may start on. */
  const avoidDates = ref<string[]>([]);
  /** Filter: weekly hours (0-167, Monday 00:00 first, in `timezone`) no prestige may start in. */
  const blockedHours = ref<number[]>([]);
  const blockFilters = computed<BlockFilters>(() => ({
    dates: [...avoidDates.value],
    hours: [...blockedHours.value].sort((a, b) => a - b),
    timezone: timezone.value,
  }));
  /** Filter: let a prestige wait whole hours when the eggs laid meanwhile end the route sooner
   *  (routeFinder.ts `holdRoute`). */
  const waitForEggs = ref(true);
  const anyBlocks = (f: BlockFilters) => f.dates.length > 0 || f.hours.length > 0;
  /** The prestige filters differ from what the shown answer was found with (the zone only counts
   *  when some filter is on, either then or now). */
  const avoidChanged = computed(() => {
    const was = answer.value?.blocks;
    if (!was) return false;
    const now = blockFilters.value;
    if (!anyBlocks(was) && !anyBlocks(now)) return false;
    return JSON.stringify(was) !== JSON.stringify(now);
  });
  /** Waiting for eggs was turned on or off since the shown answer. */
  const waitsChanged = computed(() => !!answer.value && answer.value.waitForEggs !== waitForEggs.value);
  /** A number of ascensions is picked that the shown answer's search stopped short of. */
  const countsPastAnswer = computed(
    () => !!answer.value && ascensionCounts.value.some(n => n > answer.value!.options.maxAscensions)
  );

  const header = shallowRef<TableHeader | null>(null);
  /** What's missing or unexpected in the loaded table's header (buildTable/header.ts). */
  const headerWarnings = computed(() =>
    header.value ? tableHeaderWarnings(header.value as unknown as Record<string, unknown>) : []
  );
  /** Simulator changes the loaded table doesn't have, oldest first (simChanges.ts). */
  const simChanges = computed(() => (header.value ? simChangesSince(header.value) : []));
  const tableSource = ref('');
  /** Why the table in use is not built for the player's own gear or delivery set; '' when it is. */
  const tableNote = ref('');
  const tableStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const status = ref<'idle' | 'running' | 'done' | 'error'>('idle');
  const progress = ref<{ done: number; of: number; stage?: 'waits' } | null>(null);
  const answer = shallowRef<InstantAnswer | null>(null);
  const error = ref('');
  /** Chain comparison for one of the answer's routes, and whether the answer is folded away for it. */
  const comparison = ref<Comparison | null>(null);
  const answerCollapsed = ref(false);

  /** A backup fetched from this tab (`refreshBackup`), newer than the loaded save's. Only Instant
   *  Search reads it: the rest of the page keeps the save it loaded. */
  const refreshedBackup = shallowRef<ei.IBackup | null>(null);
  /** The backup Chain Finder reads: the refreshed one, else the loaded save's, as it came. */
  const backup = computed(() => refreshedBackup.value ?? (initialState.hasData ? initialState.rawBackup : null));
  const refreshing = ref(false);

  /** The ascension in progress in `backup`, as of `detect()` (lib/instantSearch/currentAscension.ts). */
  const current = shallowRef<CurrentAscension | null>(null);
  /** Read the ascension in progress again, its catch-up worked out to now. */
  function detect(now = Math.floor(Date.now() / 1000)): void {
    try {
      current.value = backup.value ? readCurrentAscension(backup.value, now) : null;
    } catch (err) {
      console.error('Chain Finder: could not read the current ascension', err);
      current.value = null;
    }
  }

  /** Fetch the player's latest backup for this tab, and read the ascension in progress from it. */
  async function refreshBackup(): Promise<void> {
    const playerId = resolveFetchablePlayerId();
    if (!playerId || refreshing.value) return;
    refreshing.value = true;
    error.value = '';
    try {
      refreshedBackup.value = (await fetchPlayerBackup(playerId)).backup;
      detect();
    } catch (err) {
      error.value = `Couldn't fetch your latest backup: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      refreshing.value = false;
    }
  }
  /** Another save loaded on the page replaces anything fetched here. */
  function onSaveLoaded(): void {
    refreshedBackup.value = null;
    detect();
  }

  /** The save's egg counts in table order (catch-up included when an ascension is in progress), or
   *  null with no save loaded. */
  const saveDelivered = computed<number[] | null>(() => {
    if (current.value) return current.value.delivered;
    if (!backup.value) return null;
    const { eggsDelivered } = parseVirtueProgress(backup.value);
    return EGG_ORDER.map(e => eggsDelivered[e] || 0);
  });
  /** The TE the save would prestige with: every threshold its eggs have passed (claimed + pending). */
  const saveTE = computed(() =>
    saveDelivered.value ? saveDelivered.value.reduce((n, d) => n + countTEThresholdsPassed(d), 0) : null
  );
  /** The save's artifacts and stones (lib/instantSearch/earningsShift.ts), or the maxed ones with no
   *  save: what Reset returns `loadout` to. */
  const defaultLoadout = computed<AutoLoadoutInputs>(() => {
    if (backup.value) {
      try {
        return chainFinderLoadoutFromBackup(backup.value);
      } catch (err) {
        console.error("Chain Finder: could not read the save's artifacts", err);
      }
    }
    return chainFinderLoadout(maxedLoadoutInputs());
  });
  /** The artifacts and stones searched with: the save's until edited, to try higher or lower ones.
   *  Another save replaces any edits. */
  const loadout = ref<AutoLoadoutInputs>(cloneLoadoutInputs(defaultLoadout.value));
  watch(defaultLoadout, d => (loadout.value = cloneLoadoutInputs(d)));
  /** Clothed TE `loadout`'s earnings artifacts are below the loaded table's (0 with no table). */
  const earningsShift = computed(() => (header.value ? earningsShiftOf(loadout.value, header.value) : 0));
  /** `loadout`'s delivery set is the loaded table's, which is what the search assumes either way. */
  const deliveryMatches = computed(() => !header.value || deliveryMatchesTable(loadout.value, header.value));
  /** The earnings artifacts were changed since the shown answer. */
  const artifactsChanged = computed(() => !!answer.value && answer.value.earningsShift !== earningsShift.value);
  /** The table row a start TE reads: lower by the earnings shift, rounded down (table.ts
   *  `shiftedLookup`). */
  const rowFor = (te: number) => Math.floor(te - earningsShift.value);

  /** Starting from the save right now (needs a save): then the ascension in progress can continue.
   *  Otherwise the start is hypothetical. */
  const fromSave = computed(() => startMode.value === 'now' && saveTE.value !== null);
  const startTE = computed(() => (fromSave.value ? saveTE.value! : (hypotheticalTE.value ?? saveTE.value ?? 0)));
  /** When the plan starts: now, or the hypothetical moment. */
  const startAt = (now: number) => (fromSave.value ? now : hypotheticalStart.value);

  let worker: Worker | null = null;
  let nextRequestId = 0;
  const pending = new Map<number, (r: InstantSearchResponse) => void>();

  function send(message: InstantSearchRequest, transfer: Transferable[] = []): void {
    if (!worker) {
      worker = new Worker(new URL('../workers/instantSearch.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<InstantSearchResponse>) =>
        pending.get(event.data.requestId)?.(event.data);
      worker.onerror = (event: ErrorEvent) => {
        for (const handler of pending.values())
          handler({ type: 'error', requestId: -1, message: event.message || 'Chain Finder worker failed' });
        pending.clear();
        worker?.terminate();
        worker = null;
      };
    }
    worker.postMessage(message, transfer);
  }

  /** Hand a table's bytes to the worker — on their own, or joined to the maxed table's above
   *  `high.split` (a gear table below, the maxed one from there, its delivery rate scaled); resolves
   *  with its header. */
  function loadBytes(
    bytes: ArrayBuffer,
    source: string,
    high?: { bytes: ArrayBuffer; split: number; scale: number }
  ): Promise<void> {
    const requestId = nextRequestId++;
    tableStatus.value = 'loading';
    error.value = '';
    return new Promise(resolve => {
      pending.set(requestId, r => {
        pending.delete(requestId);
        if (r.type === 'loaded') {
          header.value = r.header;
          tableSource.value = source;
          tableStatus.value = 'ready';
          // What the answer is priced with, in the console as well as under the table's name.
          const used = describeTableArtifacts(r.header);
          console.info(
            `Chain Finder: table "${source}" (${r.header.from}-${r.header.to}, simulator ${r.header.simVersion ?? 'unstamped'})` +
              (used ? `\n  built with ${used}` : '\n  its header records no artifact sets'),
            tableArtifacts(r.header)
          );
        } else if (r.type === 'error') {
          header.value = null;
          tableStatus.value = 'error';
          error.value = `Couldn't read the table (${source}): ${r.message}`;
        }
        resolve();
      });
      send({ kind: 'load', requestId, bytes, ...(high ? { high } : {}) }, [bytes, ...(high ? [high.bytes] : [])]);
    });
  }

  /** The context a gear stamp is computed in: the backup the Chain Finder reads (the refreshed one
   *  when there is one), with the epic research and colleggtibles parsed from it. */
  const gearContext = computed(() => backupGearContext(backup.value));

  /** Where the player's own table would be: a slow hash of their id (tableGear.ts `tableName`),
   *  worked out once per id; the id never leaves the page. */
  let ownName: { id: string; name: Promise<string> } | null = null;

  const labelOf = (id: string) => getArtifact(id)?.label ?? id;

  /** `loadout`'s delivery set, as the table is picked by it: the fixed one, or the one the inventory
   *  would wear. */
  const loadoutDelivery = computed(() => {
    const d = loadout.value.delivery;
    return d.mode === 'fixed' ? d.artifactIds : seedFixedDeliveryFromAuto(loadout.value);
  });
  /** `loadout` was edited away from the save: the save's own gear (account and gear tables) is then
   *  not what is searched with. */
  const loadoutEdited = computed(() => !loadoutInputsEqual(loadout.value, defaultLoadout.value));
  /** What `loadTable` picks a table by; a change picks again. */
  const tablePick = computed(
    () => `${loadoutEdited.value ? 'edited' : 'save'}|${deliveryCoreKey(loadoutDelivery.value)}`
  );
  /** The `tablePick` the store's table was picked for; null before one is, and for a file loaded by
   *  hand, which a change in `loadout` leaves alone. */
  let pickedFor: string | null = null;

  /**
   * Load the best table the store has for `loadout` (the Artifacts & stones section): while it is the
   * save's, their own account table when the store has one whose gear stamp still matches; else a gear
   * table built on gear exactly like theirs, below GEAR_TABLE_TO with the maxed table from there at
   * their delivery rate. Then, edited or not, a delivery table for its metronome, compass and gusset;
   * else the maxed table. The store's catalog (`/tables/index.json`) says which tables exist before
   * anything is downloaded; without it (offline, or a web page in its place) the maxed table's own URL
   * is all that is tried.
   */
  let loadingTable: Promise<void> | null = null;
  async function loadTable(): Promise<void> {
    if (loadingTable) return loadingTable;
    loadingTable = (async () => {
      tableStatus.value = 'loading';
      error.value = '';
      tableNote.value = '';
      pickedFor = tablePick.value;
      const deliveryIds = [...loadoutDelivery.value];
      try {
        const entries = await fetchCatalog();
        // The save's own gear only while the section is the save's.
        const ctx = loadoutEdited.value ? null : gearContext.value;
        const id = (backup.value as { eiUserId?: string } | null)?.eiUserId ?? resolveFetchablePlayerId();

        // The player's own table, when the store has one and its gear still matches their save.
        if (entries && ctx && id) {
          if (ownName?.id !== id) ownName = { id, name: tableName(id) };
          const entry = findTable(entries, `${await ownName.name}.gz`);
          if (entry) {
            const ownBytes = await fetchTableBytes(tableUrl(entry.name));
            const own = readTable(ownBytes);
            if (own.header.gear) {
              const stamp = gearStamp(ctx, getOptimalEarningsSet(ctx.rawBackup!), own.header.gear.research ?? {});
              const changes = stamp ? gearChanges(own.header.gear, stamp) : ['gear'];
              if (!changes.length) {
                await loadBytes(ownBytes, entry.name);
                return;
              }
              tableNote.value = `Your own table is out of date for your save (its ${changes.join(', ')} changed); using the best other table.`;
            }
          }
        }

        // The maxed table: the answer on its own, the half above every gear table, and the k3 the
        // other tables are matched against. Without one in the catalog the store has nothing to
        // compare a gear stamp or a delivery set with, so say so rather than fetch a name that is
        // not there.
        const maxedEntry = entries ? maxedTable(entries) : null;
        if (entries && !maxedEntry) {
          const counts = new Map<string, number>();
          for (const entry of entries) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
          throw new Error(
            `the table store lists ${entries.length} table${entries.length === 1 ? '' : 's'} ` +
              `(${[...counts].map(([kind, n]) => `${n} ${kind}`).join(', ')}) and no maxed table, ` +
              'so there is nothing to compare your gear with'
          );
        }
        const maxedName = maxedEntry?.name ?? 'table.bin';
        const maxedBytes = await fetchTableBytes(maxedEntry ? tableUrl(maxedEntry.name) : DEFAULT_TABLE_URL);
        const maxed = readTable(maxedBytes);

        // A gear table built on gear exactly like the player's, below GEAR_TABLE_TO; the maxed one
        // from there, its delivery rate scaled to the player's (deliveryScale.ts).
        if (entries && ctx && maxed.header.k3?.research) {
          const k3 = { research: maxed.header.k3.research, delivery: maxed.header.k3.delivery ?? [] };
          const stamp = gearStamp(ctx, getOptimalEarningsSet(ctx.rawBackup!), k3.research);
          if (stamp) {
            const scale = instantDeliveryScale(ctx, k3);
            for (const gearName of await gearTableNames(stamp)) {
              const entry = findTable(entries, `${gearName}.gz`);
              if (!entry) continue;
              try {
                const gearBytes = await fetchTableBytes(tableUrl(entry.name));
                await loadBytes(gearBytes, `${entry.name} + ${maxedName} from ${GEAR_TABLE_TO}`, {
                  bytes: maxedBytes,
                  split: GEAR_TABLE_TO,
                  scale,
                });
                return;
              } catch (err) {
                if (isTableStall(err)) throw err;
                // Not under this name: the next one.
              }
            }
          }
        }

        // The table built for the loadout's metronome, compass and gusset, or the closest one: two of
        // the three, the third nearest (what the search then assumes, and what `deliveryMatches`
        // reports). The maxed table is one of them (its set is in its header, not the catalog). Their
        // earnings set is the maxed one, which `earningsShift` reads the table down for.
        const match = entries
          ? findDeliveryTable(
              entries.map(e => (e === maxedEntry ? { ...e, delivery: maxed.header.delivery ?? null } : e)),
              deliveryIds
            )
          : null;
        const sendIt = 'build one with the Table Builder and send it to joobrainie to upload.';
        if (match && !match.exact) {
          const swaps = match.differs.map(d => `${labelOf(d.table)} instead of ${d.mine ? labelOf(d.mine) : 'none'}`);
          tableNote.value = `No table for your exact delivery set, so this is the closest (${swaps.join(', ')}). For an exact one, ${sendIt}`;
        } else if (entries && !match) {
          tableNote.value = `No table close to your delivery set, so this is the maxed one. For yours, ${sendIt}`;
        }
        if (match && match.entry.kind !== 'maxed') {
          try {
            await loadBytes(await fetchTableBytes(tableUrl(match.entry.name)), match.entry.name);
            return;
          } catch (err) {
            if (isTableStall(err)) throw err;
            // Listed but unreadable: the maxed table is still an answer.
            tableNote.value = '';
          }
        }

        await loadBytes(maxedBytes, maxedName);
      } catch (err) {
        tableStatus.value = 'error';
        error.value = `Couldn't download the table: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        loadingTable = null;
      }
      // The section changed while this one loaded: pick again.
      if (pickedFor !== null && pickedFor !== tablePick.value) await loadTable();
    })();
    return loadingTable;
  }

  // A store table follows the Artifacts & stones section, a moment after it stops changing; an answer
  // found on another table is dropped, as when a file is loaded.
  let pickTimer: ReturnType<typeof setTimeout> | undefined;
  watch(tablePick, () => {
    clearTimeout(pickTimer);
    pickTimer = setTimeout(async () => {
      if (pickedFor === null || pickedFor === tablePick.value || loadingTable) return;
      const was = tableSource.value;
      await loadTable();
      if (tableSource.value !== was && status.value !== 'running') {
        answer.value = null;
        status.value = 'idle';
      }
    }, 500);
  });

  async function loadFile(file: File): Promise<void> {
    pickedFor = null;
    tableNote.value = '';
    await loadBytes(await file.arrayBuffer(), file.name);
    answer.value = null;
    status.value = 'idle';
  }

  /** What's wrong with the inputs for the loaded table, or '' when a search can run. */
  const problem = computed(() => {
    const h = header.value;
    const te = startTE.value;
    if (!h) return '';
    if (!ascensionCounts.value.length) return 'Pick at least one number of ascensions in Filters.';
    // Continuing needs no table row at the start TE; a prestige does.
    const canContinue = fromSave.value && !!current.value;
    const row = rowFor(te);
    if (!Number.isInteger(te) || (!canContinue && (row < h.from || row > h.to)))
      return row === te
        ? `The table covers start TEs ${h.from}–${h.to}; you start at ${te}.`
        : `The table covers start TEs ${h.from}–${h.to}; you start at ${te}, which your earnings artifacts search as ${row}.`;
    if (mode.value === 'te' && !(Number.isInteger(targetTE.value) && targetTE.value > te && targetTE.value <= MAX_TE))
      return `Pick a target TE above ${te}, up to ${MAX_TE}.`;
    if (mode.value === 'date' && !(deadline.value > startAt(Date.now() / 1000)))
      return fromSave.value ? 'Pick a date in the future.' : 'Pick a date after the hypothetical start.';
    return '';
  });

  async function search(): Promise<void> {
    if (status.value === 'running') return;
    if (tableStatus.value !== 'ready') await loadTable();
    if (tableStatus.value !== 'ready' || problem.value) return;
    const now = Math.floor(Date.now() / 1000);
    // The catch-up runs to the moment the search starts from.
    if (fromSave.value) detect(now);
    const te = startTE.value;
    const cont = fromSave.value ? (current.value?.build ?? null) : null;
    // The save's real counts only when starting from the save's own TE; a typed start TE uses the
    // table's canonical share.
    const delivered = fromSave.value ? saveDelivered.value : null;
    const asked: Omit<InstantAnswer, 'found' | 'ms' | 'options'> = {
      mode: mode.value,
      startTE: te,
      start: startAt(now),
      final: mode.value === 'date' ? MAX_TE : targetTE.value,
      ...(mode.value === 'date' ? { deadline: deadline.value } : {}),
      timezone: timezone.value,
      hypothetical: !fromSave.value,
      inProgress: cont && current.value ? { claimedTE: current.value.claimedTE } : null,
      blocks: blockFilters.value,
      waitForEggs: waitForEggs.value,
      startDelivered: [...(delivered ?? canonicalDelivered(te))],
      siloMode: !!header.value?.deferForEarnings,
      earningsShift: earningsShift.value,
    };
    const avoid = anyBlocks(asked.blocks) ? blockedSpans(asked.blocks, asked.start) : [];
    const options: InstantAnswer['options'] = {
      startTE: asked.startTE,
      start: asked.start,
      final: asked.final,
      maxAscensions: Math.max(...ascensionCounts.value),
      ...(asked.deadline !== undefined ? { deadline: asked.deadline } : {}),
      ...(delivered ? { startDelivered: [...delivered] } : {}),
      ...(cont ? { cont: { ...cont, delivered: [...cont.delivered] } } : {}),
      ...(avoid.length ? { avoid } : {}),
      ...(cont && current.value ? { contEgg: EGG_ORDER.indexOf(current.value.egg) } : {}),
      ...(asked.waitForEggs ? { waitForEggs: true } : {}),
      ...(asked.earningsShift > 0 ? { earningsShift: asked.earningsShift } : {}),
    };
    const requestId = nextRequestId++;
    status.value = 'running';
    progress.value = null;
    error.value = '';
    await new Promise<void>(resolve => {
      pending.set(requestId, r => {
        if (r.type === 'progress') {
          progress.value = { done: r.done, of: r.of, ...(r.stage === 'waits' ? { stage: r.stage } : {}) };
          return;
        }
        pending.delete(requestId);
        if (r.type === 'result') {
          answer.value = { ...asked, options, found: r.found, ms: r.ms };
          comparison.value = null;
          answerCollapsed.value = false;
          status.value = 'done';
        } else if (r.type === 'error') {
          status.value = 'error';
          error.value = r.message;
        }
        resolve();
      });
      send({ kind: 'search', requestId, options });
    });
  }

  /** Open Chain comparison on one of the answer's routes, folding the answer away. Its filters start
   *  from the route: its smallest and largest TE between prestiges. */
  function exploreSimilar(route: Route): void {
    const a = answer.value;
    if (!a || status.value === 'running') return;
    const gaps = chainGaps(route.chain, a.startTE);
    // Routes and the worker's answers are never changed in place: kept raw, they post to the worker
    // as they are (a reactive proxy can't be cloned) and aren't made deeply reactive for nothing.
    comparison.value = {
      route: markRaw(route),
      filter: {
        slackDays: DEFAULT_SLACK_DAYS,
        minGap: gaps.length ? Math.min(...gaps) : 1,
        maxGap: gaps.length ? Math.max(...gaps) : MAX_TE,
        windows: [],
      },
      status: 'finding',
      progress: null,
      space: null,
      matches: null,
      routes: null,
      waited: null,
      waits: 'none',
      perWait: 0,
      error: '',
    };
    answerCollapsed.value = true;
    findSpace();
  }

  /** The comparison open now, if it is still `c`. */
  const still = (c: Comparison) => (comparison.value === c ? c : null);

  let spaceRequest = -1;
  /** Every chain the filters let through, found again (the worker keeps them for filtering). Only the
   *  newest search counts: an older one still running is dropped when it answers. */
  function findSpace(): void {
    const a = answer.value;
    const c = comparison.value;
    if (!a || !c) return;
    const requestId = (spaceRequest = nextRequestId++);
    Object.assign(c, { status: 'finding', progress: null, matches: null, routes: null, waited: null, waits: 'none' });
    pending.set(requestId, r => {
      const live = spaceRequest === requestId ? still(c) : null;
      if (r.type === 'progress') {
        if (live && r.stage && r.stage !== 'waits') live.progress = { stage: r.stage, done: r.done, of: r.of };
        return;
      }
      pending.delete(requestId);
      if (!live) return;
      live.progress = null;
      if (r.type === 'space') {
        live.space = markRaw(r.summary);
        live.status = 'ready';
        filterSpace();
      } else if (r.type === 'error') Object.assign(live, { status: 'error', error: r.message });
    });
    send({ kind: 'space', requestId, options: a.options, route: c.route, filter: spaceFilter(c, a.timezone) });
  }

  let filterRequest = -1;
  /** The filters as the worker reads them: the latest end from your plan's, windows as unix spans in
   *  the answer's zone. */
  function spaceFilter(c: Comparison, timezone: string): SpaceFilter {
    const f = c.filter;
    const windows = f.windows.flatMap(w => {
      const day = getLocalTimestampInTimezone(w.date, '00:00', timezone);
      const days = Math.max(0, Number(w.days) || 0);
      return Number.isFinite(day) ? [[day - days * 86400, day + (days + 1) * 86400] as [number, number]] : [];
    });
    return {
      limit: c.route.end + Math.max(0, Number(f.slackDays) || 0) * 86400,
      minGap: Number.isFinite(f.minGap) ? f.minGap : 0,
      maxGap: Number.isFinite(f.maxGap) ? f.maxGap : MAX_TE,
      windows,
    };
  }

  /** Apply the filters: in the worker's chains, or, when they let through anything the search left out
   *  (more days slower, wider TE gaps, a window fewer), or it stopped early and they now ask for less,
   *  after finding the chains again. */
  function filterSpace(): void {
    const a = answer.value;
    const c = comparison.value;
    if (!a || !c?.space || c.status === 'finding') return;
    const f = spaceFilter(c, a.timezone);
    const was = c.space.searched;
    const span = (w: [number, number]) => w.join('-');
    const wider =
      f.limit > was.limit ||
      f.minGap < was.minGap ||
      f.maxGap > was.maxGap ||
      was.windows.some(w => !f.windows.map(span).includes(span(w)));
    if (wider || (c.space.capped && JSON.stringify(f) !== JSON.stringify(was))) return findSpace();
    pending.delete(filterRequest);
    const requestId = (filterRequest = nextRequestId++);
    pending.set(requestId, r => {
      const live = still(c);
      if (!live || filterRequest !== requestId) return pending.delete(requestId);
      if (r.type === 'progress') {
        if (r.stage === 'waits') live.progress = { stage: 'waits', done: r.done, of: r.of };
        return;
      }
      if (r.type === 'filtered') {
        Object.assign(live, {
          matches: r.matches,
          routes: r.routes && markRaw(r.routes),
          waited: null,
          waits: r.waits ? 'running' : 'none',
          perWait: r.perWait,
          progress: null,
        });
        if (!r.waits) pending.delete(requestId);
        return;
      }
      pending.delete(requestId);
      live.progress = null;
      if (r.type === 'waited') Object.assign(live, { waited: markRaw(r.routes), waits: 'done' });
      else if (r.type === 'error') Object.assign(live, { status: 'error', error: r.message });
    });
    send({ kind: 'filter', requestId, filter: f, show: SHOW_LIMIT });
  }

  // Filtering again a moment after the filters stop changing.
  let filterTimer: ReturnType<typeof setTimeout> | undefined;
  watch(
    () => comparison.value && JSON.stringify(comparison.value.filter),
    (now, was) => {
      if (!now || !was) return;
      clearTimeout(filterTimer);
      filterTimer = setTimeout(filterSpace, 300);
    }
  );

  function closeComparison(): void {
    comparison.value = null;
    answerCollapsed.value = false;
  }

  return {
    mode,
    targetTE,
    deadlineDate,
    deadlineTime,
    timezone,
    startMode,
    hypotheticalStart,
    hypotheticalTE,
    hypotheticalDate,
    hypotheticalTime,
    ascensionCounts,
    avoidDates,
    blockedHours,
    avoidChanged,
    waitForEggs,
    waitsChanged,
    countsPastAnswer,
    header,
    headerWarnings,
    simChanges,
    tableSource,
    tableNote,
    tableStatus,
    status,
    progress,
    answer,
    error,
    comparison,
    answerCollapsed,
    exploreSimilar,
    closeComparison,
    current,
    detect,
    backup,
    refreshing,
    refreshBackup,
    onSaveLoaded,
    fromSave,
    saveTE,
    startTE,
    earningsShift,
    loadout,
    defaultLoadout,
    deliveryMatches,
    artifactsChanged,
    deadline,
    problem,
    loadTable,
    loadFile,
    search,
  };
});
