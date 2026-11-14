/**
 * Hab Space chain: the earnings research to buy before the habs fill, followed by the hab space
 * purchase (a bigger hab, or a hab capacity research level) that keeps them from filling.
 *
 * Each round:
 * 1. List every hab space purchase (any slot to any bigger hab, plus the next level of each hab
 *    capacity research) with how much space it adds per currency spent.
 * 2. Pick the target: the best space per currency among the purchases that can be afforded before
 *    the habs fill, moved up to the biggest one affordable within a minute of it (see
 *    `pickHabSpaceTarget`). If none can be afforded in time, the habs fill no matter what, so pick
 *    the same way among all of them and get there as fast as possible.
 * 3. Try an earnings research detour (`findRoiDetour`, the milestone chain's own candidate search).
 *    Before the habs fill, every research affordable in the time left is tried (in payback order, not
 *    just the best few), and any that passes the usual 70%-by-next-sale bar is taken as long
 *    as the target can still be afforded before the (possibly sooner, if the research raised the
 *    hatchery rate) moment the habs fill. Once the habs are going to fill anyway, a detour has to
 *    pay for itself before the target would have been bought without it, the same rule the
 *    research-level milestone uses, so it only ever gets the target sooner.
 * 4. If no detour is taken but the next research sale starts before the deadline (the habs filling,
 *    or once they're going to fill anyway, the target's own wait), skip ahead to the sale and go
 *    back to step 1: the 70% bar looks a week further ahead from there and research is discounted,
 *    the same reason the research-level milestone skips ahead to sales. Before the habs fill this
 *    only happens if the target can still be afforded in time afterward.
 * 5. Otherwise buy the target and stop.
 *
 * Hab capacity research never counts as an earnings detour, only as hab space.
 */
import { isHabId } from '../../farm/hab_space';
import { getHabById, countHabsOfType, type HabCostModifiers } from '../habs';
import { calculateHabCapacity, calculateTotalResearchMultipliers, getHabCapacityResearches } from './habCapacity';
import {
  getResearchById,
  isTierUnlocked,
  type ResearchCostModifiers,
} from '@planner/calculations/commonResearch';
import { getSaleAwareTimeToSave } from './researchROI';
import {
  findRoiDetour,
  MILESTONE_MAX_STEPS,
  type ChainItem,
} from './milestoneChain';
import type { EngineState, SimulationContext } from '@planner/engine/types';
import type { CalculationsSnapshot } from '@planner/types';
import { computeSnapshot } from '../engine/compute';
import { createBaseEngineState } from '../engine/adapter';
import { applyAction, applyTime, boostTransitionsFrom, getTimeToSave } from '@planner/engine/apply';
import { getNextSaleStart, isResearchSaleActive, isEarningsBoostActive } from '../events';
import { calculateArtifactModifiers, activeSlots } from '@planner/lib/artifacts';
import { PROFILE } from '@planner/lib/profile';

const HAB_SLOT_COUNT = 4;
// How many sales the chain may skip ahead to (about 10 years of weekly sales). Past that the target
// is just bought, so a hab space purchase decades away still shows up instead of the chain giving up.
const MAX_SALE_SKIPS = 520;
const MAX_HAB_ID = 18;

export type HabSpaceTarget =
  | { kind: 'hab'; slotIndex: number; habId: number; fromHabId: number | null }
  | { kind: 'research'; researchId: string; fromLevel: number };

export interface HabSpaceCandidate {
  target: HabSpaceTarget;
  addedCapacity: number;
  price: number;
  waitSeconds: number;
  duringSale: boolean;
  /** Hab space added per unit of currency. Infinity for a free purchase. */
  spacePerCost: number;
}

export interface HabSpaceTargetPurchase {
  candidate: HabSpaceCandidate;
  /** Seconds from the chain's start until the target is bought. */
  buyToHereSeconds: number;
  duringEarningsBoost: boolean;
}

export interface HabSpaceChainResult {
  /** Earnings research bought ahead of the target, in order. */
  items: ChainItem[];
  target: HabSpaceTargetPurchase | null;
  totalSeconds: number;
  /** Whether the habs were already full when the chain started. */
  habsFullAtStart: boolean;
  /** Seconds from the chain's start until the habs fill, with nothing bought. */
  fullInSecondsAtStart: number;
  /**
   * Seconds from the chain's start until the habs fill if nothing beyond the chain's earnings
   * research is bought (hatchery research in the chain makes this sooner). 0 when already full.
   */
  fullAtSeconds: number;
  /** Whether the target is bought before the habs fill. */
  beatsFull: boolean;
  capacityBefore: number;
  capacityAfter: number;
  /** Earnings per second at the start, and once the chain (target included) is bought. */
  earningsBefore: number;
  earningsAfter: number;
}

