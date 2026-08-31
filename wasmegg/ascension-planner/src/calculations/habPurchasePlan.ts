import {
  getHabById,
  getDiscountedHabPrice,
  countHabsOfType,
  isHabId,
  habTypes,
  type HabCostModifiers,
  type HabId,
} from '@/lib/habs';
import { calculateHabCapacity } from '@/calculations/habCapacity';
import { getTimeToSave } from '@/engine/apply';
import type { CalculationsSnapshot } from '@/types';

export const CHICKEN_UNIVERSE_ID = 18;

export interface HabMultipliers {
  universalMultiplier: number;
  portalMultiplier: number;
  habCapMultiplier: number;
  artifactMultiplier: number;
}

export interface HabPurchaseStep {
  slotIndex: number;
  habId: number;
  cost: number;
  waitSeconds: number;
}

export interface HabPlanResult {
  steps: HabPurchaseStep[];
  totalSeconds: number;
  allMaxed: boolean;
}

// How soon a hab has to become affordable to count as a "quick interim buy" -
// matches the threshold src/auto/shifts/i1.ts uses for the same decision.
export const INTERIM_HAB_THRESHOLD_SECONDS = 10;

function capacityOf(habId: number, multipliers: HabMultipliers): number {
  if (!isHabId(habId)) return 0;
  const hab = getHabById(habId);
  if (!hab) return 0;

  return calculateHabCapacity(
    hab,
    multipliers.universalMultiplier,
    multipliers.portalMultiplier,
    multipliers.habCapMultiplier,
    multipliers.artifactMultiplier
  );
}

/**
 * Pick the next hab purchase (any slot, any hab level above that slot's current one)
 * from the given virtual snapshot. Prefers the highest-tier hab reachable within
 * INTERIM_HAB_THRESHOLD_SECONDS over a "better ROI" small upgrade - e.g. if a
 * Planet Portal is affordable in 0s, buy it outright instead of stepping through
 * every cheaper hab on the way there. Only falls back to whichever upgrade becomes
 * affordable soonest when nothing is reachable within the threshold, since then
 * there's no quick win available and we just need to keep progressing.
 */
function findBestNextHabPurchase(
  virtualSnapshot: CalculationsSnapshot,
  virtualHabIds: (number | null)[],
  mods: HabCostModifiers,
  isSaleActive: boolean,
  multipliers: HabMultipliers
) {
  const candidates: { slotIndex: number; habId: number; cost: number; waitSeconds: number }[] = [];

  for (let slotIndex = 0; slotIndex < 4; slotIndex++) {
    const currentId = virtualHabIds[slotIndex];
    const startId = currentId === null ? 0 : currentId + 1;

    for (let habId = startId; habId <= CHICKEN_UNIVERSE_ID; habId++) {
      const hab = getHabById(habId as HabId);
      if (!hab) continue;

      const currentCap = currentId !== null ? capacityOf(currentId, multipliers) : 0;
      const newCap = capacityOf(habId, multipliers);
      if (newCap - currentCap <= 0) continue;

      const otherHabs = virtualHabIds.filter((_, i) => i !== slotIndex);
      const existingCount = countHabsOfType(otherHabs, habId);
      const cost = getDiscountedHabPrice(hab, existingCount, mods, isSaleActive);

      const waitSeconds = getTimeToSave(cost, virtualSnapshot);
      if (waitSeconds === Infinity) continue;

      candidates.push({ slotIndex, habId, cost, waitSeconds });
    }
  }

  if (candidates.length === 0) return null;

  const quickCandidates = candidates.filter(c => c.waitSeconds <= INTERIM_HAB_THRESHOLD_SECONDS);

  if (quickCandidates.length > 0) {
    // A quick win is available - grab the highest-tier one, not the best-ROI one.
    return quickCandidates.reduce((best, c) => {
      if (c.habId > best.habId) return c;
      if (c.habId === best.habId && c.waitSeconds < best.waitSeconds) return c;
      return best;
    });
  }

  // Nothing is reachable quickly - just take whichever becomes affordable soonest.
  return candidates.reduce((best, c) => {
    if (c.waitSeconds < best.waitSeconds) return c;
    if (c.waitSeconds === best.waitSeconds && c.habId > best.habId) return c;
    return best;
  });
}

