/**
 * @module autoPlannerFormCache
 * @description localStorage-backed persistence for the Auto-AP input form (start
 * date/time/timezone, target TE(s), and per-egg starting TE inputs), so the form
 * survives a full page reload instead of resetting every time. Follows the same
 * bare localStorage pattern used elsewhere in this app (see useResearchViews.ts).
 */

import type { VirtueEgg } from '@/types';
import type { AutoLoadoutInputs } from '@/auto/loadout/types';

const SCHEDULE_STORAGE_KEY = 'auto_planner_schedule_v1';
// v2: only written while the TE override is on (v1 cached every edit, including ones matching the
// backup), so a v1 entry can't tell us whether the user meant to override.
const TE_INPUTS_STORAGE_KEY_PREFIX = 'auto_planner_te_inputs_v2';

export interface AutoPlannerScheduleCache {
  timezone: string;
  startDate: string;
  startTime: string;
  /** Absent in caches written before the start-time override existed — treated as "now". */
  startTimeOverride?: boolean;
  targetTE: string;
  deferForEarningsMode?: boolean;
}

export function loadAutoPlannerSchedule(): Partial<AutoPlannerScheduleCache> | null {
  try {
    const raw = localStorage.getItem(SCHEDULE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveAutoPlannerSchedule(data: AutoPlannerScheduleCache): void {
  try {
    localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota/privacy-mode errors — persistence is a nicety, not a requirement.
  }
}

export interface AutoPlannerTEInputsCache {
  /** The TE override's claimed TE per egg. */
  teEarned: Record<VirtueEgg, number>;
}

function teInputsStorageKey(playerId: string): string {
  return `${TE_INPUTS_STORAGE_KEY_PREFIX}:${playerId}`;
}

// Tracks which players' cached TE inputs have already been consumed this page load. A cached
// value should only ever be pulled in once per load (to survive an actual page reload) — not
// every time the Auto tab remounts (e.g. toggling Auto/Manual), or it clobbers whatever fresher
// state (backup refresh, plan import, Manual-mode edits) is currently in the store.
const consumedPlayerIds = new Set<string>();

/**
 * Returns the cached TE inputs for this player the first time it's called for them in this page
 * load, and `null` on every call after that (even if the underlying localStorage value changes).
 */
export function consumeAutoPlannerTEInputs(playerId: string): AutoPlannerTEInputsCache | null {
  if (!playerId || consumedPlayerIds.has(playerId)) return null;
  consumedPlayerIds.add(playerId);
  try {
    const raw = localStorage.getItem(teInputsStorageKey(playerId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Persists the TE override for this player, or clears it (`null`) when the override is removed.
 * Call this only from actual user actions (editing a TE field, adding/removing the override) —
 * never from a generic watcher — so values that changed for other reasons (plan import, Chain
 * Finder handoff) don't get cached as if they were user input.
 */
export function saveAutoPlannerTEInputs(playerId: string, data: AutoPlannerTEInputsCache | null): void {
  if (!playerId) return;
  try {
    if (data) localStorage.setItem(teInputsStorageKey(playerId), JSON.stringify(data));
    else localStorage.removeItem(teInputsStorageKey(playerId));
  } catch {
    // Ignore quota/privacy-mode errors — persistence is a nicety, not a requirement.
  }
}

const LOADOUT_INPUTS_STORAGE_KEY_PREFIX = 'auto_planner_loadout_inputs_v1';
const consumedLoadoutPlayerIds = new Set<string>();

function loadoutInputsStorageKey(playerId: string): string {
  return `${LOADOUT_INPUTS_STORAGE_KEY_PREFIX}:${playerId}`;
}

/**
 * Cached artifact/stone setup inputs for this player — same consume-once-per-page-load contract as
 * `consumeAutoPlannerTEInputs`.
 */
export function consumeAutoPlannerLoadoutInputs(playerId: string): AutoLoadoutInputs | null {
  if (!playerId || consumedLoadoutPlayerIds.has(playerId)) return null;
  consumedLoadoutPlayerIds.add(playerId);
  try {
    const raw = localStorage.getItem(loadoutInputsStorageKey(playerId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Persists artifact/stone setup inputs. Like `saveAutoPlannerTEInputs`, call only from user edits. */
export function saveAutoPlannerLoadoutInputs(playerId: string, data: AutoLoadoutInputs | null): void {
  if (!playerId) return;
  try {
    if (data) localStorage.setItem(loadoutInputsStorageKey(playerId), JSON.stringify(data));
    else localStorage.removeItem(loadoutInputsStorageKey(playerId));
  } catch {
    // Ignore quota/privacy-mode errors — persistence is a nicety, not a requirement.
  }
}