export function emptyHabSpaceChainResult(): HabSpaceChainResult {
  return {
    items: [],
    target: null,
    totalSeconds: 0,
    habsFullAtStart: false,
    fullInSecondsAtStart: 0,
    fullAtSeconds: 0,
    beatsFull: false,
    capacityBefore: 0,
    capacityAfter: 0,
    earningsBefore: 0,
    earningsAfter: 0,
  };
}

/** Seconds until population reaches hab capacity: 0 when already full, Infinity with no growth. */
export function secondsUntilHabsFull(snapshot: CalculationsSnapshot): number {
  if (snapshot.population >= snapshot.habCapacity) return 0;
  const perSecond = snapshot.offlineIHR / 60;
  if (perSecond <= 0) return Infinity;
  return (snapshot.habCapacity - snapshot.population) / perSecond;
}

export const HAB_CAPACITY_RESEARCH_IDS: ReadonlySet<string> = new Set(getHabCapacityResearches().map(r => r.id));

function slotHabIds(habIds: (number | null)[]): (number | null)[] {
  return Array.from({ length: HAB_SLOT_COUNT }, (_, i) => habIds[i] ?? null);
}

function totalCapacity(
  habIds: (number | null)[],
  researchLevels: Record<string, number>,
  habCapMultiplier: number,
  artifactMultiplier: number
): number {
  const { universal, portalOnly } = calculateTotalResearchMultipliers(researchLevels);
  let total = 0;
  for (const id of habIds) {
    if (id === null || !isHabId(id)) continue;
    total += calculateHabCapacity(getHabById(id), universal, portalOnly, habCapMultiplier, artifactMultiplier);
  }
  return total;
}

function habCostModifiers(context: SimulationContext): HabCostModifiers {
  return {
    cheaperContractorsLevel: context.epicResearchLevels['cheaper_contractors'] || 0,
    habCostMultiplier: context.colleggtibleModifiers.habCost,
  };
}

/** Price and wait for a target from the given state, or null if it can no longer be bought. */
function priceTarget(
  target: HabSpaceTarget,
  state: EngineState,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteTime: number
): { price: number; waitSeconds: number; duringSale: boolean } | null {
  const transitions = boostTransitionsFrom(snapshot, absoluteTime);

  if (target.kind === 'hab') {
    if (!isHabId(target.habId)) return null;
    const habIds = slotHabIds(state.habIds);
    const current = habIds[target.slotIndex];
    if (current !== null && current >= target.habId) return null;
    const others = habIds.filter((_, i) => i !== target.slotIndex);
    const isSale = state.activeSales.hab;
    const price = PROFILE.pricing.hab(
      getHabById(target.habId),
      countHabsOfType(others, target.habId),
      habCostModifiers(context),
      isSale
    );
    return { price, waitSeconds: getTimeToSave(price, snapshot, transitions), duringSale: isSale };
  }

  const research = getResearchById(target.researchId);
  if (!research) return null;
  const level = state.researchLevels[research.id] || 0;
  if (level >= research.levels || level !== target.fromLevel) return null;
  return getSaleAwareTimeToSave(
    research,
    level,
    mods,
    isResearchSaleActive(absoluteTime),
    absoluteTime,
    snapshot,
    transitions
  );
}

