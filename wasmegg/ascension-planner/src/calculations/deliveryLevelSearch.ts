import { getCommonResearches, getDiscountedVirtuePrice, isTierUnlocked } from './commonResearch';
import type { CommonResearch, ResearchCostModifiers } from './commonResearch';
import { computeRealisticELR } from './realisticELR';
import { DELIVERY_IMPACT_CATEGORIES } from './researchRanking';
import { calculateMaxTrainLength, calculateMaxVehicleSlots, GRAVITON_COUPLING_ID } from 'lib/planners/calculations/shippingCapacity';
import { calculateArtifactModifiers } from '@/lib/artifacts';
import { getOptimalELRSetFromSource, type DeliverySource } from '@/lib/artifacts/virtue';
import type { SimulationContext } from '@/engine/types';
import type { CalculationsSnapshot } from '@/types';

/**
 * Past this many steps of trying every combination, the caller falls back to the greedy buy loop.
 * Only a budget that reaches many cheap levels of several researches at once gets near it.
 */
const MAX_SEARCH_STEPS = 500_000;

/**
 * How long a plan's delivery rate is assumed to run, for weighing a higher rate against starting
 * later. A level is only worth waiting for if it saves more than the wait over this long. Set above
 * what most ascensions spend at peak because waiting isn't wasted: the farm keeps delivering, and K3
 * waits for the sale to end regardless. Picked by comparing whole-table results at +20 to +50 TE.
 */
const SECONDS_AT_PEAK_RATE = 2500 * 3600;

/** Rates this close count as equal, so rounding can't justify buying a level. */
const RATE_TOLERANCE = 1e-9;

/**
 * What a delivery plan costs in time, lower being better: when its last purchase lands, plus how
 * long delivery then takes at its rate. Comparable only between plans using the same `referenceRate`.
 */
export function deliveryPlanCost(finishSeconds: number, rate: number, referenceRate: number): number {
  return finishSeconds + (SECONDS_AT_PEAK_RATE * referenceRate) / rate;
}

export interface DeliveryLevelSet {
  levels: Record<string, number>;
  /** Delivery rate at `levels`, on the delivery set H1 will equip. */
  rate: number;
  gems: number;
}

/** Scores research levels the way the ranking and H1 do: optimal stones, max habs and vehicles. */
export function deliveryRateScorer(
  source: DeliverySource,
  startLevels: Record<string, number>,
  proPermit: CalculationsSnapshot['proPermit'],
  context: SimulationContext
): (levels: Record<string, number>) => number {
  const options = {
    proPermit,
    assumeMaxHabsVehicles: true,
    excludeGusset: false,
    epicResearchLevels: context.epicResearchLevels,
    colleggtibleModifiers: context.colleggtibleModifiers,
  };
  // Research changes which stones are best, never which artifacts are: see `forcedArtifacts`.
  const forcedArtifacts = getOptimalELRSetFromSource(source, { ...options, commonResearch: startLevels }).map(
    slot => slot.artifactId
  );
  return levels => {
    const set = getOptimalELRSetFromSource(source, { ...options, commonResearch: levels, forcedArtifacts });
    return computeRealisticELR(
      levels,
      calculateArtifactModifiers(set),
      context.epicResearchLevels,
      context.colleggtibleModifiers
    ).effectiveRate;
  };
}

function deliveryCandidates(startLevels: Record<string, number>): CommonResearch[] {
  return getCommonResearches()
    .filter(
      r =>
        (startLevels[r.id] || 0) < r.levels &&
        r.categories.split(',').some(category => DELIVERY_IMPACT_CATEGORIES.has(category))
    )
    .sort((a, b) => a.tier - b.tier);
}

/**
 * Research that shares one effect, bought cheapest level first. A level's effect is additive within
 * its research, while separate researches multiply, so `multiplierAfter` is the side's rate after
 * `levelsBought` levels of this group, relative to none.
 */
export interface DeliveryResearchGroup {
  side: 'laying' | 'shipping';
  members: CommonResearch[];
  multiplierAfter: (levelsBought: number) => number;
}