/**
 * Simulate buying hab upgrades forward in time, always taking whichever upgrade
 * becomes affordable soonest across all slots and levels. This lets a cheap interim
 * hab get bought ahead of a distant Chicken Universe purchase whenever doing so
 * raises earnings enough to shorten the overall wait - the same idea as the
 * interim-hab step in src/auto/shifts/i1.ts, generalized to any number of interim
 * purchases in any slot instead of a single hardcoded lookahead.
 *
 * `shouldStop` is checked against the elapsed time a prospective purchase would
 * bring us to, so callers can cut the simulation off at a time budget (5-min button)
 * or let it run until every slot holds a Chicken Universe (max habs button).
 */
export function simulateHabPurchases(
  startSnapshot: CalculationsSnapshot,
  startHabIds: (number | null)[],
  mods: HabCostModifiers,
  isSaleActive: boolean,
  multipliers: HabMultipliers,
  shouldStop: (elapsedSeconds: number) => boolean
): HabPlanResult {
  const steps: HabPurchaseStep[] = [];
  let elapsedSeconds = 0;

  let virtualHabIds = [...startHabIds];
  let virtualBank = startSnapshot.bankValue || 0;
  let virtualPopulation = startSnapshot.population;
  let virtualHabCapacity = startSnapshot.habCapacity;

  // layRate/population and offlineEarnings/elr are fixed ratios of the game state
  // (hab purchases change capacity, not per-chicken rates), so we hold them fixed
  // and re-derive layRate/elr/offlineEarnings from the virtual population each step.
  const layRatePerChicken = startSnapshot.population > 0 ? startSnapshot.layRate / startSnapshot.population : 0;
  const earningsPerEgg = startSnapshot.elr > 0 ? startSnapshot.offlineEarnings / startSnapshot.elr : 0;

  const maxIterations = 4 * habTypes.length; // at most one purchase per hab tier per slot

  for (let i = 0; i < maxIterations; i++) {
    if (virtualHabIds.every(id => id === CHICKEN_UNIVERSE_ID)) break;
    if (shouldStop(elapsedSeconds)) break;

    const layRate = virtualPopulation * layRatePerChicken;
    const elr = Math.min(layRate, startSnapshot.shippingCapacity);
    const offlineEarnings = elr * earningsPerEgg;

    const virtualSnapshot: CalculationsSnapshot = {
      ...startSnapshot,
      habIds: virtualHabIds,
      bankValue: virtualBank,
      population: virtualPopulation,
      habCapacity: virtualHabCapacity,
      layRate,
      elr,
      offlineEarnings,
    };

    const best = findBestNextHabPurchase(virtualSnapshot, virtualHabIds, mods, isSaleActive, multipliers);
    if (!best) break;
    if (shouldStop(elapsedSeconds + best.waitSeconds)) break;

    // Advance virtual population/bank through the wait
    const I = startSnapshot.offlineIHR / 60;
    virtualPopulation = Math.min(virtualHabCapacity, virtualPopulation + I * best.waitSeconds);
    virtualBank = best.waitSeconds > 0 ? 0 : Math.max(0, virtualBank - best.cost);

    // Apply the purchase
    const currentId = virtualHabIds[best.slotIndex];
    const currentCap = currentId !== null ? capacityOf(currentId, multipliers) : 0;
    virtualHabIds = virtualHabIds.map((id, idx) => (idx === best.slotIndex ? best.habId : id));
    virtualHabCapacity += capacityOf(best.habId, multipliers) - currentCap;

    elapsedSeconds += best.waitSeconds;
    steps.push({ slotIndex: best.slotIndex, habId: best.habId, cost: best.cost, waitSeconds: best.waitSeconds });
  }

  return {
    steps,
    totalSeconds: elapsedSeconds,
    allMaxed: virtualHabIds.every(id => id === CHICKEN_UNIVERSE_ID),
  };
}
