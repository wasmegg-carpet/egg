import type { CalculationsSnapshot } from '@/types';
import { isEarningsBoostActive, getNextEarningsBoostStart, getNextEarningsBoostEnd } from '@/lib/events';

/**
 * A future point (relative to t=0 of the calculation) at which the earnings boost's active state
 * changes. `boostActive` is the state that applies AFTER this transition. A transition with
 * `atSeconds <= 0` means the snapshot's own `earningsBoost.active` is stale for this window (it
 * wasn't re-derived at this point in time) — the most recent such transition wins as the true
 * state at t=0, overriding the snapshot's flag, rather than creating a mid-window segment.
 */
export interface EarningsRateTransition {
  atSeconds: number;
  boostActive: boolean;
}

/**
 * How far ahead to enumerate upcoming boost start/end flips. `getTimeToSave` doesn't know in
 * advance how long a wait will actually take (it's solving for that), so `boostTransitionsFrom`
 * can't bound the list to "however far this particular wait goes" the way `findEventCrossings`
 * (researchROI.ts, which *is* given a known duration) does — it has to generate enough transitions
 * up front to cover whatever the wait turns out to need. `getTimeToSave` has no upper limit on what
 * it can return (a genuinely reachable purchase is never reported as impossible just because it's
 * slow — see that function's own doc comment), so this horizon can't be sized to guarantee full
 * coverage of every possible wait; beyond it, the boundary-aware math falls back to assuming the
 * last known boost state holds indefinitely, which is an acceptable approximation for a wait's far
 * tail (the boost is only active ~14% of the time either way, so the error this introduces is small
 * relative to a wait already measured in years).
 *
 * Affordable to set this generously (rather than trimming it as tight as possible) because
 * `getNextPacificTime`'s cache (`src/lib/events.ts`) remembers every occurrence it has ever
 * discovered per (day, hour) key, not just the last one: the very first walk out to this horizon
 * pays the real (brute-force) cost once, and every other call from any candidate/step touching any
 * point within that already-discovered range answers via binary search, not recomputation. And a
 * query for a point far beyond anything discovered yet (e.g. a purchase whose wait lands centuries
 * out) is handled in O(1) rather than by crawling toward it — see the cache's own doc comment.
 */
const BOOST_TRANSITION_HORIZON_SECONDS = 3 * 365 * 86400;

/**
 * The earnings boost's fixed multiplier while active — every real `setEarningsBoost`/
 * `toggle_earnings_boost` call site in this codebase writes exactly `2` when activating and `1`
 * when deactivating (the `1` is a reset placeholder, not a meaningful "boost strength"; nothing
 * ever reads `multiplier` while `active` is false except this file's own rate projection below).
 * Used instead of `prevSnapshot.earningsBoost.multiplier` whenever a rate needs to be projected
 * for the OPPOSITE of the snapshot's current active state — see `calculateEarningsForTime`'s and
 * `getTimeToSave`'s `rateFor` for why relying on the snapshot field there is unsafe.
 */
const EARNINGS_BOOST_MULTIPLIER = 2;

/**
 * Builds the earnings-rate transitions needed for a `getTimeToSave`/`calculateEarningsForTime`/
 * `applyTime` call starting at `snapshot`, given the TRUE calendar time `absTime` that call
 * represents. `snapshot.earningsBoost.active` may be stale (many callers never toggle it as
 * simulated time advances — it stays frozen at whatever it was when the snapshot was computed) —
 * when it disagrees with calendar truth at `absTime`, a past-transition correction is included so
 * the boundary-aware math above treats the current truth as authoritative. This is still correct
 * even though `snapshot`'s own rate (`V1`) was computed under the stale flag: `V1` always
 * represents "the rate for whichever state the flag reflects," and the boundary-aware functions
 * derive the *other* state's rate by multiplying/dividing by the boost multiplier — so only the
 * segment assignment needs correcting, never `V1` itself.
 *
 * Walks forward enumerating EVERY boost start/end flip within the horizon, not just the next one —
 * a wait long enough to span a full 24h boost cycle (start AND end both within it, e.g. a purchase
 * that takes several days) needs both transitions represented, or the math would assume the boost,
 * once started, stays active for the rest of the wait instead of reverting to 1x after 24h.
 */