/**
 * Sorts research by how it reaches the delivery rate. Fleet size research all adds the same one
 * vehicle, so it counts as one group, as long as every level adds exactly that much. The spec checks
 * these effects against `computeRealisticELR`, so a new kind of research fails there.
 */
export function deliveryResearchGroups(
  candidates: CommonResearch[],
  startLevels: Record<string, number>
): DeliveryResearchGroup[] {
  const groups: DeliveryResearchGroup[] = [];
  const fleet: CommonResearch[] = [];

  for (const r of candidates) {
    const categories = r.categories.split(',');
    if (r.effect_type === 'multiplicative') {
      const before = 1 + r.per_level * (startLevels[r.id] || 0);
      groups.push({
        side: categories.includes('egg_laying_rate') || categories.includes('hab_capacity') ? 'laying' : 'shipping',
        members: [r],
        multiplierAfter: levelsBought => (before + r.per_level * levelsBought) / before,
      });
    } else if (r.id === GRAVITON_COUPLING_ID) {
      const before = calculateMaxTrainLength(startLevels);
      groups.push({ side: 'shipping', members: [r], multiplierAfter: levelsBought => (before + levelsBought) / before });
    } else {
      fleet.push(r);
    }
  }
  if (fleet.length > 0) {
    const before = calculateMaxVehicleSlots(startLevels);
    groups.push({ side: 'shipping', members: fleet, multiplierAfter: levelsBought => (before + levelsBought) / before });
  }
  return groups;
}

/** One way of spending on one side, built up a group at a time. */
interface SideSpend {
  gems: number;
  multiplier: number;
  /** Levels this group's purchase reaches, then `parent` for the groups before it. */
  levels: Record<string, number>;
  parent: SideSpend | null;
}

function applySpend(spend: SideSpend, levels: Record<string, number>): void {
  for (let s: SideSpend | null = spend; s; s = s.parent) Object.assign(levels, s.levels);
}

/**
 * Every spend on one side that nothing beats, cheapest first: each has a higher multiplier than any
 * cheaper one. A spend left out is never needed, since swapping it for one that costs no more and
 * multiplies at least as much can't lower the rate, whichever stones are best afterwards.
 */
function unbeatenSpends(
  groups: DeliveryResearchGroup[],
  startLevels: Record<string, number>,
  limit: number,
  mods: ResearchCostModifiers,
  isSale: boolean
): SideSpend[] {
  let spends: SideSpend[] = [{ gems: 0, multiplier: 1, levels: {}, parent: null }];

  for (const group of groups) {
    const owned = Object.fromEntries(group.members.map(r => [r.id, startLevels[r.id] || 0]));
    const steps = [{ gems: 0, multiplier: 1, levels: {} as Record<string, number> }];
    for (let bought = 1; ; bought++) {
      let next: CommonResearch | null = null;
      let price = Infinity;
      for (const r of group.members) {
        if (owned[r.id] >= r.levels) continue;
        const p = getDiscountedVirtuePrice(r, owned[r.id], mods, isSale);
        if (p < price) {
          next = r;
          price = p;
        }
      }
      const gems = steps[steps.length - 1].gems + price;
      if (!next || gems > limit) break;
      owned[next.id]++;
      steps.push({ gems, multiplier: group.multiplierAfter(bought), levels: { ...owned } });
    }

    const combined: SideSpend[] = [];
    for (const spend of spends) {
      for (const step of steps) {
        const gems = spend.gems + step.gems;
        if (gems <= limit) {
          combined.push({ gems, multiplier: spend.multiplier * step.multiplier, levels: step.levels, parent: spend });
        }
      }
    }
    combined.sort((a, b) => a.gems - b.gems || b.multiplier - a.multiplier);
    spends = [];
    let highest = 0;
    for (const spend of combined) {
      if (spend.multiplier > highest * (1 + RATE_TOLERANCE)) {
        spends.push(spend);
        highest = spend.multiplier;
      }
    }
  }
  return spends;
}

