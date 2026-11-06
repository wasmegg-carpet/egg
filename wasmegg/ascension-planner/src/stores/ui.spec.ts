import { describe, expect, it } from 'vitest';
import { searchWithTab, tabFromSearch } from './ui';

describe('tab URLs', () => {
  it('reads the tab from the query string, the manual planner when there is none', () => {
    expect(tabFromSearch('?tab=chain-finder')).toBe('chainFinder');
    expect(tabFromSearch('?tab=table-builder')).toBe('tableBuilder');
    // A link from before the rename: Instant Search is now the Chain Finder.
    expect(tabFromSearch('?tab=instant-search')).toBe('chainFinder');
    expect(tabFromSearch('?playerId=EI123&tab=auto-planner')).toBe('automatic');
    expect(tabFromSearch('')).toBe('manual');
    expect(tabFromSearch('?tab=nonsense')).toBe('manual');
  });

  it('sets the tab and keeps the other parameters', () => {
    expect(searchWithTab('?playerId=EI123', 'chainFinder')).toBe('?playerId=EI123&tab=chain-finder');
    expect(searchWithTab('?playerId=EI123&tab=chain-finder', 'tableBuilder')).toBe('?playerId=EI123&tab=table-builder');
    expect(searchWithTab('?playerId=EI123&tab=chain-finder', 'manual')).toBe('?playerId=EI123');
    expect(searchWithTab('?tab=auto-planner', 'manual')).toBe('');
  });

  it('round-trips every tab', () => {
    for (const tab of ['manual', 'automatic', 'chainFinder', 'tableBuilder'] as const)
      expect(tabFromSearch(searchWithTab('', tab))).toBe(tab);
  });
});