export function boostTransitionsFrom(
  snapshot: CalculationsSnapshot,
  absTime: number,
  horizonSeconds: number = BOOST_TRANSITION_HORIZON_SECONDS
): EarningsRateTransition[] {
  const trueActiveNow = isEarningsBoostActive(absTime);
  const transitions: EarningsRateTransition[] = [];
  if (trueActiveNow !== snapshot.earningsBoost.active) {
    transitions.push({ atSeconds: -1, boostActive: trueActiveNow });
  }

  let cursor = absTime;
  let active = trueActiveNow;
  const horizon = absTime + horizonSeconds;
  let iterations = 0;
  while (cursor < horizon) {
    iterations++;
    if (iterations > 2000) {
      // Safety net: this loop should terminate in well under 1000 iterations for any real 3-year
      // horizon (max ~2 flips/week). If we're here, `cursor` isn't advancing — break instead of
      // hanging the tab, and log so a regression here is loud instead of silent.
      console.error('[boostTransitionsFrom] runaway loop detected, breaking', {
        absTime,
        cursor,
        horizon,
        active,
        iterations,
      });
      break;
    }
    const nextFlip = active ? getNextEarningsBoostEnd(cursor) : getNextEarningsBoostStart(cursor);
    if (!isFinite(nextFlip) || nextFlip > horizon) break;
    if (nextFlip <= cursor) {
      // Safety net: getNextPacificTime should always return a value strictly after its input (see
      // its own doc comment — this exact invariant caused a real production hang before it was
      // fixed there). Break instead of looping forever if that ever regresses.
      console.error('[boostTransitionsFrom] nextFlip did not advance past cursor, breaking', {
        absTime,
        cursor,
        nextFlip,
        active,
        iterations,
      });
      break;
    }
    transitions.push({ atSeconds: nextFlip - absTime, boostActive: !active });
    active = !active;
    cursor = nextFlip;
  }

  return transitions;
}

/**
 * Solve for time T in: integral from 0 to T of min(R * min(P0 + I*t, HabCap), S) dt = targetAmount
 */
export function solveForTime(
  targetAmount: number,
  P0: number,
  I: number,
  R: number,
  S: number,
  HabCap: number = Infinity
): number {
  if (targetAmount <= 0) return 0;

  const CapRate = Math.min(S, R * HabCap);

  if (R * P0 >= CapRate) {
    return CapRate > 0 ? targetAmount / CapRate : Infinity;
  }

  // Time when rate hits CapRate
  let Tcap = Infinity;
  if (I > 0) {
    Tcap = (CapRate / R - P0) / I;
  }

  const Gcap = I > 0 && Tcap !== Infinity ? R * (P0 * Tcap + 0.5 * I * Tcap * Tcap) : Infinity;

  if (targetAmount <= Gcap) {
    const a = 0.5 * R * I;
    const b = R * P0;
    const c = -targetAmount;
    if (a === 0) return b > 0 ? targetAmount / b : Infinity;
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  } else {
    const Tremaining = (targetAmount - Gcap) / CapRate;
    return Tcap + Tremaining;
  }
}

/**
 * Integrated rate from 0 to T: integral from 0 to T of min(R * min(P0 + I*t, HabCap), S) dt
 */
export function integrateRate(seconds: number, P0: number, I: number, R: number, S: number, HabCap: number): number {
  if (seconds <= 0) return 0;

  const CapRate = Math.min(S, R * HabCap);

  let Tcap = Infinity;
  if (I > 0) {
    Tcap = (CapRate / R - P0) / I;
  } else if (R * P0 >= CapRate) {
    Tcap = 0;
  }

  if (Tcap <= 0) {
    return CapRate * seconds;
  } else if (seconds <= Tcap) {
    return R * (P0 * seconds + 0.5 * I * seconds * seconds);
  } else {
    const Gcap = R * (P0 * Tcap + 0.5 * I * Tcap * Tcap);
    const Gafter = CapRate * (seconds - Tcap);
    return Gcap + Gafter;
  }
}

