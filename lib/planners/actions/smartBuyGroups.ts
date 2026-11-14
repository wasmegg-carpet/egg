import type { Action } from '@planner/types';
import { parseSmartBuyPurchaseCount } from './notes';

/**
 * Action types a smart buy inserts between its purchases, one wait+toggle pair per sale or boost
 * boundary a purchase's own wait passes through.
 */
export const EVENT_CROSSING_ACTION_TYPES = new Set<Action['type']>([
  'wait_for_time',
  'wait_for_research_sale',
  'wait_for_research_sale_end',
  'wait_for_earnings_boost',
  'wait_for_earnings_boost_end',
  'toggle_sale',
  'toggle_earnings_boost',
]);

export interface SmartBuyGroup {
  note: Action<'notification'>;
  /** The note, then everything the sweep did, in history order. */
  actions: Action[];
  purchaseCount: number;
  totalCost: number;
  totalTimeSeconds: number;
}

export type ActionRow = { kind: 'action'; action: Action } | { kind: 'smart_buy'; group: SmartBuyGroup };

/**
 * Finds the sweep starting at `actions[noteIndex]`, or null if that action isn't a smart buy note
 * with at least one purchase still following it.
 *
 * Derived from the history rather than stored on the actions, so plans saved before this existed
 * group too. A sweep runs from its note through its last purchase: it stops once it has as many
 * purchases as the note reported, or at the first action a sweep wouldn't insert. Waits after the
 * last purchase aren't included, since nothing distinguishes them from a wait the player added.
 */
function findSmartBuyGroup(actions: Action[], noteIndex: number): SmartBuyGroup | null {
  const note = actions[noteIndex];
  if (note.type !== 'notification') return null;
  const expectedPurchases = parseSmartBuyPurchaseCount(note.payload as Action<'notification'>['payload']);
  if (expectedPurchases === null) return null;

  let purchaseCount = 0;
  let lastPurchaseIndex = noteIndex;
  for (let i = noteIndex + 1; i < actions.length && purchaseCount < expectedPurchases; i++) {
    const action = actions[i];
    if (action.type === 'buy_research') {
      purchaseCount++;
      lastPurchaseIndex = i;
    } else if (!EVENT_CROSSING_ACTION_TYPES.has(action.type)) {
      break;
    }
  }
  if (purchaseCount === 0) return null;

  const groupActions = actions.slice(noteIndex, lastPurchaseIndex + 1);
  return {
    note: note as Action<'notification'>,
    actions: groupActions,
    purchaseCount,
    totalCost: groupActions.reduce((sum, a) => sum + Math.max(a.cost || 0, 0), 0),
    totalTimeSeconds: groupActions.reduce((sum, a) => sum + (a.totalTimeSeconds || 0), 0),
  };
}

/** Maps every action inside a smart buy group, the note included, to that group's note. */
export function smartBuyNoteByActionId(actions: Action[]): Map<string, Action> {
  const notes = new Map<string, Action>();
  for (const row of groupSmartBuys(actions)) {
    if (row.kind !== 'smart_buy') continue;
    for (const action of row.group.actions) notes.set(action.id, row.group.note);
  }
  return notes;
}

/** Splits a history list into plain rows and smart buy groups, preserving order. */
export function groupSmartBuys(actions: Action[]): ActionRow[] {
  const rows: ActionRow[] = [];
  let i = 0;
  while (i < actions.length) {
    const group = findSmartBuyGroup(actions, i);
    if (group) {
      rows.push({ kind: 'smart_buy', group });
      i += group.actions.length;
    } else {
      rows.push({ kind: 'action', action: actions[i] });
      i++;
    }
  }
  return rows;
}
