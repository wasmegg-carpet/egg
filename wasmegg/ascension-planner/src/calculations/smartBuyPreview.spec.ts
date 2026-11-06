import { afterEach, describe, expect, test, vi } from 'vitest';
import { getCommonResearches, getDiscountedVirtuePrice, getResearchById } from './commonResearch';
import type { ResearchCostModifiers } from './commonResearch';
import { deliveryRateScorer } from './deliveryLevelSearch';
import { rankResearchByELRImpact } from './researchRanking';
import { runDeliveryBuyLoop } from './smartBuyPreview';
import { computeSnapshot } from '@/engine/compute';
import { boostTransitionsFrom, getTimeToSave } from '@/engine/apply';
import { contextDeliverySource } from '@/auto/loadout/resolve';
import { maxedBaseState, maxedContext } from '@/buildTable/maxedAccount';
import { getNextSaleEnd, getNextSaleStart } from 'lib/planners/events';

// Lets one test script the ranking; every other test runs the real one.
const ranking = vi.hoisted(() => ({ override: null as null | (() => unknown[]) }));
vi.mock('./researchRanking', async importOriginal => {
  const actual = await importOriginal<typeof import('./researchRanking')>();
  return {
    ...actual,
    rankResearchByELRImpact: (...args: Parameters<typeof actual.rankResearchByELRImpact>) =>
      ranking.override ? ranking.override() : actual.rankResearchByELRImpact(...args),
  };
});

const context = maxedContext();
const deliverySource = contextDeliverySource(context);
const saleEnd = getNextSaleEnd(getNextSaleStart(1_790_000_000));

const maxedLevels = () => Object.fromEntries(getCommonResearches().map(r => [r.id, r.levels]));

function snapshotFor(researchLevels: Record<string, number>) {
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
  // A full farm, so the earn rate holds steady and these tests' time budgets stay easy to reason about.
  return computeSnapshot({ ...state, population: uncapped.habCapacity }, context, { skipEpochConversion: true });
}

// Everything maxed except `comfy_nests`, with `leafsprings` low enough that one laying research
// level changes nothing on its own but two free up a stone: a real "needs 2 levels" state, the same
// shape as the Neural Net Refinement plan this regression came from.
function multiLevelScenario() {
  const researchId = 'comfy_nests';
  const researchLevels = { ...maxedLevels(), [researchId]: 40, leafsprings: 20 };
  const snapshot = snapshotFor(researchLevels);
  const research = getResearchById(researchId)!;
  const level = researchLevels[researchId];

  // Scales prices so the first level takes an hour to save for, instead of a tiny fraction of a
  // second against a maxed account's earnings.
  const unitMods: ResearchCostModifiers = { labUpgradeLevel: 0, researchCostMultiplier: 1, puzzleCubeMultiplier: 1 };
  const unitSeconds = getTimeToSave(getDiscountedVirtuePrice(research, level, unitMods, true), snapshot, []);
  const mods = { ...unitMods, researchCostMultiplier: 3600 / unitSeconds };

  const levelSeconds = (n: number) => getTimeToSave(getDiscountedVirtuePrice(research, level + n, mods, true), snapshot, []);
  return { researchId, researchLevels, snapshot, level, mods, levelSeconds };
}

function buyUntilDeadline(scenario: ReturnType<typeof multiLevelScenario>, budgetSeconds: number) {
  return runDeliveryBuyLoop(
    scenario.researchLevels,
    scenario.snapshot,
    context,
    scenario.mods,
    saleEnd - budgetSeconds,
    saleEnd,
    'realistic',
    'efficiency',
    deliverySource
  );
}

