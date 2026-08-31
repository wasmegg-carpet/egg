/**
 * @module earningsEventDeferral
 * @description Shared "defer for earnings mode" purchase deferral (see AutomaticPlanner.vue's
 * easter egg): skip a purchase that would otherwise complete entirely within the pre-boost silo
 * window, buying it instead right after the earnings event starts, where the same price is
 * reached in less real time. Multiversal Layering is exempt (and protects anything scheduled
 * before it in the same list) since it meaningfully raises the earn rate and should start
 * compounding ASAP. Generic over the item type so both C3's own smart-buy sweep
 * (`executePlanToLevels` in c3.ts, plain research-id strings) and its Tier 13 unlock chain
 * (`executeChain` in milestones.ts, `MilestoneChainItem` objects) share one implementation
 * instead of two copies that can silently drift apart — which already happened once, when the
 * "check the item's own finish time, not just the current clock" fix landed in only one of the
 * two.
 */

import type { EngineState, SimulationContext } from '../../types';
import { getNextEarningsBoostStart, isEarningsBoostActive } from '@/lib/events';
import { totalAwayTime } from '@/stores/silos';

/** Only the id matters here — the target level, if any, is the calling shift's own business. */
export const MULTI_LAYERING_ID = 'multi_layering';

/**
 * The subset of `createMilestoneShiftHelpers`'s (milestones.ts) return value this needs. Kept as
 * its own small interface — not derived from that file's return type — to avoid a circular
 * import, since that file is one of this function's own callers.
 */
export interface EarningsEventDeferralHost {
  getAbsTime(): number;
  previewPurchase(researchId: string): { waitSeconds: number } | null;
  advanceTime(seconds: number): void;
  getElapsedSeconds(): number;
  getState(): EngineState;
}

/**
 * Runs `items` through `executeItem` one at a time, deferring (queuing without buying) any whose
 * predicted FINISH time — not just the current clock; see the inline comment below for why —
 * falls within the farm's total silo away-time of an upcoming earnings event (2x earnings boost)
 * start, until that event's activity is detected (naturally, via a later item's own
 * boundary-crossing wait, or via an explicit jump to its start once `items` runs out) — at which
 * point the queue is bought for real, now at the 2x rate.
 *
 * `shouldSkip`, when given, is checked before anything else — no deferral consideration, no
 * execution — for callers whose `items` can contain entries already satisfied by an earlier one
 * (see `executePlanToLevels`'s own call site for why it needs this and `executeChain`'s for why it
 * doesn't).
 *
 * Returns the same `{ executedCount, totalGemsSpent }` shape every caller already builds its own
 * note payload from.
 */
export function runWithEarningsEventDeferral<T>(
  items: T[],
  getResearchId: (item: T) => string,
  executeItem: (item: T, timeLimit: number) => number | false,
  host: EarningsEventDeferralHost,
  context: SimulationContext,
  timeLimit: number,
  shouldSkip?: (item: T) => boolean
): { executedCount: number; totalGemsSpent: number } {
  let executedCount = 0;
  let totalGemsSpent = 0;
  const deferredQueue: T[] = [];

  const flushDeferred = () => {
    if (deferredQueue.length === 0) return;
    const absTime = host.getAbsTime();
    if (!isEarningsBoostActive(absTime)) {
      // Nothing crossed the boundary naturally (every remaining item fit inside the window) —
      // jump straight to the earnings event's start ourselves, budget permitting, so the queue
      // below actually buys at the 2x rate instead of wherever `absTime` currently sits. If
      // there's no budget left for the jump, fall through and buy at whatever rate is left rather
      // than dropping these items entirely.
      const eventStart = getNextEarningsBoostStart(absTime);
      const gap = eventStart - absTime;
      if (gap > 0 && host.getElapsedSeconds() + gap <= timeLimit) {
        host.advanceTime(gap);
      }
    }
    for (const item of deferredQueue) {
      if (shouldSkip?.(item)) continue;
      const paid = executeItem(item, timeLimit);
      if (paid === false) break;
      executedCount++;
      totalGemsSpent += paid;
    }
    deferredQueue.length = 0;
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (shouldSkip?.(item)) continue;

    const researchId = getResearchId(item);

    if (context.deferForEarningsMode && researchId !== MULTI_LAYERING_ID) {
      const absTime = host.getAbsTime();
      if (!isEarningsBoostActive(absTime)) {
        // Checked against the item's own predicted FINISH time, not just the current clock: an
        // item that starts just before the window but takes long enough to run past its start
        // would otherwise slip through un-deferred, "leaking" part of its wait into 1x-rate time
        // that should have been avoided entirely.
        const preview = host.previewPurchase(researchId);
        const eventStart = getNextEarningsBoostStart(absTime);
        const finishTime = preview ? absTime + preview.waitSeconds : Infinity;
        if (finishTime < eventStart) {
          const siloCapacityLevel = context.epicResearchLevels['silo_capacity'] || 0;
          const totalSiloSeconds = totalAwayTime(host.getState().siloCount, siloCapacityLevel) * 60;
          if (eventStart - finishTime <= totalSiloSeconds) {
            // "Before Multiversal Layering, buy on schedule; only defer what's scheduled after
            // it" — a plain array scan, not a timing prediction: `items` is already this sweep's
            // real, strictly sequential execution order.
            const mlStillAhead = items.slice(i + 1).some(it => getResearchId(it) === MULTI_LAYERING_ID);
            if (!mlStillAhead) {
              deferredQueue.push(item);
              continue;
            }
          }
        }
      }
    }

    const paid = executeItem(item, timeLimit);
    if (paid === false) break;
    executedCount++;
    totalGemsSpent += paid;

    flushDeferred();
  }

  flushDeferred();

  return { executedCount, totalGemsSpent };
}