/** Every hab space purchase available from `state` that can ever be afforded. */
export function listHabSpaceCandidates(
  state: EngineState,
  snapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteTime: number
): HabSpaceCandidate[] {
  const habCapMultiplier = context.colleggtibleModifiers.habCap;
  const artifactMultiplier = calculateArtifactModifiers(activeSlots(state.artifactLoadout, state.proPermit)).habCapacity
    .totalMultiplier;
  const habIds = slotHabIds(state.habIds);
  const current = totalCapacity(habIds, state.researchLevels, habCapMultiplier, artifactMultiplier);

  const targets: { target: HabSpaceTarget; addedCapacity: number }[] = [];

  for (let slotIndex = 0; slotIndex < HAB_SLOT_COUNT; slotIndex++) {
    const fromHabId = habIds[slotIndex];
    for (let habId = fromHabId === null ? 0 : fromHabId + 1; habId <= MAX_HAB_ID; habId++) {
      const nextIds = habIds.map((id, i) => (i === slotIndex ? habId : id));
      const addedCapacity =
        totalCapacity(nextIds, state.researchLevels, habCapMultiplier, artifactMultiplier) - current;
      if (addedCapacity > 0) targets.push({ target: { kind: 'hab', slotIndex, habId, fromHabId }, addedCapacity });
    }
  }

  for (const { id } of getHabCapacityResearches()) {
    const research = getResearchById(id);
    if (!research) continue;
    const level = state.researchLevels[id] || 0;
    if (level >= research.levels || !isTierUnlocked(state.researchLevels, research.tier)) continue;
    const nextLevels = { ...state.researchLevels, [id]: level + 1 };
    const addedCapacity = totalCapacity(habIds, nextLevels, habCapMultiplier, artifactMultiplier) - current;
    if (addedCapacity > 0) targets.push({ target: { kind: 'research', researchId: id, fromLevel: level }, addedCapacity });
  }

  const candidates: HabSpaceCandidate[] = [];
  for (const { target, addedCapacity } of targets) {
    const purchase = priceTarget(target, state, snapshot, context, mods, absoluteTime);
    if (!purchase || !isFinite(purchase.waitSeconds)) continue;
    candidates.push({
      target,
      addedCapacity,
      ...purchase,
      spacePerCost: purchase.price > 0 ? addedCapacity / purchase.price : Infinity,
    });
  }
  return candidates;
}

function bestSpacePerCost(candidates: HabSpaceCandidate[]): HabSpaceCandidate {
  return candidates.reduce((best, c) =>
    c.spacePerCost > best.spacePerCost || (c.spacePerCost === best.spacePerCost && c.waitSeconds < best.waitSeconds)
      ? c
      : best
  );
}

/**
 * How much longer than the most efficient purchase a bigger one may take and still be picked
 * instead. When hab space is cheap, the best space per currency is often a tiny upgrade (a Coop)
 * while far more space costs no real extra time.
 */
const BIGGER_TARGET_EXTRA_SECONDS = 60;

/**
 * The target for this round, among the purchases that can be afforded before the habs fill (or
 * among all of them when none can, since the habs fill no matter what):
 * 1. Start from the best space per currency.
 * 2. Then take the most hab space among the purchases affordable within
 *    BIGGER_TARGET_EXTRA_SECONDS of that one, ties going to the better space per currency.
 */
export function pickHabSpaceTarget(
  candidates: HabSpaceCandidate[],
  fullInSeconds: number
): { candidate: HabSpaceCandidate; beatsFull: boolean } | null {
  if (candidates.length === 0) return null;
  const inTime = candidates.filter(c => c.waitSeconds <= fullInSeconds);
  const beatsFull = inTime.length > 0;
  const pool = beatsFull ? inTime : candidates;
  const efficient = bestSpacePerCost(pool);
  const limit = efficient.waitSeconds + BIGGER_TARGET_EXTRA_SECONDS;
  const candidate = pool
    .filter(c => c.waitSeconds <= limit)
    .reduce((best, c) =>
      c.addedCapacity > best.addedCapacity ||
      (c.addedCapacity === best.addedCapacity && c.spacePerCost > best.spacePerCost)
        ? c
        : best
    );
  return { candidate, beatsFull };
}

