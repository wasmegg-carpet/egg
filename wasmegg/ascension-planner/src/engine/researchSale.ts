import type { Action, CalculationsSnapshot } from '@/types';
import { BOUNDARY_EPSILON_SECONDS, isResearchSaleActive } from '@/lib/events';

/**
 * The manual planner's research sale is a function of sim time, not stored state: on from Friday
 * 9 AM to Saturday 9 AM Pacific, off otherwise. Every replay path stamps this onto each action's
 * snapshot, so `toggle_sale` actions for research (still present in older plans and in auto-planner
 * output) have no lasting effect there.
 *
 * Epsilon-shifted because a wait timed to land on a boundary can end a fraction of a second short of
 * it — see `BOUNDARY_EPSILON_SECONDS`'s doc comment.
 */
export function isResearchSaleAtSimTime(
  lastStepTime: number,
  ascensionStartTime: number,
  planStartOffset: number
): boolean {
  return isResearchSaleActive(ascensionStartTime + (lastStepTime - planStartOffset) + BOUNDARY_EPSILON_SECONDS);
}

/** `snapshot` with `activeSales.research` set from its own sim time. */
export function withCalendarResearchSale(
  snapshot: CalculationsSnapshot,
  ascensionStartTime: number,
  planStartOffset: number
): CalculationsSnapshot {
  return {
    ...snapshot,
    activeSales: {
      ...snapshot.activeSales,
      research: isResearchSaleAtSimTime(snapshot.lastStepTime, ascensionStartTime, planStartOffset),
    },
  };
}

/**
 * Whether any action's stored result disagrees with the calendar — true of plans saved before the
 * sale was derived from sim time. Their stored prices and timings can't be trusted, so loading one
 * has to recalculate it rather than reuse those results.
 */
export function hasStaleResearchSaleFlags(actions: Action[], ascensionStartTime: number): boolean {
  const planStartOffset = actions.find(a => a.type === 'start_ascension')?.endState?.lastStepTime ?? 0;
  return actions.some(
    a =>
      a.endState?.activeSales !== undefined &&
      a.endState.activeSales.research !==
        isResearchSaleAtSimTime(a.endState.lastStepTime, ascensionStartTime, planStartOffset)
  );
}
