import {
  getNextSaleStart,
  getNextSaleEnd,
  getNextEarningsBoostStart,
  getNextEarningsBoostEnd,
  BOUNDARY_EPSILON_SECONDS,
} from '../events';

/** One event boundary a purchase's own wait crosses: how far away it is, and what it flips to. */
export interface EventCrossing {
  waitSeconds: number;
  togglesTo: boolean;
}

export interface PurchaseEventCrossings {
  sale: EventCrossing[];
  boost: EventCrossing[];
}

/**
 * Given a purchase that starts saving at `currentAbsoluteTime` and (per its own already-computed,
 * boundary-aware `secondsToBuy` — e.g. from `getSaleAwareTimeToSave`/`getTimeToSave`) completes
 * `secondsToBuy` later, determines which event boundaries (research sale start/end, earnings boost
 * start/end) fall within that window — i.e. which events this purchase will cross while saving up.
 * Returns every crossing in chronological order, not just the first — a wait long enough to span a
 * FULL event cycle (e.g. several days, crossing both the boost's start AND its end) needs both
 * represented, or a display/execution consumer would miss the boost turning back off partway
 * through.
 *
 * Purely descriptive: doesn't affect price/wait math at all (that's already baked into
 * `secondsToBuy` by whichever boundary-aware function computed it) — this just identifies, given
 * that already-correct total, what to show/insert as explicit wait steps around the
 * purchase. Shared by the milestone chain (to annotate the preview) and the manual planner's
 * execution code (to decide what to actually insert) so both sides agree by construction.
 */
export function findEventCrossings(
  currentAbsoluteTime: number,
  secondsToBuy: number,
  isSaleActiveNow: boolean,
  isBoostActiveNow: boolean
): PurchaseEventCrossings {
  return {
    sale: walkEventCrossings(currentAbsoluteTime, secondsToBuy, isSaleActiveNow, getNextSaleStart, getNextSaleEnd),
    boost: walkEventCrossings(
      currentAbsoluteTime,
      secondsToBuy,
      isBoostActiveNow,
      getNextEarningsBoostStart,
      getNextEarningsBoostEnd
    ),
  };
}

/**
 * Walks forward from `currentAbsoluteTime`, alternating between `getNextStart`/`getNextEnd`,
 * collecting every flip within the purchase's `secondsToBuy` window. Each entry's `waitSeconds` is
 * the length of the segment ENDING at that crossing (from the previous crossing, or from
 * `currentAbsoluteTime` for the first) — i.e. exactly the duration of the `wait_for_*` action that
 * would precede it, so callers can insert/display a chronological sequence of wait steps
 * without needing to re-derive offsets.
 */
// This function's loop bound is `currentAbsoluteTime + secondsToBuy` — and secondsToBuy is
// deliberately allowed to be enormous (see getTimeToSave's doc comment: it never caps a
// genuinely-reachable wait to a fake Infinity, so a purchase evaluated against a weak earn rate can
// legitimately take centuries). Unlike boostTransitionsFrom, which bounds its OWN walk to a fixed
// horizon regardless of the caller's wait, this function had no cap at all — for a multi-century
// wait it would enumerate every weekly sale/boost cycle in that entire span, pushing potentially
// millions of entries and crashing the tab on an out-of-memory error (confirmed in production: a
// milestone-chain purchase evaluated against a near-zero earn rate did exactly this, crashing
// before any of the surrounding loop's own progress heartbeats had a chance to log anything, since
// the crash happens inside a single call, not across iterations already being watched). This is
// purely a display/preview mechanism (the wait steps for a purchase), so there's no reason
// to enumerate more than a practical number of crossings — nobody benefits from seeing hundreds of
// individual steps for a purchase that takes years, let alone centuries.
const MAX_EVENT_CROSSINGS = 100;

function walkEventCrossings(
  currentAbsoluteTime: number,
  secondsToBuy: number,
  isActiveNow: boolean,
  getNextStart: (t: number) => number,
  getNextEnd: (t: number) => number
): EventCrossing[] {
  if (!isFinite(secondsToBuy) || secondsToBuy <= 0) return [];

  const crossings: EventCrossing[] = [];
  const deadline = currentAbsoluteTime + secondsToBuy;
  let cursor = currentAbsoluteTime;
  let active = isActiveNow;

  while (crossings.length < MAX_EVENT_CROSSINGS) {
    const boundary = active ? getNextEnd(cursor) : getNextStart(cursor);
    // boundary <= cursor should be unreachable (getNextPacificTime guarantees its result is always
    // strictly after its input — see that function's own doc comment), but this walk used to have
    // no defense at all against that invariant ever being violated; break rather than spin forever
    // if it somehow is.
    //
    // `boundary > deadline + BOUNDARY_EPSILON_SECONDS`, not a bare `boundary > deadline`: a purchase
    // timed to land EXACTLY on this boundary (the common "saved up just enough right as the sale
    // starts" case) computed `deadline` by working backward FROM this same boundary via a wait
    // duration, then re-adding that duration to `currentAbsoluteTime` here — a different arithmetic
    // path than this fresh `getNextStart`/`getNextEnd` lookup, even though both intend the identical
    // instant. A bare `>` had zero tolerance for the sub-second float residue that round-trip can
    // leave, so landing a hair on the wrong side silently dropped the crossing — no
    // wait_for_research_sale/toggle_sale got inserted, `activeSales.research` never flipped, and
    // every LATER purchase in the same chain kept reading that stale flag (`syncEventStateForItem`
    // trusts it directly, not a fresh recompute) until some later crossing happened to land cleanly.
    // See `BOUNDARY_EPSILON_SECONDS`'s own doc comment for why this tolerance is safe.
    if (!isFinite(boundary) || boundary > deadline + BOUNDARY_EPSILON_SECONDS || boundary <= cursor) break;
    crossings.push({ waitSeconds: boundary - cursor, togglesTo: !active });
    active = !active;
    cursor = boundary;
  }

  return crossings;
}
