// State for the inline mission optimizer in the Rockets tab: whether it is open, what each Humility visit
// is being solved for, the save its ships and inventory come from, and the last answer. Kept in a store so
// all of it survives switching tabs, which unmounts the card.

import { defineStore } from 'pinia';
import { ref, shallowRef, watch } from 'vue';

import { ei, getLocalStorage, getSavedPlayerID, requestFirstContact, setLocalStorage } from 'lib';
import { isEffortLevel } from 'lib/mission-optimizer/effort';
import { readPlayerData, type PlayerData } from 'lib/mission-optimizer/player-data';
import type { OptimizerSolution } from 'lib/mission-optimizer/types';
import type { HumilityVisit } from 'lib/mission-optimizer/plan/read';
import { normalizeScheduleSettings } from 'lib/mission-optimizer/schedule-settings';

import { newVisitSettings, type OptimizerVisitSettings } from '@/lib/humilityOptimizer';
import { useInitialStateStore } from './initialState';

const STORAGE_KEY = 'humility_optimizer';
const STORAGE_VERSION = 1;
// Visit ids are action ids, so entries from plans long gone would otherwise pile up forever.
const MAX_STORED_VISITS = 40;

interface Persisted {
  version: number;
  // What a visit nobody has configured yet starts from: the choices made for the last one.
  template: OptimizerVisitSettings;
  visits: Record<string, OptimizerVisitSettings>;
}

/** One answer, with the question it answers so a stale one is never shown against new inputs. */
export interface SolvedVisit {
  visitId: string;
  key: string;
  solution: OptimizerSolution;
  timeSeconds: number;
  gemBudget: number;
  effort: string;
  player: PlayerData;
}

function normalize(stored: Partial<OptimizerVisitSettings> | undefined): OptimizerVisitSettings {
  const base = newVisitSettings();
  if (!stored || typeof stored !== 'object') return base;
  return {
    targetIds: Array.isArray(stored.targetIds) ? stored.targetIds.filter(id => typeof id === 'string') : [],
    duration: typeof stored.duration === 'string' ? stored.duration : base.duration,
    effort: isEffortLevel(stored.effort) ? stored.effort : base.effort,
    fuelBudget: stored.fuelBudget === 'full-tank' ? 'full-tank' : 'banked',
    gemLimit: stored.gemLimit === 'unlimited' ? 'unlimited' : 'plan',
    capCrafting: stored.capCrafting === true,
    ...normalizeScheduleSettings(stored),
  };
}

function load(): Persisted {
  const empty: Persisted = { version: STORAGE_VERSION, template: newVisitSettings(), visits: {} };
  const raw = getLocalStorage(STORAGE_KEY);
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed || parsed.version !== STORAGE_VERSION) return empty;
    const visits: Record<string, OptimizerVisitSettings> = {};
    for (const [id, value] of Object.entries(parsed.visits ?? {})) visits[id] = normalize(value);
    return { version: STORAGE_VERSION, template: normalize(parsed.template), visits };
  } catch {
    return empty;
  }
}

// A plan loaded from the library carries a redacted backup: inventory, but no launch history to read
// ship levels from and no crafting progress. Only a save fetched from the game answers those.
function isFullBackup(backup: ei.IBackup | null): backup is ei.IBackup {
  return !!backup?.artifacts && !!backup.artifactsDb && !!backup.game;
}

export const useHumilityOptimizerStore = defineStore('humilityOptimizer', () => {
  const open = ref(false);
  const persisted = ref<Persisted>(load());

  watch(persisted, value => setLocalStorage(STORAGE_KEY, JSON.stringify(value)), { deep: true });

  /**
   * What the visit is being solved for: its own choices, or the last ones made for any visit. Never writes,
   * so it is safe to call from a computed.
   *
   * The time the plan already spends on Humility is deliberately not a starting point here, as it is in
   * the explorer: inline, the missions are what is about to be scheduled, and what the plan has there
   * before them is the wait for the habs to refill.
   */
  function settingsFor(visit: HumilityVisit): OptimizerVisitSettings {
    return persisted.value.visits[visit.visitId] ?? persisted.value.template;
  }

  /**
   * Gives the visit its own copy of the settings it is showing. Called once a question is posed for it,
   * so that what it was solved for stays put when another visit's choices move the template.
   */
  function pin(visit: HumilityVisit) {
    if (!persisted.value.visits[visit.visitId]) update(visit, {});
  }

  function update(visit: HumilityVisit, patch: Partial<OptimizerVisitSettings>) {
    const next = { ...settingsFor(visit), ...patch };
    const visits = { ...persisted.value.visits };
    // Re-inserted so the most recently touched visit is the last one dropped.
    delete visits[visit.visitId];
    visits[visit.visitId] = next;
    const ids = Object.keys(visits);
    for (const stale of ids.slice(0, Math.max(0, ids.length - MAX_STORED_VISITS))) delete visits[stale];
    persisted.value = { version: STORAGE_VERSION, template: { ...next }, visits };
  }

  // The player's ships, inventory and crafting progress. Held apart from the planner's own backup, which
  // a library plan replaces with its redacted copy.
  const player = shallowRef<PlayerData | null>(null);
  // Bumped with every save taken, so an answer solved against an older one is known to be stale.
  const playerRevision = ref(0);
  const saveLoading = ref(false);
  const saveError = ref('');

  function takeBackup(backup: ei.IBackup | null) {
    if (!isFullBackup(backup)) return;
    const data = readPlayerData(backup);
    if (!data) return;
    player.value = data;
    playerRevision.value++;
  }

  const initialState = useInitialStateStore();
  watch(() => initialState.rawBackup, takeBackup, { immediate: true });

  async function loadSave() {
    const playerId = getSavedPlayerID();
    if (!playerId) {
      saveError.value = 'Enter your player ID at the top of the page first.';
      return;
    }
    saveLoading.value = true;
    saveError.value = '';
    try {
      const response = await requestFirstContact(playerId);
      if (!isFullBackup(response.backup ?? null)) throw new Error('that save has no artifact data in it');
      takeBackup(response.backup ?? null);
    } catch (err) {
      saveError.value = `Could not load your save: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      saveLoading.value = false;
    }
  }

  const solved = shallowRef<SolvedVisit | null>(null);

  // What was last staged for each visit in this session: the question it answered and whether the
  // earnings set was swapped in. The plan's launch alone cannot tell two answers with the same ships
  // apart, such as the same ship set at a different effort.
  const stagedAnswers = ref<Record<string, { key: string; swap: boolean }>>({});

  return {
    open,
    settingsFor,
    pin,
    update,
    player,
    playerRevision,
    saveLoading,
    saveError,
    loadSave,
    solved,
    stagedAnswers,
  };
});
