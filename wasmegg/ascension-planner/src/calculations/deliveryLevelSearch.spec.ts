import { describe, expect, test } from 'vitest';
import { getCommonResearches, getDiscountedVirtuePrice, getResearchById, isTierUnlocked } from './commonResearch';
import type { ResearchCostModifiers } from './commonResearch';
import {
  deliveryPlanCost,
  deliveryRateScorer,
  deliveryResearchGroups,
  dropLevelsNotWorthTheirTime,
  findBestDeliveryLevels,
  searchEveryDeliveryCombination,
} from './deliveryLevelSearch';
import { computeRealisticELR } from './realisticELR';
import { DELIVERY_IMPACT_CATEGORIES, rankResearchByELRImpact } from './researchRanking';
import { runDeliveryBuyLoop, simulateSaleEndsBuy } from './smartBuyPreview';
import { computeSnapshot } from '@/engine/compute';
import { boostTransitionsFrom, getTimeToSave } from '@/engine/apply';
import { contextDeliverySource } from '@/auto/loadout/resolve';
import { calculateArtifactModifiers } from '@/lib/artifacts';
import { maxedBaseState, maxedContext } from '@/buildTable/maxedAccount';
import { getNextSaleEnd, getNextSaleStart } from 'lib/planners/events';

const context = maxedContext();
const source = contextDeliverySource(context)!;
const researchLevels = {
  ...Object.fromEntries(getCommonResearches().map(r => [r.id, r.levels])),
  wormhole_dampening: 18,
  hyper_portalling: 3,
  relativity_optimization: 3,
  neural_net_refine: 18,
};

function fullFarmSnapshot() {
  const state = {
    ...maxedBaseState(),
    te: 150,
    habIds: [18, 18, 18, 18],
    vehicles: [{ vehicleId: 11, trainLength: 10 }],
    researchLevels,
    population: 1e10,
    activeSales: { research: true, hab: false, vehicle: false },
  };
  const uncapped = computeSnapshot(state, context, { skipEpochConversion: true });
  return computeSnapshot({ ...state, population: uncapped.habCapacity }, context, { skipEpochConversion: true });
}

// The tester's account in its own units: earns 10.35qd an hour, and Wormhole Dampening 19 costs
// 267.339qd on sale. Scaling prices instead of overriding earnings keeps every later snapshot true.
const qd = (fullFarmSnapshot().offlineEarnings * 3600) / 10.35;
const mods: ResearchCostModifiers = {
  labUpgradeLevel: 0,
  researchCostMultiplier: 0.1805 * (qd / 1e45),
  puzzleCubeMultiplier: 1,
};

const snapshotWith = (bankQd: number) => ({ ...fullFarmSnapshot(), bankValue: bankQd * qd });

const saleStart = getNextSaleStart(1_790_000_000);
const midSale = saleStart + 2.3 * 3600;
const saleEnd = getNextSaleEnd(saleStart);

function rankAt(time: number, bankQd: number, isSale: boolean, viewMode: 'realistic' | 'potential' = 'realistic') {
  return rankResearchByELRImpact(
    researchLevels,
    source,
    snapshotWith(bankQd),
    context,
    mods,
    isSale,
    time,
    saleEnd,
    viewMode,
    'efficiency'
  );
}

describe('hr/% is scored at the price actually charged', () => {
  test.each(['realistic', 'potential'] as const)('%s: a sale item the bank covers, too dear to save for this sale', view => {
    const snapshot = snapshotWith(995);
    const item = rankAt(midSale, 995, true, view).find(c => c.research.id === 'wormhole_dampening')!;
    const fromZero = getTimeToSave(item.price, { ...snapshot, bankValue: 0 }, boostTransitionsFrom(snapshot, midSale));

    expect(item.price / qd).toBeCloseTo(267.339, 2);
    expect(item.duringSale).toBe(true);
    expect(fromZero).toBeGreaterThan(saleEnd - midSale);
    expect(item.hpp).toBeCloseTo(fromZero / 3600 / (item.impact! * 100), 6);
  });

  test('outside a sale, an item the bank buys now is scored at full price', () => {
    const before = saleStart - 72 * 3600;
    const snapshot = snapshotWith(995);
    const item = rankAt(before, 995, false).find(c => c.research.id === 'wormhole_dampening')!;
    const full = getDiscountedVirtuePrice(getResearchById('wormhole_dampening')!, 18, mods, false);
    const fromZero = getTimeToSave(full, { ...snapshot, bankValue: 0 }, boostTransitionsFrom(snapshot, before));

    expect(item.price).toBe(full);
    expect(item.hpp).toBeCloseTo(fromZero / 3600 / (item.impact! * 100), 6);
  });
});

