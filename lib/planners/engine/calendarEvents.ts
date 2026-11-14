import type { BaseCalculationsSnapshot } from '../types/actions/core';
import { BOUNDARY_EPSILON_SECONDS, isEarningsBoostActive, isResearchSaleActive } from '../events';
import { EARNINGS_BOOST_MULTIPLIER } from './apply/math';

/**
 * The manual planners' research sale and 2x earnings are functions of sim time, not stored state: the
 * sale runs Friday 9 AM to Saturday 9 AM Pacific and 2x earnings Monday 9 AM to Tuesday 9 AM. Every
 * replay path applies these, so `toggle_sale` (research) and `toggle_earnings_boost` actions, still
 * present in older plans and in auto-planner output, have no lasting effect there.
 *
 * Epsilon-shifted because a wait timed to land on a boundary can end a fraction of a second short of
 * it — see `BOUNDARY_EPSILON_SECONDS`'s doc comment.
 */
function absoluteBoundaryTime(lastStepTime: number, ascensionStartTime: number, planStartOffset: number): number {
  return ascensionStartTime + (lastStepTime - planStartOffset) + BOUNDARY_EPSILON_SECONDS;
}

export function isResearchSaleAtSimTime(
  lastStepTime: number,
  ascensionStartTime: number,
  planStartOffset: number
): boolean {
  return isResearchSaleActive(absoluteBoundaryTime(lastStepTime, ascensionStartTime, planStartOffset));
}

export function isEarningsBoostAtSimTime(
  lastStepTime: number,
  ascensionStartTime: number,
  planStartOffset: number
): boolean {
  return isEarningsBoostActive(absoluteBoundaryTime(lastStepTime, ascensionStartTime, planStartOffset));
}

/** `snapshot` with `activeSales.research` set from its own sim time. */
export function withCalendarResearchSale<S extends Pick<BaseCalculationsSnapshot, 'lastStepTime' | 'activeSales'>>(
  snapshot: S,
  ascensionStartTime: number,
  planStartOffset: number
): S {
  return {
    ...snapshot,
    activeSales: {
      ...snapshot.activeSales,
      research: isResearchSaleAtSimTime(snapshot.lastStepTime, ascensionStartTime, planStartOffset),
    },
  };
}

/**
 * `state` with `earningsBoost` set from its own sim time. Applied to the engine state rather than the
 * finished snapshot, because `computeSnapshot` builds the earnings rate from this flag.
 */
export function withCalendarEarningsBoost<S extends Pick<BaseCalculationsSnapshot, 'lastStepTime' | 'earningsBoost'>>(
  state: S,
  ascensionStartTime: number,
  planStartOffset: number
): S {
  const active = isEarningsBoostAtSimTime(state.lastStepTime, ascensionStartTime, planStartOffset);
  return { ...state, earningsBoost: { active, multiplier: active ? EARNINGS_BOOST_MULTIPLIER : 1 } };
}

interface StoredAction {
  type: string;
  endState?: Pick<BaseCalculationsSnapshot, 'lastStepTime' | 'activeSales' | 'earningsBoost'>;
}

function planStartOffsetOf(actions: StoredAction[]): number {
  return actions.find(a => a.type === 'start_ascension')?.endState?.lastStepTime ?? 0;
}

/**
 * Whether any action's stored result disagrees with the calendar — true of plans saved before the
 * sale was derived from sim time. Their stored prices and timings can't be trusted, so loading one
 * has to recalculate it rather than reuse those results.
 */
export function hasStaleResearchSaleFlags(actions: StoredAction[], ascensionStartTime: number): boolean {
  const planStartOffset = planStartOffsetOf(actions);
  return actions.some(
    a =>
      a.endState?.activeSales !== undefined &&
      a.endState.activeSales.research !==
        isResearchSaleAtSimTime(a.endState.lastStepTime, ascensionStartTime, planStartOffset)
  );
}

/** The same check for 2x earnings, for plans saved before it was derived from sim time. */
export function hasStaleEarningsBoostFlags(actions: StoredAction[], ascensionStartTime: number): boolean {
  const planStartOffset = planStartOffsetOf(actions);
  return actions.some(
    a =>
      a.endState?.earningsBoost !== undefined &&
      a.endState.earningsBoost.active !==
        isEarningsBoostAtSimTime(a.endState.lastStepTime, ascensionStartTime, planStartOffset)
  );
}
