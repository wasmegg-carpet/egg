import { describe, expect, test } from 'vitest';
import type { Action } from '@planner/types';
import {
  buildMaxResearchNotePayload,
  buildMilestoneNotePayload,
  buildQuickBuyNotePayload,
  parseSmartBuyPurchaseCount,
} from './notes';
import { groupSmartBuys } from './smartBuyGroups';

let nextId = 0;

function action(type: Action['type'], extra: Partial<Action> = {}): Action {
  return { id: `a${nextId++}`, type, payload: {}, cost: 0, totalTimeSeconds: 0, ...extra } as Action;
}

function note(purchaseCount: number): Action {
  return action('notification', { payload: buildQuickBuyNotePayload(1, purchaseCount, 60, 100)! });
}

const buy = (cost = 10, totalTimeSeconds = 5) => action('buy_research', { cost, totalTimeSeconds });

function summarize(actions: Action[]) {
  return groupSmartBuys(actions).map(row => (row.kind === 'smart_buy' ? row.group.actions.length : 'single'));
}

describe('parseSmartBuyPurchaseCount', () => {
  test('reads the count from what the note builders write', () => {
    expect(parseSmartBuyPurchaseCount(buildQuickBuyNotePayload(1, 1, 60, 100)!)).toBe(1);
    expect(parseSmartBuyPurchaseCount(buildMilestoneNotePayload('Unlock Tier 8', 12, 60, 100)!)).toBe(12);
    expect(parseSmartBuyPurchaseCount(buildMaxResearchNotePayload('Max Tier 3', 1)!)).toBe(1);
    expect(parseSmartBuyPurchaseCount(buildMaxResearchNotePayload('Max Tier 3', 40)!)).toBe(40);
  });

  test('a Max button with nothing left to buy writes no note', () => {
    expect(buildMaxResearchNotePayload('Max Tier 3', 0)).toBeNull();
  });

  test('ignores other notes', () => {
    expect(parseSmartBuyPurchaseCount({ message: 'Remember to launch' })).toBeNull();
    expect(parseSmartBuyPurchaseCount({ message: 'x', submessage: 'buy 3 purchases over 1h' })).toBeNull();
  });
});

describe('groupSmartBuys', () => {
  test('groups a note with its purchases and totals them', () => {
    const [row] = groupSmartBuys([note(2), buy(10, 5), buy(20, 7)]);
    expect(row.kind).toBe('smart_buy');
    if (row.kind !== 'smart_buy') return;
    expect(row.group.purchaseCount).toBe(2);
    expect(row.group.totalCost).toBe(30);
    expect(row.group.totalTimeSeconds).toBe(12);
  });

  test('includes event waits between purchases', () => {
    expect(summarize([note(2), buy(), action('wait_for_research_sale'), action('toggle_sale'), buy()])).toEqual([5]);
  });

  test('leaves purchases beyond the reported count outside the group', () => {
    expect(summarize([note(1), buy(), buy()])).toEqual([2, 'single']);
  });

  test('leaves a wait after the last purchase outside the group', () => {
    expect(summarize([note(2), buy(), action('wait_for_time')])).toEqual([2, 'single']);
  });

  test('stops at an action a sweep would not insert', () => {
    expect(summarize([note(2), buy(), action('buy_hab'), buy()])).toEqual([2, 'single', 'single']);
  });

  test('leaves a note whose purchases were all undone as a plain row', () => {
    expect(summarize([note(2), action('buy_hab')])).toEqual(['single', 'single']);
    expect(summarize([note(2)])).toEqual(['single']);
  });

  test('groups consecutive sweeps separately', () => {
    expect(summarize([note(1), buy(), note(2), buy(), buy()])).toEqual([2, 3]);
  });
});
