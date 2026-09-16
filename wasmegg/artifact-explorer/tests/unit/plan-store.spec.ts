import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fuelTankSizes } from 'lib';
import { parsePlanSave, sliceHumilityVisits } from '@/lib/plan/read';
import { normalizeBudgetInput, parseBudgetInput } from '@/store/budget-input';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
let store: typeof import('@/store');
let plan: typeof import('@/store/plan');
beforeEach(async () => {
  vi.stubGlobal('window', { location: { pathname: '/artifact-explorer/' } });
  vi.stubGlobal('localStorage', {});
  store = await import('@/store');
  plan = await import('@/store/plan');
  store.clearPlayerData();
  store.setOverrideTankLevel(false);
  plan.setLoadedPlan('fixture', sliceHumilityVisits(parsePlanSave(fixture('ascension-plan.json'))));
  store.setGemCostMode('unlimited');
  store.setMaxGoldenEggCostEnabled(false);
});
function recordAll() {
  const solved = fixture('humility-plan.json').visits[0];
  for (const visit of plan.loadedPlan.value!.visits) plan.recordSolvedVisit({ ...solved, visitId: visit.visitId });
}

describe('optimizer budget and scope regressions', () => {
  it('uses the manual tank level without a save, and respects save/plan overrides', () => {
    for (const level of [0, 2, 7]) {
      store.setTankLevel(level);
      expect(store.effectiveFuelTankCapacity.value).toBe(fuelTankSizes[level]);
    }
    store.playerTankLevel.value = 3;
    expect(store.effectiveTankLevel.value).toBe(3);
    store.setOverrideTankLevel(true);
    store.setTankLevel(1);
    expect(store.effectiveTankLevel.value).toBe(1);
    store.setOverrideTankLevel(false);
    plan.setCurrentVisit(plan.loadedPlan.value!.visits[0].visitId);
    expect(store.effectiveTankLevel.value).toBe(6);
  });

  it('keeps per-ship price modes and drafts independent for each visit and standalone', () => {
    store.setGemCostMode('custom');
    store.setGemCostInput('10S');
    const [a, b] = plan.loadedPlan.value!.visits;
    plan.setCurrentVisit(a.visitId);
    expect(store.gemCostMode.value).toBe('plan');
    store.setGemCostMode('custom');
    store.setGemCostInput('25M');
    plan.setCurrentVisit(b.visitId);
    expect(store.gemCostMode.value).toBe('plan');
    store.setGemCostMode('unlimited');
    expect(store.effectiveMaxGemCost.value).toBeUndefined();
    plan.setCurrentVisit(a.visitId);
    expect(store.effectiveMaxGemCost.value).toBe(25e6);
    plan.setCurrentVisit(null);
    expect(store.effectiveMaxGemCost.value).toBe(parseBudgetInput('10S'));
  });

  it('invalid drafts block active budgets and never reuse their previous numeric values', () => {
    store.setGemCostMode('custom');
    store.setGemCostInput('10M');
    store.setMaxGoldenEggCostEnabled(true);
    store.setCraftingCostInput('2M');
    for (const raw of ['', 'oops', '-1', 'Infinity', '1e999']) {
      store.setGemCostInput(raw);
      store.setCraftingCostInput(raw);
      expect(store.effectiveMaxGemCost.value).toBeNaN();
      expect(store.effectiveCraftingBudget.value).toBeNaN();
      expect(store.costBudgetsValid.value).toBe(false);
      expect(store.gemCostInput.value).toBe(raw);
    }
    store.setGemCostMode('unlimited');
    store.setMaxGoldenEggCostEnabled(false);
    expect(store.costBudgetsValid.value).toBe(true);
    store.setGemCostMode('custom');
    store.setGemCostInput('0');
    expect(store.effectiveMaxGemCost.value).toBe(0);
  });

  it('shows a stored cap in OoM units while still enforcing it to the digit', () => {
    store.setMaxGoldenEggCostEnabled(true);
    store.setMaxGoldenEggCost(1234567);
    expect(store.craftingCostInput.value).toBe('1.235M');
    expect(store.effectiveCraftingBudget.value).toBe(1234567);
    store.setCraftingCostInput('1.235M');
    expect(store.effectiveCraftingBudget.value).toBe(1235000);
  });

  it('invalidates only the visit whose gem cap was edited, and not on a re-spelling', () => {
    const [a, b] = plan.loadedPlan.value!.visits;
    plan.setCurrentVisit(a.visitId);
    store.setGemCostMode('custom');
    store.setGemCostInput('10M');
    recordAll();
    store.setGemCostInput('10000000');
    expect(plan.solvedVisitCount.value).toBe(2);
    store.setGemCostInput('bad');
    expect(Object.keys(plan.loadedPlan.value!.solved)).toEqual([b.visitId]);
  });

  it('preserves deliberately empty visit targets when navigating back', () => {
    const [a, b] = plan.loadedPlan.value!.visits;
    plan.setCurrentVisit(a.visitId, ['ornate-gusset-4']);
    plan.setVisitTargets(a.visitId, []);
    plan.setCurrentVisit(b.visitId, ['lunar-totem-4']);
    plan.setCurrentVisit(a.visitId, ['lunar-totem-4']);
    expect(plan.activeVisitSettings.value!.targetIds).toEqual([]);
  });

  it('keeps recorded answers when targets and fuel mode are written back unchanged', () => {
    const a = plan.loadedPlan.value!.visits[0];
    plan.setCurrentVisit(a.visitId, ['ornate-gusset-4']);
    recordAll();
    plan.setVisitTargets(a.visitId, ['ornate-gusset-4']);
    plan.setVisitFuelBudget(a.visitId, 'banked');
    expect(plan.solvedVisitCount.value).toBe(2);
  });

  it('resets time to the plan and preserves solved visits for equivalent time spellings', () => {
    const a = plan.loadedPlan.value!.visits[0];
    plan.setCurrentVisit(a.visitId);
    recordAll();
    plan.setVisitWaitTime(a.visitId, '24h');
    expect(plan.solvedVisitCount.value).toBe(2);
    plan.setVisitWaitTime(a.visitId, null);
    expect(plan.activeVisitSettings.value!.waitTimeOverride).toBeNull();
    expect(plan.solvedVisitCount.value).toBe(2);
    plan.setVisitWaitTime(a.visitId, '2d');
    expect(plan.solvedVisitCount.value).toBe(1);
  });
});

describe('cost input normalization', () => {
  it('normalizes only valid values without rounding their numeric meaning', () => {
    for (const raw of ['1000000', ' 2M ', '0', '123456789.12345', '10S']) {
      expect(parseBudgetInput(normalizeBudgetInput(raw))).toBe(parseBudgetInput(raw));
    }
    expect(normalizeBudgetInput('1000000')).toBe('1M');
    expect(normalizeBudgetInput('invalid')).toBe('invalid');
  });
});
