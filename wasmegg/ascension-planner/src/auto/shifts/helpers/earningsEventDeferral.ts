/**
 * @module earningsEventDeferral
 * @description Shared "defer for earnings mode" purchase deferral (see AutomaticPlanner.vue's
 * easter egg). When a purchase sweep reaches an earnings event (2x earnings boost), the player is
 * credited the pre-boost earnings rate × the offline gap before the event (capped at the farm's
 * total silo away-time) — see the `modify_bank` credit in `advanceTimeWithBoundaries`. Every
 * purchase made shortly before the event shrinks that gap, so a cheap purchase that only nudges
 * the earn rate up a few percent can cost far more credit than it earns back.
 *
 * This runner therefore buys `items` on schedule, and when the sweep reaches the event (either a
 * purchase's own wait crosses its start, or `items` runs out shortly before it), searches over
 * "undo the last k purchases made before the event, idle until it starts, then buy those k back"
 * for k = 0, 1, 2, … until the gap reaches the full silo away-time — re-simulating each candidate
 * for real and keeping whichever ends with the most bank. Every candidate ends owning the same
 * research, so from that point on they all earn at the same rate: more bank at a common moment is
 * strictly better, and every later purchase (including a chain's eventual Multiversal Layering)
 * lands no later than it would have. k = 0 is always a candidate, so the result is never worse
 * than not deferring at all.
 *
 * Multiversal Layering itself is never undone (nor anything bought before it in the same sweep),
 * since undoing it would also delay its 10x egg value.
 *
 * Generic over the item type so C3's smart-buy sweep (`executePlanToLevels` in c3.ts, plain
 * research-id strings) and its milestone chains (`executeChain` in milestones.ts,
 * `MilestoneChainItem` objects) share one implementation.
 */

import type { Action } from '@/types/actions/meta';
import type { EngineState, SimulationContext } from '../../types';
import { getNextEarningsBoostStart, isEarningsBoostActive } from '@/lib/events';
import { totalAwayTime } from '@/stores/silos';

/** Only the id matters here — the target level, if any, is the calling shift's own business. */
export const MULTI_LAYERING_ID = 'multi_layering';

/** A rewind point in the host's own running state. */
export interface DeferralCheckpoint {
  state: EngineState;
  elapsedSeconds: number;
  actionsLength: number;
}

/**
 * The subset of `createMilestoneShiftHelpers`'s (milestones.ts) return value this needs. Kept as
 * its own small interface — not derived from that file's return type — to avoid a circular
 * import, since that file is one of this function's own callers.
 */
export interface EarningsEventDeferralHost {
  getAbsTime(): number;
  advanceTime(seconds: number): void;
  getElapsedSeconds(): number;
  getState(): EngineState;
  checkpoint(): DeferralCheckpoint;
  /** Rewind to `cp` (truncating the action log to its length), then append `appendActions`. */
  restore(cp: DeferralCheckpoint, appendActions?: Action[]): void;
  actionsSince(cp: DeferralCheckpoint): Action[];
}

interface Tally {
  executedCount: number;
  totalGemsSpent: number;
}

interface UndoablePurchase<T> {
  item: T;
  /** Host state immediately before this purchase's own wait began. */
  before: DeferralCheckpoint;
  beforeAbsTime: number;
  tallyBefore: Tally;
}

interface Candidate {
  undoCount: number;
  state: EngineState;
  elapsedSeconds: number;
  /** Actions appended since the search's base checkpoint (`undoable[0].before`). */
  tail: Action[];
  tally: Tally;
}

