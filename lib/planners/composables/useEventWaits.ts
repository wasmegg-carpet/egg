import { computed } from 'vue';
import type { BaseCalculationsSnapshot } from '../types/actions/core';
import {
  getNextEarningsBoostEnd,
  getNextEarningsBoostStart,
  getNextSaleEnd,
  getNextSaleStart,
} from '../events';
import { formatDuration } from '../format';
import { useToastStore } from '../stores/toast';

export type EventWaitType =
  | 'wait_for_research_sale'
  | 'wait_for_research_sale_end'
  | 'wait_for_earnings_boost'
  | 'wait_for_earnings_boost_end';

export interface EventWaitAction {
  id: string;
  timestamp: number;
  type: EventWaitType;
  payload: { totalTimeSeconds: number };
  cost: number;
  dependsOn: string[];
}

type EventSnapshot = Pick<BaseCalculationsSnapshot, 'lastStepTime' | 'activeSales' | 'earningsBoost'>;

/** What each planner supplies; the planners differ only in which stores these read. */
export interface EventWaitsDeps<S extends EventSnapshot> {
  planStartSeconds: () => number;
  planStartOffset: () => number;
  snapshot: () => S;
  prepareExecution: () => S;
  completeExecution: (action: EventWaitAction, before: S) => Promise<void>;
  batch: (callback: () => Promise<void> | void) => Promise<void>;
  generateId: () => string;
  dependenciesFor: (type: EventWaitType, payload: { totalTimeSeconds: number }) => string[];
}

/**
 * Advances a plan to research sale and 2x earnings boundaries. Both events follow sim time (see
 * engine/calendarEvents.ts), so these only need to move the clock. Shared by both manual planners'
 * Wait tab, Smart Buy view and event toggles.
 */
export function useEventWaits<S extends EventSnapshot>(deps: EventWaitsDeps<S>) {
  const toastStore = useToastStore();

  /** The plan's current time in Unix seconds: T=0 maps to the date and time the user entered. */
  const absoluteSimTime = computed(
    () => deps.planStartSeconds() + (deps.snapshot().lastStepTime - deps.planStartOffset())
  );

  const untilNext = (next: (time: number) => number) =>
    computed(() => Math.max(0, next(absoluteSimTime.value) - absoluteSimTime.value));
  const secondsUntilNextSale = untilNext(getNextSaleStart);
  const secondsUntilSaleEnd = untilNext(getNextSaleEnd);
  const secondsUntilNextEarningsBoost = untilNext(getNextEarningsBoostStart);
  const secondsUntilEarningsBoostEnd = untilNext(getNextEarningsBoostEnd);

  // Chains each new wait off the previous one so ordering (and undo) stays correct.
  // The very first instead depends on whatever preceded this batch.
  function createChain() {
    let lastId: string | null = null;

    return async function addWait(type: EventWaitType, seconds: number) {
      const before = deps.prepareExecution();
      const id = deps.generateId();
      const payload = { totalTimeSeconds: Math.max(0, seconds) };
      await deps.completeExecution(
        {
          id,
          timestamp: Date.now(),
          type,
          payload,
          cost: 0,
          dependsOn: lastId ? [lastId] : deps.dependenciesFor(type, payload),
        },
        before
      );
      lastId = id;
    };
  }

  /** Waits for the next sale to start (Friday 9 AM Pacific), marking any 2x Earnings on the way. */
  async function waitForNextSale() {
    await deps.batch(async () => {
      const addWait = createChain();
      const startTime = absoluteSimTime.value;
      const saleStart = getNextSaleStart(startTime);
      const boostEnd = getNextEarningsBoostEnd(startTime);

      if (deps.snapshot().earningsBoost.active && boostEnd < saleStart) {
        await addWait('wait_for_earnings_boost_end', boostEnd - startTime);
        await addWait('wait_for_research_sale', saleStart - boostEnd);
        return;
      }

      const boostStart = getNextEarningsBoostStart(startTime);
      if (!deps.snapshot().earningsBoost.active && boostStart < saleStart) {
        const nextBoostEnd = getNextEarningsBoostEnd(boostStart);
        await addWait('wait_for_earnings_boost', boostStart - startTime);
        await addWait('wait_for_earnings_boost_end', nextBoostEnd - boostStart);
        await addWait('wait_for_research_sale', saleStart - nextBoostEnd);
        return;
      }

      await addWait('wait_for_research_sale', saleStart - startTime);
    });
  }

  const singleWait = (type: EventWaitType, seconds: () => number) => () =>
    deps.batch(async () => {
      await createChain()(type, seconds());
    });

  /** Waits for the current sale to end (Saturday 9 AM Pacific). */
  const waitForSaleEnd = singleWait('wait_for_research_sale_end', () => secondsUntilSaleEnd.value);
  /** Waits for the next 2x Earnings to start (Monday 9 AM Pacific). */
  const waitForNextEarningsBoost = singleWait('wait_for_earnings_boost', () => secondsUntilNextEarningsBoost.value);
  /** Waits for the current 2x Earnings to end (Tuesday 9 AM Pacific). */
  const waitForEarningsBoostEnd = singleWait('wait_for_earnings_boost_end', () => secondsUntilEarningsBoostEnd.value);

  // Reports what the plan actually moved by, so a wait the user cancels (the continuity prompt when
  // editing a past group) doesn't claim to have happened.
  async function advanceAndAnnounce(edge: 'start' | 'end', event: string, advance: () => Promise<void>) {
    const before = deps.snapshot().lastStepTime;
    await advance();
    const advanced = deps.snapshot().lastStepTime - before;
    if (advanced > 0) {
      toastStore.show(`Time automatically advanced ${formatDuration(advanced).replace(/\s+/g, '')} to ${edge} of ${event}`);
    }
  }

  /** The Research Sale toggle: on waits for the next sale to start, off for the current one to end. */
  function toggleResearchSale() {
    return deps.snapshot().activeSales.research
      ? advanceAndAnnounce('end', 'Research Sale', waitForSaleEnd)
      : advanceAndAnnounce('start', 'Research Sale', waitForNextSale);
  }

  /** The 2x Earnings toggle: on waits for the next event to start, off for the current one to end. */
  function toggleEarningsBoost() {
    return deps.snapshot().earningsBoost.active
      ? advanceAndAnnounce('end', '2x Earnings', waitForEarningsBoostEnd)
      : advanceAndAnnounce('start', '2x Earnings', waitForNextEarningsBoost);
  }

  return {
    secondsUntilNextSale,
    secondsUntilSaleEnd,
    secondsUntilNextEarningsBoost,
    secondsUntilEarningsBoostEnd,
    waitForNextSale,
    waitForSaleEnd,
    waitForNextEarningsBoost,
    waitForEarningsBoostEnd,
    toggleResearchSale,
    toggleEarningsBoost,
  };
}