/**
 * Returns a search for the delivery research levels giving the highest delivery rate for a budget up
 * to `maxBudget`, best first. Levels are compared within laying and within shipping, and every split
 * of the money between those two is scored, rather than buying the best hr/% until it runs out. A
 * greedy pass can spend the budget on efficient but expensive levels and leave too little for
 * anything else, and only this finds levels that help only together.
 *
 * A side that isn't limiting the rate gets only what the rate needs, so tied sets come back at their
 * cheapest; `dropLevelsNotWorthTheirTime` then decides how much of the rest is worth buying. Returns
 * null when a budget's search is too large to finish.
 */
export function createDeliveryLevelSearch(
  startLevels: Record<string, number>,
  maxBudget: number,
  mods: ResearchCostModifiers,
  isSale: boolean,
  rateOf: (levels: Record<string, number>) => number
): (budget: number, maxResults: number) => DeliveryLevelSet[] | null {
  const candidates = deliveryCandidates(startLevels);
  const open = candidates.filter(r => isTierUnlocked(startLevels, r.tier));
  const locked = candidates.filter(r => !isTierUnlocked(startLevels, r.tier));
  let sides: { laying: SideSpend[]; shipping: SideSpend[] } | null = null;

  return (budget, maxResults) => {
    // Unlocking a tier depends on how many levels get bought, which comparing spends can't see.
    if (locked.some(r => getDiscountedVirtuePrice(r, startLevels[r.id] || 0, mods, isSale) <= budget)) {
      return searchEveryDeliveryCombination(startLevels, budget, mods, isSale, rateOf, maxResults);
    }
    if (!sides) {
      const groups = deliveryResearchGroups(open, startLevels);
      const spendsOn = (side: DeliveryResearchGroup['side']) =>
        unbeatenSpends(groups.filter(g => g.side === side), startLevels, maxBudget, mods, isSale);
      sides = { laying: spendsOn('laying'), shipping: spendsOn('shipping') };
    }
    const { laying, shipping } = sides;

    const setAt = (lay: number, ship: number): DeliveryLevelSet => {
      const levels = { ...startLevels };
      for (const r of candidates) levels[r.id] = levels[r.id] || 0;
      applySpend(laying[lay], levels);
      applySpend(shipping[ship], levels);
      return { levels, rate: rateOf(levels), gems: laying[lay].gems + shipping[ship].gems };
    };
    const ties = (a: number, b: number) => Math.abs(a - b) <= b * RATE_TOLERANCE;

    // Each laying spend with the most shipping the rest of the budget buys.
    const splits: { lay: number; ship: number; rate: number; gems: number }[] = [];
    let ship = shipping.length - 1;
    for (let lay = 0; lay < laying.length; lay++) {
      while (ship > 0 && laying[lay].gems + shipping[ship].gems > budget) ship--;
      if (laying[lay].gems + shipping[ship].gems > budget) break;
      splits.push({ lay, ship, ...setAt(lay, ship) });
    }
    splits.sort((a, b) => (ties(a.rate, b.rate) ? a.gems - b.gems : b.rate - a.rate));

    const results: DeliveryLevelSet[] = [];
    const seen = new Set<string>();
    for (const split of splits) {
      if (results.length === maxResults) break;
      const cheapest = (high: number, rateAt: (index: number) => number) => {
        let low = 0;
        while (low < high) {
          const middle = (low + high) >> 1;
          if (ties(rateAt(middle), split.rate)) high = middle;
          else low = middle + 1;
        }
        return high;
      };
      const needShip = cheapest(split.ship, index => setAt(split.lay, index).rate);
      const needLay = cheapest(split.lay, index => setAt(index, needShip).rate);
      const key = `${needLay}:${needShip}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(setAt(needLay, needShip));
    }
    return results;
  };
}

/** The best delivery research levels for `budget`: see `createDeliveryLevelSearch`. */
export function findBestDeliveryLevels(
  startLevels: Record<string, number>,
  budget: number,
  mods: ResearchCostModifiers,
  isSale: boolean,
  rateOf: (levels: Record<string, number>) => number,
  maxResults = 16
): DeliveryLevelSet[] | null {
  return createDeliveryLevelSearch(startLevels, budget, mods, isSale, rateOf)(budget, maxResults);
}

/**
 * Tries every combination of levels, for when buying one level can unlock another tier. Only sets
 * with room for nothing more are scored, since a further level never lowers the rate. Returns null
 * when the search is too large to finish.
 */
export function searchEveryDeliveryCombination(
  startLevels: Record<string, number>,
  budget: number,
  mods: ResearchCostModifiers,
  isSale: boolean,
  rateOf: (levels: Record<string, number>) => number,
  maxResults = 16
): DeliveryLevelSet[] | null {
  // Lowest tier first, so a tier's unlock is settled by the time the search reaches it.
  const candidates = deliveryCandidates(startLevels);
  const unlockedAtStart = new Set(candidates.filter(r => isTierUnlocked(startLevels, r.tier)).map(r => r.tier));

  const levels = { ...startLevels };
  for (const r of candidates) levels[r.id] = levels[r.id] || 0;
  const isUnlocked = (tier: number) => unlockedAtStart.has(tier) || isTierUnlocked(levels, tier);

  const found: DeliveryLevelSet[] = [];
  let steps = 0;

  const visit = (index: number, gems: number): boolean => {
    if (++steps > MAX_SEARCH_STEPS) return false;
    if (index === candidates.length) {
      const hasRoom = candidates.some(
        r =>
          levels[r.id] < r.levels &&
          isUnlocked(r.tier) &&
          gems + getDiscountedVirtuePrice(r, levels[r.id], mods, isSale) <= budget
      );
      if (!hasRoom) found.push({ levels: { ...levels }, rate: rateOf(levels), gems });
      return true;
    }

    const r = candidates[index];
    const start = levels[r.id];
    let total = gems;
    let ok = visit(index + 1, total);
    while (ok && isUnlocked(r.tier) && levels[r.id] < r.levels) {
      total += getDiscountedVirtuePrice(r, levels[r.id], mods, isSale);
      if (total > budget) break;
      levels[r.id]++;
      ok = visit(index + 1, total);
    }
    levels[r.id] = start;
    return ok;
  };

  if (!visit(0, 0)) return null;
  return found.sort((a, b) => b.rate - a.rate || a.gems - b.gems).slice(0, maxResults);
}

/**
 * Removes the top level of whichever research saves the most time without it, until removing any
 * more would cost more than it saves. Delivery can't start until the last purchase is paid for, so
 * a level that adds nothing, or too little for its wait, makes the plan slower.
 */
export function dropLevelsNotWorthTheirTime(
  set: DeliveryLevelSet,
  startLevels: Record<string, number>,
  mods: ResearchCostModifiers,
  isSale: boolean,
  rateOf: (levels: Record<string, number>) => number,
  secondsToAfford: (gems: number) => number
): DeliveryLevelSet {
  const referenceRate = set.rate;
  const costOf = (gems: number, rate: number) => deliveryPlanCost(secondsToAfford(gems), rate, referenceRate);
  let current = set;

  for (;;) {
    const bought = getCommonResearches().filter(r => current.levels[r.id] > (startLevels[r.id] || 0));
    let best: DeliveryLevelSet | null = null;
    let bestCost = costOf(current.gems, current.rate);

    for (const r of bought) {
      const levels = { ...current.levels, [r.id]: current.levels[r.id] - 1 };
      if (!bought.every(b => levels[b.id] <= (startLevels[b.id] || 0) || isTierUnlocked(levels, b.tier))) continue;
      const gems = current.gems - getDiscountedVirtuePrice(r, levels[r.id], mods, isSale);
      const rawRate = rateOf(levels);
      // Rounding mustn't make a level look like it helps.
      const rate = Math.abs(rawRate - current.rate) <= current.rate * RATE_TOLERANCE ? current.rate : rawRate;
      const cost = costOf(gems, rate);
      if (cost < bestCost || (cost === bestCost && rate === current.rate && (!best || gems < best.gems))) {
        best = { levels, rate, gems };
        bestCost = cost;
      }
    }

    if (!best) return current;
    current = best;
  }
}
