import type { Ref } from 'vue';
import type { BaseCalculationsSnapshot } from '../types/actions/core';
import { findEventCrossings, type EventCrossing, type PurchaseEventCrossings } from '../calculations/eventCrossings';
import { boostTransitionsFrom, getTimeToSave } from '../engine/apply/math';
import { BOUNDARY_EPSILON_SECONDS, isEarningsBoostActive } from '../events';
import type { EventWaitType } from './useEventWaits';

export type CrossingWaitType = EventWaitType | 'wait_for_no_earnings' | 'wait_for_time';

export interface CrossingWaitAction {
  id: string;
  timestamp: number;
  type: CrossingWaitType;
  payload: { totalTimeSeconds: number };
  cost: number;
  dependsOn: string[];
}

/** What each planner supplies; its stores, action types and research pricing differ. */
export interface EventCrossingWaitsDeps<S extends BaseCalculationsSnapshot, A, R extends { id: string }> {
  prepareExecution: () => S;
  completeExecution: (action: A | CrossingWaitAction, before: S) => Promise<void>;
  batch: (callback: () => Promise<void> | void) => Promise<void>;
  isEditingPastGroup: Readonly<Ref<boolean>>;
  generateId: () => string;
  dependenciesFor: (type: CrossingWaitType, payload: { totalTimeSeconds: number }) => string[];
  planTiming: () => { ascensionStartTime: number; planStartOffset: number };
  crossingsForPurchase: (research: R, level: number, snapshot: S) => PurchaseEventCrossings | null;
}

/**
 * Inserts the wait actions that carry a plan across sale and boost boundaries, and hands out the
 * executor they share with the purchase that follows.
 *
 * Inserting into a past group finishes asynchronously, so a loop buying several things has to await
 * `settled()` between purchases when `isEditingPastGroup` is set, or the next purchase works out its
 * crossings from a state missing the last one and adds the same wait again.
 */
