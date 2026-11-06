import { useActionsStore } from '@/stores/actions';
import { useSalesStore } from 'lib/planners/stores/sales';
import { useActionExecutor } from '@/composables/useActionExecutor';
import { generateActionId } from '@/types';
import { computeDependencies } from '@/lib/actions/executor';
import { findEventCrossings, type EventCrossing } from '@/calculations/researchROI';
import type { CommonResearch } from '@/calculations/commonResearch';
import { getSimulationContext } from '@/engine/adapter';
import { eventCrossingsForPurchase } from '@/engine/researchSale';
import { absoluteSimTimeFor, getBoostAwareTimeToSave } from '@/engine/apply';
import { BOUNDARY_EPSILON_SECONDS, isEarningsBoostActive } from 'lib/planners/events';

/**
 * Inserts the wait and toggle actions that carry a plan across sale and boost boundaries, and hands
 * out the executor they share with the purchase that follows.
 *
 * Inserting into a past group finishes asynchronously, so a loop buying several things has to await
 * `settled()` between purchases when `isEditingPastGroup` is set, or the next purchase works out its
 * crossings from a state missing the last one and adds the same wait again.
 */
export function useEventCrossingWaits() {
  const { prepareExecution, completeExecution: runExecution, batch, isEditingPastGroup } = useActionExecutor();
  let lastExecution: Promise<unknown> = Promise.resolve();
  function completeExecution(...args: Parameters<typeof runExecution>) {
    const execution = runExecution(...args);
    lastExecution = Promise.all([lastExecution, execution]);
    return execution;
  }
  const settled = () => lastExecution;

  const actionsStore = useActionsStore();
  const salesStore = useSalesStore();

  /** Inserts a wait action of the given type/duration, returning its id (or undefined if seconds <= 0). */
  function insertWait(
    type:
      | 'wait_for_research_sale'
      | 'wait_for_research_sale_end'
      | 'wait_for_earnings_boost'
      | 'wait_for_earnings_boost_end'
      | 'wait_for_no_earnings'
      | 'wait_for_time',
    seconds: number,
    beforeSnapshot: ReturnType<typeof prepareExecution>
  ): string | undefined {
    if (seconds <= 0) return undefined;
    const id = generateActionId();
    const payload = { totalTimeSeconds: seconds };
    completeExecution(
      {
        id,
        timestamp: Date.now(),
        type,
        payload,
        cost: 0,
        dependsOn: computeDependencies(
          type,
          payload,
          actionsStore.actionsBeforeInsertion,
          actionsStore.initialSnapshot.researchLevels
        ),
      },
      beforeSnapshot
    );
    return id;
  }

  function insertToggleEarningsBoost(
    active: boolean,
    waitId: string | undefined,
    beforeSnapshot: ReturnType<typeof prepareExecution>
  ) {
    const payload = { active, multiplier: active ? 2 : 1 };
    salesStore.setEarningsBoost(active, payload.multiplier);
    completeExecution(
      {
        id: generateActionId(),
        timestamp: Date.now(),
        type: 'toggle_earnings_boost',
        payload,
        cost: 0,
        dependsOn: [
          ...computeDependencies(
            'toggle_earnings_boost',
            payload,
            actionsStore.actionsBeforeInsertion,
            actionsStore.initialSnapshot.researchLevels
          ),
          ...(waitId ? [waitId] : []),
        ],
      },
      beforeSnapshot
    );
  }

  /**
   * Shared by `syncEventStateForItem` (crossings up to a purchase's own wait) and `advanceToDeadline`
   * (crossings up to a fixed target time with no purchase attached): merges the sale and boost
   * crossing lists into true chronological order and inserts a wait+toggle action pair for each one.
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
    beforeSnapshot: ReturnType<typeof prepareExecution>,
    boostWaitOverride?: 'wait_for_no_earnings'
  ): { snapshot: ReturnType<typeof prepareExecution>; cursor: number } {
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
      if (crossing.kind === 'sale') {
        // The sale itself follows sim time (engine/researchSale.ts), so only the clock needs moving.
        const waitId = insertWait(
          crossing.togglesTo ? 'wait_for_research_sale' : 'wait_for_research_sale_end',
          waitSeconds,
          snapshot
        );
        snapshot = waitId ? prepareExecution() : snapshot;
      } else {
        const waitId = insertWait(
          boostWaitOverride ?? (crossing.togglesTo ? 'wait_for_earnings_boost' : 'wait_for_earnings_boost_end'),
          waitSeconds,
          snapshot
        );
        snapshot = waitId ? prepareExecution() : snapshot;
        insertToggleEarningsBoost(crossing.togglesTo, waitId, snapshot);
      }
      cursor = crossing.absoluteTime;
    }
    return { snapshot, cursor };
  }

  /**
   * Before a purchase of `research`, inserts a wait for each research sale and 2x earnings start or
   * end its saving crosses. Does nothing once the waits are in place, so buying right after
   * `syncEventStateForItem` adds nothing further.
   */
  function insertCrossingWaits(research: CommonResearch) {
    const beforeSnapshot = prepareExecution();
    const context = getSimulationContext();
    const level = beforeSnapshot.researchLevels[research.id] || 0;
    const crossings = eventCrossingsForPurchase(research, level, beforeSnapshot, context);
    if (!crossings) return;
    insertEventCrossingWaits(
      context.ascensionStartTime + (beforeSnapshot.lastStepTime - context.planStartOffset),
      crossings,
      beforeSnapshot
    );
  }

  /**
   * Before a purchase costing `cost` from outside research, inserts a wait and toggle for each 2x
   * earnings start or end its saving crosses. The research sale doesn't affect these prices, so its
   * boundaries get no waits here.
   */
  function insertBoostCrossingWaits(cost: number) {
    const beforeSnapshot = prepareExecution();
    const context = getSimulationContext();
    const absoluteTime = absoluteSimTimeFor(beforeSnapshot, context);
    const { boost } = findEventCrossings(
      absoluteTime,
      getBoostAwareTimeToSave(cost, beforeSnapshot, context),
      false,
      isEarningsBoostActive(absoluteTime + BOUNDARY_EPSILON_SECONDS)
    );
    if (boost.length > 0) insertEventCrossingWaits(absoluteTime, { sale: [], boost }, beforeSnapshot);
  }

  /**
   * Adds a wait of `seconds`, split at each 2x earnings start or end it crosses with a toggle there,
   * so the plan's 2x state stays right afterwards. A wait without earnings stays that type throughout;
   * the research sale follows sim time on its own and needs no split.
   */
  function insertWaitAcrossBoost(seconds: number, type: 'wait_for_time' | 'wait_for_no_earnings') {
    const beforeSnapshot = prepareExecution();
    const absoluteTime = absoluteSimTimeFor(beforeSnapshot, getSimulationContext());
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