describe('findBestDeliveryLevels', () => {
  const unitMods: ResearchCostModifiers = { labUpgradeLevel: 0, researchCostMultiplier: 1, puzzleCubeMultiplier: 1 };
  const start = { ...researchLevels, neural_net_refine: 25, relativity_optimization: 10 };
  const price = (id: string, level: number) => getDiscountedVirtuePrice(getResearchById(id)!, level, unitMods, true);
  const wd = price('wormhole_dampening', 18);
  const hp = price('hyper_portalling', 3);

  test('finds levels that only help together, which no single purchase would show', () => {
    const rate = (l: Record<string, number>) => (l.wormhole_dampening > 18 && l.hyper_portalling > 3 ? 2 : 1);
    const [best] = findBestDeliveryLevels(start, wd + hp, unitMods, true, rate)!;
    expect(best.levels.wormhole_dampening).toBe(19);
    expect(best.levels.hyper_portalling).toBe(4);
    expect(best.rate).toBe(2);
  });

  test('never spends more than the budget', () => {
    const rate = (l: Record<string, number>) => l.wormhole_dampening + l.hyper_portalling;
    const [best] = findBestDeliveryLevels(start, wd - 1, unitMods, true, rate)!;
    expect(best.gems).toBeLessThanOrEqual(wd - 1);
    expect(best.levels.wormhole_dampening).toBe(18);
  });

  test('drops levels that add nothing, even when they cost no time', () => {
    const rate = (l: Record<string, number>) => Math.min(l.hyper_portalling, 5);
    const [top] = findBestDeliveryLevels(start, 1e60, unitMods, true, rate)!;
    const best = dropLevelsNotWorthTheirTime(top, start, unitMods, true, rate, () => 0);
    expect(best.levels.hyper_portalling).toBe(5);
    expect(best.levels.wormhole_dampening).toBe(18);
  });

  test('drops a level whose gain is too small for its wait, and keeps one worth it', () => {
    const levels = { ...start, hyper_portalling: 4 };
    const set = (rate: number) => ({ levels, rate, gems: hp });
    const secondsToAfford = (gems: number) => (gems > 0 ? 100 * 3600 : 0);
    const small = (l: Record<string, number>) => (l.hyper_portalling > 3 ? 1.001 : 1);
    const large = (l: Record<string, number>) => (l.hyper_portalling > 3 ? 1.2 : 1);

    const dropped = dropLevelsNotWorthTheirTime(set(1.001), start, unitMods, true, small, secondsToAfford);
    const kept = dropLevelsNotWorthTheirTime(set(1.2), start, unitMods, true, large, secondsToAfford);
    expect(dropped.levels.hyper_portalling).toBe(3);
    expect(kept.levels.hyper_portalling).toBe(4);
  });

  test('gives up rather than running unbounded when a huge search has tiers to unlock', () => {
    const levels = Object.fromEntries(
      getCommonResearches().map(r => [r.id, DELIVERY_IMPACT_CATEGORIES.has(r.categories) ? 0 : r.levels])
    );
    expect(findBestDeliveryLevels(levels, 1e60, unitMods, true, () => 1)).toBeNull();
  });

  test('handles every tier open with many delivery levels still to buy', () => {
    const levels = Object.fromEntries(
      getCommonResearches().map(r => [
        r.id,
        r.categories.split(',').some(c => DELIVERY_IMPACT_CATEGORIES.has(c)) ? Math.ceil(r.levels * 0.8) : r.levels,
      ])
    );
    expect(isTierUnlocked(levels, 13)).toBe(true);
    const rateOf = deliveryRateScorer(source, levels, true, context);
    expect(findBestDeliveryLevels(levels, 1e70, unitMods, true, rateOf, 2)!.length).toBeGreaterThan(0);
  });

  test('a tied set comes back at its cheapest', () => {
    // Shipping alone sets this rate, so no laying is needed however much the budget allows.
    const rate = (l: Record<string, number>) => l.hyper_portalling;
    const [best] = findBestDeliveryLevels(start, wd + hp, unitMods, true, rate)!;
    expect(best.levels.hyper_portalling).toBe(4);
    expect(best.levels.wormhole_dampening).toBe(18);
    expect(best.gems).toBe(hp);
  });
});