export function computeHabSpaceChain(
  startSnapshot: CalculationsSnapshot,
  context: SimulationContext,
  mods: ResearchCostModifiers,
  absoluteSimTimeAtStart: number,
  researchSaleDeadline: number
): HabSpaceChainResult {
  let state = createBaseEngineState(startSnapshot);
  let snapshot = startSnapshot;
  let totalSeconds = 0;
  const items: ChainItem[] = [];
  const fullInSecondsAtStart = secondsUntilHabsFull(startSnapshot);
  // Latest estimate of when the habs fill. Once they are full they stay full, so a round that finds
  // them full keeps the estimate from the round before (when they filled during its detour).
  let fullAtSeconds = fullInSecondsAtStart;

  const result = (target: HabSpaceTargetPurchase | null): HabSpaceChainResult => ({
    items,
    target,
    totalSeconds,
    habsFullAtStart: fullInSecondsAtStart === 0,
    fullInSecondsAtStart,
    fullAtSeconds,
    beatsFull: target !== null && fullInSecondsAtStart > 0 && totalSeconds <= fullAtSeconds + 1e-6,
    capacityBefore: startSnapshot.habCapacity,
    capacityAfter: snapshot.habCapacity,
    earningsBefore: startSnapshot.offlineEarnings,
    earningsAfter: snapshot.offlineEarnings,
  });

  let saleSkips = 0;
  // Every round either buys research, skips ahead to a sale (at most MAX_SALE_SKIPS times) or returns.
  while (items.length < MILESTONE_MAX_STEPS) {
    const now = absoluteSimTimeAtStart + totalSeconds;
    const fullIn = secondsUntilHabsFull(snapshot);
    if (fullIn > 0) fullAtSeconds = totalSeconds + fullIn;
    const pick = pickHabSpaceTarget(listHabSpaceCandidates(state, snapshot, context, mods, now), fullIn);
    if (!pick) return result(null);
    const { candidate, beatsFull } = pick;
    // Habs that never fill (no population growth) put no deadline on the chain, so it gets the hab
    // space as fast as possible instead, same as when they're going to fill anyway.
    const deadlineLimited = beatsFull && isFinite(fullIn);

    const detour = findRoiDetour(
      state,
      snapshot,
      context,
      mods,
      now,
      researchSaleDeadline,
      undefined,
      // Before the habs fill, the deadline is what limits detours, not the target's own wait.
      deadlineLimited ? Infinity : candidate.waitSeconds,
      HAB_CAPACITY_RESEARCH_IDS,
      deadlineLimited
        ? detourResult =>
            targetStillFits(candidate, detourResult.state, detourResult.snapshot, now + detourResult.totalSecondsSpent)
              ? 0
              : null
        : () => 0,
      // Spend as much of the time before the habs fill on earnings research as possible: try every
      // research that can be afforded in that time, not just the best few by payback.
      deadlineLimited ? fullIn : undefined,
      // Vehicles and train cars are earnings detours here; habs never are, they're the target.
      { includeHabs: false }
    );

    if (detour) {
      for (const item of detour.items) {
        items.push({ ...item, buyToHereSeconds: totalSeconds + item.buyToHereSeconds });
      }
      state = detour.state;
      snapshot = detour.snapshot;
      totalSeconds += detour.totalSeconds;
      continue;
    }

    // No detour fits. Skip ahead to the next sale if it starts before the deadline.
    const nextSaleStart = getNextSaleStart(now);
    const deadline = now + (deadlineLimited ? fullIn : candidate.waitSeconds);
    if (saleSkips < MAX_SALE_SKIPS && nextSaleStart < deadline) {
      const idleSeconds = nextSaleStart - now;
      const idleState = applyTime(state, idleSeconds, snapshot, { transitions: boostTransitionsFrom(snapshot, now) });
      const idleSnapshot = computeSnapshot(idleState, context, { skipEpochConversion: true });
      if (!deadlineLimited || targetStillFits(candidate, idleState, idleSnapshot, nextSaleStart)) {
        state = idleState;
        snapshot = idleSnapshot;
        totalSeconds += idleSeconds;
        saleSkips++;
        continue;
      }
    }

    // Buy the target.
    const transitions = boostTransitionsFrom(snapshot, now);
    const target = candidate.target;
    state =
      target.kind === 'hab'
        ? applyAction(state, {
            type: 'buy_hab',
            payload: { slotIndex: target.slotIndex, habId: target.habId },
            cost: candidate.price,
          })
        : applyAction(state, {
            type: 'buy_research',
            payload: { researchId: target.researchId, fromLevel: target.fromLevel, toLevel: target.fromLevel + 1 },
            cost: candidate.price,
          });
    state = applyTime(state, candidate.waitSeconds, snapshot, { transitions });
    snapshot = computeSnapshot(state, context, { skipEpochConversion: true });
    totalSeconds += candidate.waitSeconds;

    const completesAt = absoluteSimTimeAtStart + totalSeconds;
    return result(
      { candidate, buyToHereSeconds: totalSeconds, duringEarningsBoost: isEarningsBoostActive(completesAt) }
    );
  }

  return result(null);

  /** Whether `candidate` can still be afforded before the habs fill, from the given point. */
  function targetStillFits(
    candidate: HabSpaceCandidate,
    atState: EngineState,
    atSnapshot: CalculationsSnapshot,
    atTime: number
  ): boolean {
    const fullInAfter = secondsUntilHabsFull(atSnapshot);
    if (fullInAfter <= 0) return false;
    const after = priceTarget(candidate.target, atState, atSnapshot, context, mods, atTime);
    return !!after && after.waitSeconds <= fullInAfter;
  }
}