/**
 * Calculate the total earnings integrated over a period of time [0, seconds], accounting for any
 * number of earnings-boost transitions within that window (boost starting, ending, or both).
 *
 * Egg-delivery physics (population growth, hab/shipping caps — everything `integrateRate` models)
 * are entirely independent of the earnings boost: the boost is a pure post-hoc multiplier on the
 * dollar value of delivered eggs. So a transition only ever changes the $-per-egg conversion rate
 * for the segment after it, never the underlying egg integral — each segment's earnings are just
 * `rate * (eggs at segment end - eggs at segment start)`, summed across segments.
 */
export function calculateEarningsForTime(
  seconds: number,
  prevSnapshot: CalculationsSnapshot,
  transitions: EarningsRateTransition[] = []
): number {
  if (seconds <= 0) return 0;
  const V1 = prevSnapshot.elr > 0 ? prevSnapshot.offlineEarnings / prevSnapshot.elr : 0;
  if (V1 <= 0) return 0;

  // `prevSnapshot.earningsBoost.multiplier` is only trustworthy for the snapshot's OWN current
  // `active` state — it gets reset to 1 whenever a boost is toggled off (see
  // `EARNINGS_BOOST_MULTIPLIER`'s doc comment), so it can't be used to project the rate for the
  // OPPOSITE state (e.g. an upcoming boost while currently inactive). Use the snapshot's real
  // current rate (`V1`) for the current state, and the fixed constant for the other.
  const currentActive = prevSnapshot.earningsBoost.active;
  const rateFor = (active: boolean) =>
    active === currentActive ? V1 : active ? V1 * EARNINGS_BOOST_MULTIPLIER : V1 / EARNINGS_BOOST_MULTIPLIER;

  const eggsAt = (t: number) =>
    integrateRate(
      t,
      prevSnapshot.population,
      prevSnapshot.offlineIHR / 60,
      prevSnapshot.ratePerChickenPerSecond,
      prevSnapshot.shippingCapacity,
      prevSnapshot.habCapacity
    );

  // Transitions at/before t=0 mean prevSnapshot's own `earningsBoost.active` is stale for this
  // window — the most recent one wins as the true state at t=0. Only transitions strictly inside
  // (0, seconds) create additional segments.
  const past = transitions.filter(t => t.atSeconds <= 0).sort((a, b) => b.atSeconds - a.atSeconds);
  const future = transitions
    .filter(t => t.atSeconds > 0 && t.atSeconds < seconds)
    .sort((a, b) => a.atSeconds - b.atSeconds);

  let segmentActive = past.length > 0 ? past[0].boostActive : currentActive;
  let segmentStart = 0;
  let total = 0;

  for (const transition of future) {
    total += rateFor(segmentActive) * (eggsAt(transition.atSeconds) - eggsAt(segmentStart));
    segmentStart = transition.atSeconds;
    segmentActive = transition.boostActive;
  }
  total += rateFor(segmentActive) * (eggsAt(seconds) - eggsAt(segmentStart));

  return total;
}

/**
 * Calculate the total eggs delivered integrated over a period of time [0, seconds].
 */
export function calculateEggsDeliveredForTime(seconds: number, prevSnapshot: CalculationsSnapshot): number {
  return integrateRate(
    seconds,
    prevSnapshot.population,
    prevSnapshot.offlineIHR / 60,
    prevSnapshot.ratePerChickenPerSecond,
    prevSnapshot.shippingCapacity,
    prevSnapshot.habCapacity
  );
}