describe('sorting delivery research', () => {
  const deliveryResearch = getCommonResearches().filter(r =>
    r.categories.split(',').some(category => DELIVERY_IMPACT_CATEGORIES.has(category))
  );
  const artifactMods = calculateArtifactModifiers([{ artifactId: null, stones: [] }]);
  const rates = (levels: Record<string, number>) =>
    computeRealisticELR(levels, artifactMods, context.epicResearchLevels, context.colleggtibleModifiers);

  test('each group changes its own side by exactly what it claims, from any starting levels', () => {
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let round = 0; round < 200; round++) {
      const from = Object.fromEntries(getCommonResearches().map(r => [r.id, Math.floor(random() * r.levels)]));
      const groups = deliveryResearchGroups(deliveryResearch, from);
      expect(groups.flatMap(g => g.members).length).toBe(deliveryResearch.length);
      for (const group of groups) {
        for (const r of group.members) {
          const before = rates(from);
          const after = rates({ ...from, [r.id]: from[r.id] + 1 });
          const [changed, unchanged] = group.side === 'laying' ? ['layRate', 'shippingRate'] as const : ['shippingRate', 'layRate'] as const;
          expect(after[changed] / before[changed]).toBeCloseTo(group.multiplierAfter(1), 7);
          expect(after[unchanged]).toBe(before[unchanged]);
        }
      }
    }
  });

  // Real prices and a real delivery rate, at account stages from late game back to mid game.
  test.each<[string, Record<string, number>]>([
    ['late', { wormhole_dampening: 12, hyper_portalling: 0, relativity_optimization: 0, neural_net_refine: 12 }],
    ['mid', { wormhole_dampening: 0, hyper_portalling: 0, relativity_optimization: 0, neural_net_refine: 4, dark_containment: 18, timeline_diversion: 40, micro_coupling: 1 }],
  ])('finds as high a rate as trying every combination: %s', (_stage, overrides) => {
    const unit: ResearchCostModifiers = { labUpgradeLevel: 0, researchCostMultiplier: 0.2, puzzleCubeMultiplier: 1 };
    const levels: Record<string, number> = { ...researchLevels, ...overrides };
    const rateOf = deliveryRateScorer(source, levels, true, context);
    const firstPrices = deliveryResearch
      .filter(r => levels[r.id] < r.levels)
      .map(r => getDiscountedVirtuePrice(r, levels[r.id], unit, true));
    const lowest = Math.min(...firstPrices);

    let compared = 0;
    for (const times of [1, 3, 10, 30, 100, 300, 1000, 3000]) {
      const budget = lowest * times;
      const full = searchEveryDeliveryCombination(levels, budget, unit, true, rateOf);
      if (!full) continue;
      const fast = findBestDeliveryLevels(levels, budget, unit, true, rateOf)!;
      expect(fast[0].rate / full[0].rate).toBeCloseTo(1, 8);
      expect(fast[0].gems).toBeLessThanOrEqual(full[0].gems * (1 + 1e-9));
      compared++;
    }
    expect(compared).toBeGreaterThan(3);
  });
});

describe('Buy Until Sale Ends', () => {
  const plan = (bankQd: number) => {
    const snapshot = snapshotWith(bankQd);
    return {
      snapshot,
      result: simulateSaleEndsBuy(
        researchLevels,
        snapshot,
        context,
        mods,
        midSale,
        saleEnd,
        'realistic',
        'efficiency',
        source
      ),
    };
  };

  test.each([200, 400, 995])('with a %iqd bank, costs no more time than greedy and finishes in the sale', bankQd => {
    const { snapshot, result } = plan(bankQd);
    const rateOf = deliveryRateScorer(source, researchLevels, snapshot.proPermit, context);
    const greedy = runDeliveryBuyLoop(
      researchLevels,
      snapshot,
      context,
      mods,
      midSale,
      saleEnd,
      'realistic',
      'efficiency',
      source
    );
    const greedyFinish = greedy.purchases.at(-1)?.purchaseTimestamp ?? midSale;
    const reference = rateOf(researchLevels);

    expect(result.lastPurchaseTimestamp).toBeLessThanOrEqual(saleEnd);
    expect(result.endDeliveryRate).toBe(rateOf(result.endLevels));
    expect(deliveryPlanCost(result.lastPurchaseTimestamp, result.endDeliveryRate!, reference)).toBeLessThanOrEqual(
      deliveryPlanCost(greedyFinish, rateOf(greedy.endLevels), reference)
    );
  });

  test('the plan charges sale prices, the same ones the ranking shows', () => {
    const { result } = plan(995);
    const levels: Record<string, number> = { ...researchLevels };
    let expected = 0;
    for (const id of result.researchIds) {
      expected += getDiscountedVirtuePrice(getResearchById(id)!, levels[id] || 0, mods, true);
      levels[id] = (levels[id] || 0) + 1;
    }
    expect(result.totalGemsSpent! / expected).toBeCloseTo(1, 9);
    expect(levels).toEqual(result.endLevels);
  });
});
