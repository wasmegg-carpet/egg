import { ref } from 'vue';
import type { Action } from '@planner/types';
import { smartBuyNoteByActionId } from '../actions/smartBuyGroups';

/**
 * Note ids of the smart buy groups currently expanded in action history. Module-level rather than
 * local to each row, so a summary link can open the group holding its target action, and a group
 * stays open when its day is collapsed and reopened.
 */
export const expandedSmartBuyNoteIds = ref(new Set<string>());

export function setSmartBuyExpanded(noteId: string, value: boolean) {
  if (value) {
    expandedSmartBuyNoteIds.value.add(noteId);
  } else {
    expandedSmartBuyNoteIds.value.delete(noteId);
  }
}

/** Opens the smart buy group holding `actionId`, if any, so that action's row gets rendered. */
export function expandSmartBuyContaining(actions: Action[], actionId: string) {
  const note = smartBuyNoteByActionId(actions).get(actionId);
  if (note) setSmartBuyExpanded(note.id, true);
}