describe('delivery research that needs several levels to help', () => {
  afterEach(() => {
    ranking.override = null;
  });

  test('the scenario really is a multi-level candidate', () => {
    const { researchId, researchLevels, snapshot, mods } = multiLevelScenario();
    const ranked = rankResearchByELRImpact(
      researchLevels,
      deliverySource,
      snapshot,
      context,
      mods,
      true,
      saleEnd - 86400,
      saleEnd,
      'realistic',
      'efficiency'
    );
    const item = ranked.find(r => r.research.id === researchId)!;
    expect(item.impact).toBeLessThanOrEqual(0);
    expect(item.lookahead?.levels).toBeGreaterThanOrEqual(2);
  });

  test('ranks on the hr/% of the levels it needs, not as a last resort', () => {
    const { researchId, researchLevels, snapshot, mods } = multiLevelScenario();
    const rank = (sortMode: 'efficiency' | 'impact') =>
      rankResearchByELRImpact(
        researchLevels,
        deliverySource,
        snapshot,
        context,
        mods,
        true,
        saleEnd - 86400,
        saleEnd,
        'realistic',
        sortMode
      );

    const byEfficiency = rank('efficiency');
    const hpp = byEfficiency.map(r => r.lookahead?.hpp ?? r.hpp!);
    expect(byEfficiency.length).toBeGreaterThan(1);
    expect(hpp).toEqual([...hpp].sort((a, b) => a - b));
    expect(byEfficiency[0].research.id).toBe(researchId);

    const impacts = rank('impact').map(r => r.lookahead?.impact ?? r.impact!);
    expect(impacts).toEqual([...impacts].sort((a, b) => b - a));
  });

  test('does not buy the first level when the levels that help cannot finish before the sale ends', () => {
    const scenario = multiLevelScenario();
    const { purchases, endLevels } = buyUntilDeadline(scenario, scenario.levelSeconds(0) * 1.1);
    expect(purchases.filter(p => p.researchId === scenario.researchId)).toEqual([]);
    expect(endLevels[scenario.researchId]).toBe(scenario.level);
  });

  test('flags the candidate with a deadline warning when only its first level would fit', () => {
    const scenario = multiLevelScenario();
    const now = saleEnd - scenario.levelSeconds(0) * 1.1;
    const ranked = rankResearchByELRImpact(
      scenario.researchLevels,
      deliverySource,
      scenario.snapshot,
      context,
      scenario.mods,
      true,
      now,
      saleEnd,
      'realistic',
      'efficiency'
    );
    expect(ranked.find(r => r.research.id === scenario.researchId)?.showDeadlineWarning).toBe(true);
  });

  test('buys every level it needs, back to back, when they all fit', () => {
    const scenario = multiLevelScenario();
    const ranked = rankResearchByELRImpact(
      scenario.researchLevels,
      deliverySource,
      scenario.snapshot,
      context,
      scenario.mods,
      true,
      saleEnd - 86400,
      saleEnd,
      'realistic',
      'efficiency'
    );
    const minLevels = ranked.find(r => r.research.id === scenario.researchId)!.lookahead!.levels;
    let budget = 0;
    for (let n = 0; n < minLevels; n++) budget += scenario.levelSeconds(n);

    const { purchases, endSnapshot, endLevels } = buyUntilDeadline(scenario, budget * 1.01);
    const ids = purchases.map(p => p.researchId);
    const first = ids.indexOf(scenario.researchId);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(ids.slice(first, first + minLevels)).toEqual(Array(minLevels).fill(scenario.researchId));
    expect(endLevels[scenario.researchId]).toBeGreaterThanOrEqual(scenario.level + minLevels);
    expect(endSnapshot.researchLevels[scenario.researchId]).toBe(endLevels[scenario.researchId]);
  });

  test('a better candidate appearing partway through does not interrupt the levels it needs', () => {
    const scenario = multiLevelScenario();
    const item = (researchId: string, minLevels?: number) => ({
      research: getResearchById(researchId)!,
      canBuy: true,
      showDeadlineWarning: false,
      lookahead: minLevels ? { levels: minLevels } : undefined,
    });
    let calls = 0;
    ranking.override = () =>
      calls++ === 0 ? [item(scenario.researchId, 2)] : calls === 2 ? [item('leafsprings')] : [];

    const { purchases } = buyUntilDeadline(scenario, 86400);
    expect(purchases.map(p => p.researchId)).toEqual([scenario.researchId, scenario.researchId, 'leafsprings']);
  });

  test('stays committed to the partner when the first level does nothing alone', () => {
    const scenario = multiLevelScenario();
    let calls = 0;
    ranking.override = () =>
      calls++ === 0
        ? [
            {
              research: getResearchById(scenario.researchId)!,
              impact: 0,
              canBuy: true,
              showDeadlineWarning: false,
              lookahead: { levels: 2, partner: { id: 'leafsprings', name: '', level: 21 } },
            },
          ]
        : [];

    const { purchases } = buyUntilDeadline(scenario, 86400);
    expect(purchases.map(p => p.researchId)).toEqual([scenario.researchId, 'leafsprings']);
  });

  test('re-ranks after each level when the first level helps alone', () => {
    const scenario = multiLevelScenario();
    const item = (researchId: string, lookahead?: { levels: number }) => ({
      research: getResearchById(researchId)!,
      impact: 0.01,
      canBuy: true,
      showDeadlineWarning: false,
      lookahead,
    });
    let calls = 0;
    ranking.override = () => (calls++ === 0 ? [item(scenario.researchId, { levels: 2 })] : calls === 2 ? [item('leafsprings')] : []);

    const { purchases } = buyUntilDeadline(scenario, 86400);
    expect(purchases.map(p => p.researchId)).toEqual([scenario.researchId, 'leafsprings']);
  });
});

