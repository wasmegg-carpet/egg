import { defineStore } from 'pinia';
import { ref } from 'vue';

export type PlannerTab = 'manual' | 'automatic' | 'chainFinder' | 'tableBuilder';

/**
 * Each tab's name in the page URL (`?tab=`), so a refresh or a shared link opens the same tab. The
 * manual planner, the default, has none. A query parameter rather than a path: the host needs no
 * rewrite rule for it, and `?playerId=` already works this way.
 */
const TAB_SLUGS: Record<Exclude<PlannerTab, 'manual'>, string> = {
  automatic: 'auto-planner',
  chainFinder: 'chain-finder',
  tableBuilder: 'table-builder',
};

/** Names links used before the tabs were renamed: the Chain Finder was "Instant Search". */
const OLD_SLUGS: Record<string, PlannerTab> = { 'instant-search': 'chainFinder' };

/** The tab a query string names, or 'manual' when it names none (or one that doesn't exist). */
export function tabFromSearch(search: string): PlannerTab {
  const slug = new URLSearchParams(search).get('tab');
  const hit = (Object.entries(TAB_SLUGS) as [PlannerTab, string][]).find(([, s]) => s === slug);
  return hit ? hit[0] : (slug && OLD_SLUGS[slug]) || 'manual';
}

/** `search` with its `tab` set to `tab`'s (removed for the manual planner), other parameters kept. */
export function searchWithTab(search: string, tab: PlannerTab): string {
  const params = new URLSearchParams(search);
  if (tab === 'manual') params.delete('tab');
  else params.set('tab', TAB_SLUGS[tab]);
  const out = params.toString();
  return out ? `?${out}` : '';
}

export const useUIStore = defineStore('ui', () => {
  const plannerTab = ref<PlannerTab>('manual');
  const isHeaderCollapsed = ref(false);
  const isFooterCollapsed = ref(false);
  const loading = ref(false);
  const error = ref('');

  function setActiveTab(tab: PlannerTab) {
    plannerTab.value = tab;
  }

  function setHeaderCollapsed(collapsed: boolean) {
    isHeaderCollapsed.value = collapsed;
  }

  function setLoading(l: boolean) {
    loading.value = l;
  }

  function setError(e: string) {
    error.value = e;
  }

  return {
    plannerTab,
    isHeaderCollapsed,
    isFooterCollapsed,
    loading,
    error,
    setActiveTab,
    setHeaderCollapsed,
    setLoading,
    setError,
  };
});