/**
 * Helper to get time to save for a cost, accounting for population growth and caps, plus any
 * number of earnings-boost transitions within the wait (the boost starting, ending, or both).
 *
 * Same insight as `calculateEarningsForTime`: population growth is boost-independent, so each
 * regime between transitions can be solved with the existing `solveForTime`/`integrateRate`
 * machinery by re-anchoring `P0` to the population already reached at that regime's start time
 * (`min(P0 + I*t, HabCap)`) — the growth curve restarting from that point is identical to the
 * original curve continuing from there.
 *
 * `Infinity` means genuinely, permanently unaffordable (`V1 <= 0` below — a zero or negative
 * effective earning rate, which truly never accumulates money) — NOT "would take a very long
 * time." A near-zero-but-positive rate combined with an expensive item can produce a wait of years
 * or more; that's still a real, finite answer, and callers that treat `Infinity` as "no path
 * exists" (e.g. the milestone chain's "give up" branches) depend on that distinction being exact.
 * Deliberately does not cap or round this down to `Infinity` past some "practical" threshold —
 * that was tried once and it broke exactly this: a slow-but-real path got reported as impossible.
 * Anything downstream that only cares about a bounded horizon (e.g. `boostTransitionsFrom`'s tail
 * approximation, or a UI display cutoff like `formatDuration`'s `>999d`) should apply its own
 * bound at its own layer instead of relying on this function to lie about reachability.
 */
export function getTimeToSave(
  cost: number,
  prevSnapshot: CalculationsSnapshot,
  transitions: EarningsRateTransition[] = []
): number {
  const effectiveCost = Math.max(0, cost - (prevSnapshot.bankValue || 0));
  if (effectiveCost <= 0) return 0;

  const V1 = prevSnapshot.elr > 0 ? prevSnapshot.offlineEarnings / prevSnapshot.elr : 0;
  if (V1 <= 0) return Infinity;

  // `prevSnapshot.earningsBoost.multiplier` is only trustworthy for the snapshot's OWN current
  // `active` state — it gets reset to 1 whenever a boost is toggled off (see
  // `EARNINGS_BOOST_MULTIPLIER`'s doc comment), so it can't be used to project the rate for the
  // OPPOSITE state (e.g. an upcoming boost while currently inactive). Use the snapshot's real
  // current rate (`V1`) for the current state, and the fixed constant for the other.
  const currentActive = prevSnapshot.earningsBoost.active;
  const rateFor = (active: boolean) =>
    active === currentActive ? V1 : active ? V1 * EARNINGS_BOOST_MULTIPLIER : V1 / EARNINGS_BOOST_MULTIPLIER;

  const P0 = prevSnapshot.population;
  const I = prevSnapshot.offlineIHR / 60;
  const R = prevSnapshot.ratePerChickenPerSecond;
  const S = prevSnapshot.shippingCapacity;
  const HabCap = prevSnapshot.habCapacity;
  const eggsAt = (t: number) => integrateRate(t, P0, I, R, S, HabCap);
  const popAt = (t: number) => Math.min(HabCap, P0 + I * t);

  const past = transitions.filter(t => t.atSeconds <= 0).sort((a, b) => b.atSeconds - a.atSeconds);
  const future = transitions.filter(t => t.atSeconds > 0).sort((a, b) => a.atSeconds - b.atSeconds);

  let segmentActive = past.length > 0 ? past[0].boostActive : currentActive;
  let segmentStart = 0;
  let dollarsSoFar = 0;

  const regimeEnds = [...future.map(t => t.atSeconds), Infinity];

  for (let i = 0; i < regimeEnds.length; i++) {
    const regimeEnd = regimeEnds[i];
    const rate = rateFor(segmentActive);
    const dollarsAvailable = regimeEnd === Infinity ? Infinity : rate * (eggsAt(regimeEnd) - eggsAt(segmentStart));

    if (dollarsSoFar + dollarsAvailable >= effectiveCost) {
      const neededEggs = (effectiveCost - dollarsSoFar) / rate;
      const tWithinRegime = solveForTime(neededEggs, popAt(segmentStart), I, R, S, HabCap);
      return segmentStart + tWithinRegime;
    }

    dollarsSoFar += dollarsAvailable;
    segmentStart = regimeEnd;
    segmentActive = i < future.length ? future[i].boostActive : segmentActive;
  }

  return Infinity;
}
