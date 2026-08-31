import { ref, watch } from 'vue';

const STORAGE_KEY = 'ascension_compact_action_history';

function loadStoredCompactActionHistory(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  // Default to compact for anyone who hasn't chosen yet; respect an explicit past choice either way.
  return stored === null ? true : stored === 'true';
}

/**
 * Whether the Action History list renders in compact mode (minimal, bullet-list-style rows)
 * instead of the full card layout. A single module-level ref so the slide toggle in App.vue and
 * every ActionHistoryItem/ActionGroup consumer stay in sync, persisted so it survives reloads.
 */
export const compactActionHistory = ref(loadStoredCompactActionHistory());
watch(compactActionHistory, v => localStorage.setItem(STORAGE_KEY, String(v)));
