/**
 * @module autoPlannerFormCache
 * @description localStorage-backed persistence for the Auto-AP input form (start
 * date/time/timezone, target TE(s), and per-egg starting TE inputs), so the form
 * survives a full page reload instead of resetting every time. Follows the same
 * bare localStorage pattern used elsewhere in this app (see useResearchViews.ts).
 */

import type { VirtueEgg } from '@/types';

const SCHEDULE_STORAGE_KEY = 'auto_planner_schedule_v1';
const TE_INPUTS_STORAGE_KEY_PREFIX = 'auto_planner_te_inputs_v1';

export interface AutoPlannerScheduleCache {
  timezone: string;
  startDate: string;
  startTime: string;
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
  teEarned: Partial<Record<VirtueEgg, number>>;
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
 * Persists TE inputs for this player. Call this only from actual user actions (editing a TE
 * field, resetting to defaults) — never from a generic watcher — so values that changed for
 * other reasons (backup refresh, plan import, Manual-mode sync) don't get cached as if they were
 * user input.
 */
export function saveAutoPlannerTEInputs(playerId: string, data: AutoPlannerTEInputsCache): void {
  if (!playerId) return;
  try {
    localStorage.setItem(teInputsStorageKey(playerId), JSON.stringify(data));
  } catch {
    // Ignore quota/privacy-mode errors — persistence is a nicety, not a requirement.
  }
}