describe('delivery research that helps a little alone and far more with another level', () => {
  // One Hyper Portalling level only just moves a stone; a second gets the full benefit. Priced so
  // the first level takes 14 hours to save for, like the report this came from.
  function smallThenLargeScenario() {
    const researchLevels: Record<string, number> = {
      ...maxedLevels(),
      hyper_portalling: 3,
      wormhole_dampening: 17,
      micro_coupling: 3,
      relativity_optimization: 4,
      neural_net_refine: 17,
    };
    const snapshot = snapshotFor(researchLevels);
    const research = getResearchById('hyper_portalling')!;
    const unitMods: ResearchCostModifiers = { labUpgradeLevel: 0, researchCostMultiplier: 1, puzzleCubeMultiplier: 1 };
    const unitSeconds = getTimeToSave(getDiscountedVirtuePrice(research, 3, unitMods, true), snapshot, []);
    const mods = { ...unitMods, researchCostMultiplier: (14 * 3600) / unitSeconds };
    return { researchLevels, snapshot, mods };
  }
  const rank = (now: number, deadline = saleEnd) => {
    const { researchLevels, snapshot, mods } = smallThenLargeScenario();
    return rankResearchByELRImpact(
      researchLevels,
      deliverySource,
      snapshot,
      context,
      mods,
      true,
      now,
      deadline,
      'realistic',
      'efficiency'
    );
  };

  test('ranks on the combo, ahead of research that looked better one level at a time', () => {
    const ranked = rank(saleEnd - 3 * 86400);
    const item = ranked.find(r => r.research.id === 'hyper_portalling')!;
    expect(item.impact).toBeGreaterThan(0);
    expect(item.lookahead?.levels).toBe(2);
    expect(item.lookahead!.hpp).toBeLessThan(item.hpp!);
    expect(ranked.indexOf(item)).toBeLessThan(ranked.findIndex(r => r.research.id === 'relativity_optimization'));
  });

  test('names a cheaper level of another research instead of its own next level', () => {
    const item = rank(saleEnd - 3 * 86400).find(r => r.research.id === 'hyper_portalling')!;
    expect(item.lookahead?.partner).toMatchObject({ id: 'neural_net_refine', level: 18 });
  });

  test('both halves of a pair score the same, with the one that helps alone first', () => {
    const ranked = rank(saleEnd - 3 * 86400);
    expect(ranked[0].lookahead?.partner?.id).toBe(ranked[1].research.id);
    expect(ranked[1].lookahead?.partner?.id).toBe(ranked[0].research.id);
    expect(ranked[0].lookahead!.hpp).toBe(ranked[1].lookahead!.hpp);
    expect(ranked[0].impact).toBeGreaterThan(ranked[1].impact!);
  });

  test('falls back to one level when the second cannot finish before the sale ends', () => {
    const item = rank(saleEnd - 20 * 3600).find(r => r.research.id === 'hyper_portalling')!;
    expect(item.lookahead).toBeUndefined();
    expect(item.showDeadlineWarning).toBe(false);
  });

  test('stopping the search early never misses the best level count', () => {
    const { researchLevels, snapshot, mods } = smallThenLargeScenario();
    const now = saleEnd - 3 * 86400;
    const rateOf = deliveryRateScorer(deliverySource!, researchLevels, snapshot.proPermit, context);
    const baseRate = rateOf(researchLevels);
    const noBank = { ...snapshot, bankValue: 0 };
    const transitions = boostTransitionsFrom(snapshot, now);

    // A deadline nothing misses, so every level count is in play.
    for (const item of rank(now, now + 1e9)) {
      const r = item.research;
      const level = researchLevels[r.id];
      const hoursFor = (gems: number) => getTimeToSave(gems, noBank, transitions) / 3600;
      const hppFor = (gems: number, impact: number) => (impact > 0 ? hoursFor(gems) / (impact * 100) : Infinity);
      const priceOf = (id: string, at: number) => getDiscountedVirtuePrice(getResearchById(id)!, at, mods, true);
      let gems = 0;
      let best = Infinity;
      for (let n = 1; level + n <= r.levels; n++) {
        gems += priceOf(r.id, level + n - 1);
        best = Math.min(best, hppFor(gems, rateOf({ ...researchLevels, [r.id]: level + n }) / baseRate - 1));
      }
      for (const other of getCommonResearches()) {
        if (other.id === r.id || researchLevels[other.id] >= other.levels) continue;
        const otherLevel = researchLevels[other.id];
        const levels = { ...researchLevels, [r.id]: level + 1, [other.id]: otherLevel + 1 };
        const pair = hppFor(priceOf(r.id, level) + priceOf(other.id, otherLevel), rateOf(levels) / baseRate - 1);
        const alone = hppFor(priceOf(other.id, otherLevel), rateOf({ ...researchLevels, [other.id]: otherLevel + 1 }) / baseRate - 1);
        if (pair < alone) best = Math.min(best, pair);
      }
      expect(item.lookahead?.hpp ?? item.hpp!).toBeCloseTo(best, 6);
    }
  });
});