/**
 * Runs `items` through `executeItem` one at a time, applying the undo-and-rebuy search described
 * in this module's doc comment whenever the sweep reaches an earnings event (only when
 * `context.deferForEarningsMode` is on — otherwise this is a plain sequential loop).
 *
 * `shouldSkip`, when given, is checked before anything else — no execution — for callers whose
 * `items` can contain entries already satisfied by an earlier one (see `executePlanToLevels`'s own
 * call site for why it needs this and `executeChain`'s for why it doesn't).
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
): Tally {
  let tally: Tally = { executedCount: 0, totalGemsSpent: 0 };

  if (!context.deferForEarningsMode) {
    for (const item of items) {
      if (shouldSkip?.(item)) continue;
      const paid = executeItem(item, timeLimit);
      if (paid === false) break;
      tally.executedCount++;
      tally.totalGemsSpent += paid;
    }
    return tally;
  }

  const getSiloSeconds = () =>
    totalAwayTime(host.getState().siloCount, context.epicResearchLevels['silo_capacity'] || 0) * 60;

  // Purchases made since the last earnings event (or the last Multiversal Layering purchase) that
  // the search may still undo. Trimmed from the front to the ones the search could actually reach
  // (see `trimUndoable`), so a long sweep doesn't hold a checkpoint for every purchase it ever made.
  let undoable: UndoablePurchase<T>[] = [];

  const trimUndoable = () => {
    if (undoable.length < 2) return;
    const boostStart = getNextEarningsBoostStart(host.getAbsTime());
    const siloSeconds = getSiloSeconds();
    // The search stops at the first candidate whose gap already covers the full silo away-time,
    // so anything before the LAST such purchase can never be reached.
    while (undoable.length >= 2 && boostStart - undoable[1].beforeAbsTime >= siloSeconds) undoable.shift();
  };

  const executeTracked = (item: T): boolean => {
    const paid = executeItem(item, timeLimit);
    if (paid === false) return false;
    tally = { executedCount: tally.executedCount + 1, totalGemsSpent: tally.totalGemsSpent + paid };
    return true;
  };

  /**
   * Search over undoing the last k entries of `undoable` (see this module's doc comment) and leave
   * the host in the winning candidate's end state. `boostStart` is the event being reached. When
   * the sweep hasn't reached it yet (items ran out first), k = 0 means "leave things exactly as
   * they are" rather than jumping to it — only k ≥ 1 candidates jump.
   */
  const searchUndo = (boostStart: number) => {
    const base = undoable[0].before;
    const siloSeconds = getSiloSeconds();
    const capture = (undoCount: number, candidateTally: Tally): Candidate => ({
      undoCount,
      state: host.getState(),
      elapsedSeconds: host.getElapsedSeconds(),
      tail: host.actionsSince(base),
      tally: candidateTally,
    });
    const restoreCandidate = (c: Candidate) =>
      host.restore({ state: c.state, elapsedSeconds: c.elapsedSeconds, actionsLength: base.actionsLength }, c.tail);

    const candidates: Candidate[] = [capture(0, tally)];
    const boostElapsed = host.getElapsedSeconds() + (boostStart - host.getAbsTime());

    for (let k = 1; k <= undoable.length; k++) {
      const entry = undoable[undoable.length - k];
      const gap = boostStart - entry.beforeAbsTime;

      host.restore(entry.before);
      // Same boundary for every k, so if it's out of budget here it's out of budget for all of them.
      if (entry.before.elapsedSeconds + gap > timeLimit) break;
      host.advanceTime(gap);

      tally = entry.tallyBefore;
      let feasible = true;
      for (const { item } of undoable.slice(undoable.length - k)) {
        if (shouldSkip?.(item)) continue;
        if (!executeTracked(item)) {
          feasible = false;
          break;
        }
      }
      if (feasible) candidates.push(capture(k, tally));

      if (gap >= siloSeconds) break;
    }

    // Score every candidate by its bank at one common moment — the latest any of them finishes
    // (and never before the event itself, so the "not crossed yet" k = 0 gets its own credit too).
    const horizon = Math.max(boostElapsed, ...candidates.map(c => c.elapsedSeconds));
    let best = candidates[0];
    let bestBank = -Infinity;
    for (const c of candidates) {
      restoreCandidate(c);
      host.advanceTime(horizon - c.elapsedSeconds);
      const bank = host.getState().bankValue || 0;
      if (bank > bestBank) {
        best = c;
        bestBank = bank;
      }
    }

    restoreCandidate(best);
    tally = best.tally;
  };

  for (const item of items) {
    if (shouldSkip?.(item)) continue;

    const absBefore = host.getAbsTime();
    const boostBefore = isEarningsBoostActive(absBefore);
    const entry: UndoablePurchase<T> = {
      item,
      before: host.checkpoint(),
      beforeAbsTime: absBefore,
      tallyBefore: tally,
    };

    if (!executeTracked(item)) break;

    if (boostBefore || getResearchId(item) === MULTI_LAYERING_ID) {
      undoable = [];
      continue;
    }

    undoable.push(entry);

    if (isEarningsBoostActive(host.getAbsTime())) {
      // This purchase's own wait crossed into the event.
      searchUndo(getNextEarningsBoostStart(absBefore));
      undoable = [];
    } else {
      trimUndoable();
    }
  }

  // Items ran out shortly before an event: consider undoing the tail and jumping to it.
  if (undoable.length > 0 && !isEarningsBoostActive(host.getAbsTime())) {
    const boostStart = getNextEarningsBoostStart(host.getAbsTime());
    if (boostStart - host.getAbsTime() < getSiloSeconds()) {
      trimUndoable();
      searchUndo(boostStart);
    }
  }

  return tally;
}