export function useEventCrossingWaits<S extends BaseCalculationsSnapshot, A, R extends { id: string }>(
  deps: EventCrossingWaitsDeps<S, A, R>
) {
  const { prepareExecution, batch, isEditingPastGroup } = deps;
  let lastExecution: Promise<unknown> = Promise.resolve();
  function completeExecution(action: A | CrossingWaitAction, before: S) {
    const execution = deps.completeExecution(action, before);
    lastExecution = Promise.all([lastExecution, execution]);
    return execution;
  }
  const settled = () => lastExecution;

  function absoluteTimeOf(snapshot: S): number {
    const { ascensionStartTime, planStartOffset } = deps.planTiming();
    return ascensionStartTime + (snapshot.lastStepTime - planStartOffset);
  }

  /** Inserts a wait action of the given type/duration, returning its id (or undefined if seconds <= 0). */
  function insertWait(type: CrossingWaitType, seconds: number, beforeSnapshot: S): string | undefined {
    if (seconds <= 0) return undefined;
    const id = deps.generateId();
    const payload = { totalTimeSeconds: seconds };
    completeExecution(
      {
        id,
        timestamp: Date.now(),
        type,
        payload,
        cost: 0,
        dependsOn: deps.dependenciesFor(type, payload),
      },
      beforeSnapshot
    );
    return id;
  }

  /**
   * Shared by `syncEventStateForItem` (crossings up to a purchase's own wait) and `advanceToDeadline`
   * (crossings up to a fixed target time with no purchase attached): merges the sale and boost
   * crossing lists into true chronological order and inserts a wait action for each one.
   * See `syncEventStateForItem`'s git history for why merging matters — treating sale and boost as two
   * independent sequential passes silently drops a boost window that falls entirely inside a
   * sale-wait period.
   *
   * Each list's `waitSeconds` is relative to its own previous crossing (or to `absoluteSimTime` for
   * the first) — convert both to absolute timestamps first so they can be merged regardless of which
   * type occurs first. Returns the snapshot and absolute time reached after the last crossing (equal
   * to `absoluteSimTime` itself, with the input snapshot, if there were no crossings at all).
   */
  function insertEventCrossingWaits(
    absoluteSimTime: number,
    crossings: { sale: EventCrossing[]; boost: EventCrossing[] },
    beforeSnapshot: S,
    boostWaitOverride?: 'wait_for_no_earnings'
  ): { snapshot: S; cursor: number } {
    type TaggedCrossing = { absoluteTime: number; togglesTo: boolean; kind: 'sale' | 'boost' };
    const toTagged = (list: EventCrossing[], kind: TaggedCrossing['kind']): TaggedCrossing[] => {
      let cursor = absoluteSimTime;
      return list.map(c => {
        cursor += c.waitSeconds;
        return { absoluteTime: cursor, togglesTo: c.togglesTo, kind };
      });
    };
    const allCrossings = [...toTagged(crossings.sale, 'sale'), ...toTagged(crossings.boost, 'boost')].sort(
      (a, b) => a.absoluteTime - b.absoluteTime
    );

    let cursor = absoluteSimTime;
    let snapshot = beforeSnapshot;
    for (const crossing of allCrossings) {
      const waitSeconds = crossing.absoluteTime - cursor;
      // Both events follow sim time (engine/calendarEvents.ts), so only the clock needs moving.
      const waitType =
        crossing.kind === 'sale'
          ? crossing.togglesTo
            ? 'wait_for_research_sale'
            : 'wait_for_research_sale_end'
          : boostWaitOverride ?? (crossing.togglesTo ? 'wait_for_earnings_boost' : 'wait_for_earnings_boost_end');
      const waitId = insertWait(waitType, waitSeconds, snapshot);
      snapshot = waitId ? prepareExecution() : snapshot;
      cursor = crossing.absoluteTime;
    }
    return { snapshot, cursor };
  }

  /**
   * Before a purchase of `research`, inserts a wait for each research sale and 2x earnings start or
   * end its saving crosses. Does nothing once the waits are in place, so buying right after
   * `syncEventStateForItem` adds nothing further.
   */
  function insertCrossingWaits(research: R) {
    const beforeSnapshot = prepareExecution();
    const level = beforeSnapshot.researchLevels[research.id] || 0;
    const crossings = deps.crossingsForPurchase(research, level, beforeSnapshot);
    if (!crossings) return;
    insertEventCrossingWaits(absoluteTimeOf(beforeSnapshot), crossings, beforeSnapshot);
  }

  /**
   * Before a purchase costing `cost` from outside research, inserts a wait for each 2x earnings start
   * or end its saving crosses. The research sale doesn't affect these prices, so its boundaries get
   * no waits here.
   */
  function insertBoostCrossingWaits(cost: number) {
    const beforeSnapshot = prepareExecution();
    const absoluteTime = absoluteTimeOf(beforeSnapshot);
    const { boost } = findEventCrossings(
      absoluteTime,
      getTimeToSave(cost, beforeSnapshot, boostTransitionsFrom(beforeSnapshot, absoluteTime)),
      false,
      isEarningsBoostActive(absoluteTime + BOUNDARY_EPSILON_SECONDS)
    );
    if (boost.length > 0) insertEventCrossingWaits(absoluteTime, { sale: [], boost }, beforeSnapshot);
  }

  /**
   * Adds a wait of `seconds`, split at each 2x earnings start or end it crosses so the timeline names
   * them. A wait without earnings stays that type throughout; the research sale needs no split.
   */
  function insertWaitAcrossBoost(seconds: number, type: 'wait_for_time' | 'wait_for_no_earnings') {
    const beforeSnapshot = prepareExecution();
    const absoluteTime = absoluteTimeOf(beforeSnapshot);
    const { boost } = findEventCrossings(
      absoluteTime,
      seconds,
      false,
      isEarningsBoostActive(absoluteTime + BOUNDARY_EPSILON_SECONDS)
    );
    const { snapshot, cursor } = insertEventCrossingWaits(
      absoluteTime,
      { sale: [], boost },
      beforeSnapshot,
      type === 'wait_for_no_earnings' ? type : undefined
    );
    const remaining = absoluteTime + seconds - cursor;
    if (remaining > 1e-3) insertWait(type, remaining, snapshot);
  }

  return {
    prepareExecution,
    completeExecution,
    batch,
    isEditingPastGroup,
    settled,
    insertWait,
    insertEventCrossingWaits,
    insertCrossingWaits,
    insertBoostCrossingWaits,
    insertWaitAcrossBoost,
  };
}
