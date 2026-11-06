import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  getNextEarningsBoostStart,
  getNextSaleEnd,
  getNextSaleStart,
  isEarningsBoostActive,
  isResearchSaleActive,
  BOUNDARY_EPSILON_SECONDS,
} from 'lib/planners/events';
import {
  hasStaleResearchPurchasePrices,
  hasStaleResearchSaleFlags,
  isResearchSaleAtSimTime,
  researchCostModifiersAt,
  researchPurchaseAt,
  eventCrossingsForPurchase,
} from './researchSale';
import { useActionsStore } from '@/stores/actions';
import { useVirtueStore } from '@/stores/virtue';
import { computeSnapshot } from './compute';
import { boostTransitionsFrom, getTimeToSave } from './apply';
import {
  getCommonResearches,
  getDiscountedVirtuePrice,
  type CommonResearch,
} from '@/calculations/commonResearch';
import { useResearchViews } from '@/composables/useResearchViews';
import { useEventCrossingWaits } from '@/composables/useEventCrossingWaits';
import { getExecutor } from '@/lib/actions/executor';
import { createBaseEngineState, getSimulationContext } from './adapter';
import { useResearchSaleWaits } from '@/composables/useResearchSaleWaits';
import { generateActionId } from '@/types';
import type { Action } from '@/types';

const friday = getNextSaleStart(Date.UTC(2026, 9, 26) / 1000);

describe('isResearchSaleAtSimTime', () => {
  test('follows the Friday to Saturday window', () => {
    expect(isResearchSaleAtSimTime(0, friday - 3600, 0)).toBe(false);
    expect(isResearchSaleAtSimTime(0, friday + 3600, 0)).toBe(true);
    expect(isResearchSaleAtSimTime(0, getNextSaleEnd(friday) + 3600, 0)).toBe(false);
  });

  test('a wait landing a fraction of a second short of a boundary counts as reaching it', () => {
    expect(isResearchSaleAtSimTime(0, friday - 0.01, 0)).toBe(true);
    expect(isResearchSaleAtSimTime(0, getNextSaleEnd(friday) - 0.01, 0)).toBe(false);
    expect(isResearchSaleAtSimTime(0, friday - BOUNDARY_EPSILON_SECONDS - 1, 0)).toBe(false);
  });

  test('measures sim time from the plan start offset', () => {
    expect(isResearchSaleAtSimTime(5000 + 3600, friday, 5000)).toBe(true);
    expect(isResearchSaleAtSimTime(5000 - 3600, friday, 5000)).toBe(false);
  });
});

describe('the planner timeline', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    setActivePinia(createPinia());
  });

  // A fresh plan with no wait for habs, starting at the given Pacific wall-clock time.
  async function startPlan(date: string, time: string) {
    const virtueStore = useVirtueStore();
    virtueStore.setAscensionTimezone('America/Los_Angeles');
    virtueStore.setAscensionDate(date);
    virtueStore.setAscensionTime(time);
    const actionsStore = useActionsStore();
    const snapshot = computeSnapshot(createBaseEngineState(null), getSimulationContext());
    await actionsStore.setInitialSnapshot(snapshot);
    return actionsStore;
  }

  function wait(type: 'wait_for_time' | 'wait_for_research_sale', totalTimeSeconds: number) {
    return {
      id: generateActionId(),
      timestamp: Date.now(),
      type,
      payload: { totalTimeSeconds },
      cost: 0,
      dependsOn: [],
    } as unknown as Parameters<ReturnType<typeof useActionsStore>['pushAction']>[0];
  }

  function absoluteNow(store: ReturnType<typeof useActionsStore>) {
    return store.ascensionStartTime + (store.currentSnapshot.lastStepTime - store.planStartOffset);
  }

  test('sale state matches the clock at every step, with no toggle actions', async () => {
    const store = await startPlan('2026-10-30', '12:00'); // Friday, mid-sale
    expect(store.actions.every(a => a.type !== 'toggle_sale')).toBe(true);
    expect(store.currentSnapshot.activeSales.research).toBe(isResearchSaleActive(absoluteNow(store)));

    const toEnd = getNextSaleEnd(absoluteNow(store)) - absoluteNow(store);
    store.pushAction(wait('wait_for_time', toEnd));
    expect(absoluteNow(store)).toBeCloseTo(getNextSaleEnd(friday), 3);
    expect(store.currentSnapshot.activeSales.research).toBe(false);

    const toStart = getNextSaleStart(absoluteNow(store)) - absoluteNow(store);
    store.pushAction(wait('wait_for_research_sale', toStart));
    expect(store.currentSnapshot.activeSales.research).toBe(true);
    expect(store.actions.every(a => a.type !== 'toggle_sale')).toBe(true);
  });

  test('turning the toggle on advances to the sale start, and off to the sale end', async () => {
    const store = await startPlan('2026-11-01', '12:00'); // Sunday, so 2x Earnings falls in between
    const { waitForNextSale, waitForSaleEnd } = useResearchSaleWaits();
    const expectedStart = getNextSaleStart(absoluteNow(store));

    await waitForNextSale();
    expect(absoluteNow(store)).toBeCloseTo(expectedStart, 3);
    expect(store.currentSnapshot.activeSales.research).toBe(true);
    expect(store.actions.map(a => a.type)).toEqual(
      expect.arrayContaining(['wait_for_earnings_boost', 'toggle_earnings_boost', 'wait_for_research_sale'])
    );
    expect(store.currentSnapshot.earningsBoost.active).toBe(false);

    await waitForSaleEnd();
    expect(absoluteNow(store)).toBeCloseTo(getNextSaleEnd(expectedStart), 3);
    expect(store.currentSnapshot.activeSales.research).toBe(false);
    expect(store.actions.every(a => a.type !== 'toggle_sale')).toBe(true);
  });

  test('a stored toggle cannot override the calendar', async () => {
    const store = await startPlan('2026-11-01', '12:00'); // Sunday, no sale
    const before = store.currentSnapshot.activeSales.research;
    expect(before).toBe(isResearchSaleActive(absoluteNow(store)));
    store.pushAction({
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'toggle_sale',
      payload: { saleType: 'research', active: !before, multiplier: 0.3 },
      cost: 0,
      dependsOn: [],
    } as never);
    expect(store.currentSnapshot.activeSales.research).toBe(before);
  });

  test('recalculating leaves a clean plan with nothing stale, and flags a tampered one', async () => {
    const store = await startPlan('2026-10-30', '12:00');
    store.pushAction(wait('wait_for_time', 3 * 86400));
    await store.recalculateFrom(0);
    expect(hasStaleResearchSaleFlags(store.actions, store.ascensionStartTime)).toBe(false);

    const tampered: Action[] = store.actions.map(a => ({
      ...a,
      endState: { ...a.endState, activeSales: { ...a.endState.activeSales, research: !a.endState.activeSales.research } },
    }));
    expect(hasStaleResearchSaleFlags(tampered, store.ascensionStartTime)).toBe(true);
  });
});

describe('a research purchase crossing a sale boundary', () => {
  const saturday = getNextSaleEnd(friday);
  const nextFriday = getNextSaleStart(saturday);

  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal(
      'Worker',
      class {
        postMessage() {}
        terminate() {}
        addEventListener() {}
      }
    );
    setActivePinia(createPinia());
  });

  // A plan earning from its first second, starting at `absoluteStart`.
  async function startEarningPlan(absoluteStart: number, population = 100, researchLevels: Record<string, number> = {}) {
    const virtueStore = useVirtueStore();
    virtueStore.setAscensionTimezone('UTC');
    const iso = new Date(absoluteStart * 1000).toISOString();
    virtueStore.setAscensionDate(iso.slice(0, 10));
    virtueStore.setAscensionTime(iso.slice(11, 19));
    const store = useActionsStore();
    const base = {
      ...createBaseEngineState(null),
      currentEgg: 'curiosity' as const,
      habIds: [0, null, null, null],
      vehicles: [{ vehicleId: 0, trainLength: 1 }],
      population,
      researchLevels,
    };
    await store.setInitialSnapshot(computeSnapshot(base as never, getSimulationContext(), { skipEpochConversion: true }));
    return store;
  }

  // The first research level costing between `minSeconds` and `maxSeconds` of saving at full price.
  function findPurchase(store: ReturnType<typeof useActionsStore>, minSeconds: number, maxSeconds: number) {
    const snapshot = store.currentSnapshot;
    const context = getSimulationContext();
    const mods = researchCostModifiersAt(snapshot, context);
    const start = context.ascensionStartTime + (snapshot.lastStepTime - context.planStartOffset);
    const transitions = boostTransitionsFrom(snapshot, start);
    for (const research of getCommonResearches()) {
      for (let level = 0; level < research.levels; level++) {
        const fullPrice = getDiscountedVirtuePrice(research, level, mods, false);
        const fullWait = getTimeToSave(fullPrice, snapshot, transitions);
        if (fullWait < minSeconds || fullWait > maxSeconds) continue;
        const salePrice = getDiscountedVirtuePrice(research, level, mods, true);
        return { research, level, fullPrice, salePrice, fullWait, saleWait: getTimeToSave(salePrice, snapshot, transitions) };
      }
    }
    throw new Error(`no research level costs ${minSeconds}-${maxSeconds}s to save for`);
  }

  // Pushes the purchase at a deliberately wrong stored cost: the engine has to price it, not the caller.
  function buy(store: ReturnType<typeof useActionsStore>, research: CommonResearch, level: number, staleCost: number) {
    store.pushAction({
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'buy_research',
      payload: { researchId: research.id, fromLevel: level, toLevel: level + 1 },
      cost: staleCost,
      dependsOn: [],
    } as never);
    return store.actions[store.actions.length - 1];
  }

  async function replayed(store: ReturnType<typeof useActionsStore>) {
    await store.recalculateFrom(0);
    return store.actions[store.actions.length - 1];
  }

  function absoluteEnd(store: ReturnType<typeof useActionsStore>, action: Action) {
    return store.ascensionStartTime + (action.endState.lastStepTime - store.planStartOffset);
  }

  test('saving across Friday 9 AM pays the sale price, as soon as the sale starts', async () => {
    const probe = await startEarningPlan(friday - 2 * 86400);
    const { research, level, fullPrice, salePrice, fullWait, saleWait } = findPurchase(probe, 3600, 86400);
    expect(saleWait).toBeLessThan(fullWait / 2 + 1);

    setActivePinia(createPinia());
    const store = await startEarningPlan(friday - fullWait / 2);
    const action = await replayed((buy(store, research, level, fullPrice), store));

    expect(action.cost).toBeCloseTo(salePrice, 6);
    expect(action.totalTimeSeconds).toBeLessThan(fullWait);
    expect(absoluteEnd(store, action)).toBeCloseTo(friday, 1);
    expect(action.endState.activeSales.research).toBe(true);
    expect(action.endState.bankValue).toBeGreaterThanOrEqual(-1e-6);
  });

  test('saving past Saturday 9 AM pays full price, charged when the full price is ready', async () => {
    const probe = await startEarningPlan(friday + 3600);
    const { research, level, fullPrice, salePrice, fullWait, saleWait } = findPurchase(probe, 3 * 86400, 5 * 86400);
    expect(saleWait / 2).toBeLessThan(saturday - friday);

    setActivePinia(createPinia());
    const store = await startEarningPlan(saturday - saleWait / 2);
    const action = await replayed((buy(store, research, level, salePrice), store));

    expect(action.cost).toBeCloseTo(fullPrice, 6);
    expect(absoluteEnd(store, action)).toBeGreaterThan(saturday);
    expect(absoluteEnd(store, action)).toBeLessThan(nextFriday);
    expect(action.endState.activeSales.research).toBe(false);
    expect(action.endState.bankValue).toBeGreaterThanOrEqual(-1e-6);
  });

  test('a push and a replay charge the same price and take the same time', async () => {
    const probe = await startEarningPlan(friday - 2 * 86400);
    const { research, level, fullPrice, fullWait } = findPurchase(probe, 3600, 86400);

    setActivePinia(createPinia());
    const store = await startEarningPlan(friday - fullWait / 2);
    const expected = researchPurchaseAt(research, level, store.currentSnapshot, getSimulationContext());
    const pushed = buy(store, research, level, expected.price);
    const pushedResult = { cost: pushed.cost, seconds: pushed.totalTimeSeconds, bank: pushed.endState.bankValue };
    expect(pushedResult.seconds).toBeCloseTo(expected.waitSeconds, 3);
    expect(fullPrice).toBeGreaterThan(expected.price);

    const again = await replayed(store);
    expect(again.cost).toBeCloseTo(pushedResult.cost, 6);
    expect(again.totalTimeSeconds).toBeCloseTo(pushedResult.seconds, 3);
    expect(again.endState.bankValue).toBeCloseTo(pushedResult.bank, 3);
  });

  test('a purchase ready before either boundary keeps the price it started with', async () => {
    const probe = await startEarningPlan(friday - 2 * 86400);
    const { research, level, fullPrice, salePrice, saleWait, fullWait } = findPurchase(probe, 600, 3600);

    setActivePinia(createPinia());
    const before = await startEarningPlan(friday - fullWait - 3600);
    const paidFull = await replayed((buy(before, research, level, salePrice), before));
    expect(paidFull.cost).toBeCloseTo(fullPrice, 6);
    expect(paidFull.totalTimeSeconds).toBeCloseTo(fullWait, 3);

    setActivePinia(createPinia());
    const during = await startEarningPlan(saturday - saleWait - 3600);
    const paidSale = await replayed((buy(during, research, level, fullPrice), during));
    expect(paidSale.cost).toBeCloseTo(salePrice, 6);
    expect(paidSale.totalTimeSeconds).toBeCloseTo(saleWait, 3);
  });

  test('a clock landing just short of Saturday 9 AM no longer gets the sale price', async () => {
    const probe = await startEarningPlan(friday - 2 * 86400);
    const { research, level, fullPrice, salePrice } = findPurchase(probe, 600, 3600);

    setActivePinia(createPinia());
    const store = await startEarningPlan(saturday - 3600);
    const push = (type: string, payload: object) =>
      store.pushAction({
        id: generateActionId(),
        timestamp: Date.now(),
        type,
        payload,
        cost: 0,
        dependsOn: [],
      } as never);
    const now = store.ascensionStartTime + (store.currentSnapshot.lastStepTime - store.planStartOffset);
    push('wait_for_time', { totalTimeSeconds: saturday - now - 0.01 });
    push('modify_bank', { mode: 'set', amount: salePrice * 1.5, previousValue: 0, delta: 0 });
    const action = await replayed((buy(store, research, level, salePrice), store));
    expect(action.cost).toBeCloseTo(fullPrice, 6);
  });

  test('flags a stored purchase priced at its start, and recalculating clears it', async () => {
    const probe = await startEarningPlan(friday - 2 * 86400);
    const { research, level, fullPrice, fullWait } = findPurchase(probe, 3600, 86400);

    setActivePinia(createPinia());
    const store = await startEarningPlan(friday - fullWait / 2);
    buy(store, research, level, fullPrice);
    await store.recalculateFrom(0);
    const context = getSimulationContext();
    expect(hasStaleResearchPurchasePrices(store.actions, context)).toBe(false);

    const paidFullDuringSale = store.actions.map(a => (a.type === 'buy_research' ? { ...a, cost: fullPrice } : a));
    expect(hasStaleResearchPurchasePrices(paidFullDuringSale, context)).toBe(true);
    const otherModifiers = store.actions.map(a => (a.type === 'buy_research' ? { ...a, cost: fullPrice * 0.77 } : a));
    expect(hasStaleResearchPurchasePrices(otherModifiers, context)).toBe(false);
  });

  // A purchase and its waits measured from a plan already at that level, as the buttons always are.
  async function purchaseAtItsLevel(probeAt: number, minSeconds: number, maxSeconds: number) {
    const probe = await startEarningPlan(probeAt);
    const { research, level } = findPurchase(probe, minSeconds, maxSeconds);
    const levels = { [research.id]: level };
    setActivePinia(createPinia());
    const measured = await startEarningPlan(probeAt, 100, levels);
    const context = getSimulationContext();
    const snapshot = measured.currentSnapshot;
    const mods = researchCostModifiersAt(snapshot, context);
    const transitions = boostTransitionsFrom(snapshot, probeAt);
    const fullPrice = getDiscountedVirtuePrice(research, level, mods, false);
    const salePrice = getDiscountedVirtuePrice(research, level, mods, true);
    setActivePinia(createPinia());
    return {
      research,
      level,
      levels,
      fullPrice,
      salePrice,
      fullWait: getTimeToSave(fullPrice, snapshot, transitions),
      saleWait: getTimeToSave(salePrice, snapshot, transitions),
    };
  }

  // Adds a purchase the way `buyOneLevel` does: the crossing waits first, then the buy at its own price.
  function buyWithWaits(store: ReturnType<typeof useActionsStore>, research: CommonResearch, level: number) {
    const { prepareExecution, completeExecution, insertCrossingWaits, settled } = useEventCrossingWaits();
    insertCrossingWaits(research);
    const before = prepareExecution();
    completeExecution(
      {
        id: generateActionId(),
        timestamp: Date.now(),
        type: 'buy_research',
        payload: { researchId: research.id, fromLevel: level, toLevel: level + 1 },
        cost: researchPurchaseAt(research, level, before, getSimulationContext()).price,
        dependsOn: [],
      } as never,
      before
    );
    return settled();
  }

  const addedTypes = (store: ReturnType<typeof useActionsStore>) =>
    store.actions.filter(a => a.type !== 'start_ascension').map(a => a.type);

  test('a purchase crossing the sale start gets a wait for the sale, then pays the sale price', async () => {
    const { research, level, levels, salePrice, fullWait } = await purchaseAtItsLevel(friday - 2 * 86400, 3600, 86400);

    const store = await startEarningPlan(friday - fullWait / 2, 100, levels);
    await buyWithWaits(store, research, level);
    await store.recalculateFrom(0);

    expect(addedTypes(store)).toEqual(['wait_for_research_sale', 'buy_research']);
    const [wait, purchase] = store.actions.slice(-2);
    expect(absoluteEnd(store, wait)).toBeCloseTo(friday, 3);
    expect(wait.endState.activeSales.research).toBe(true);
    expect(purchase.cost).toBeCloseTo(salePrice, 6);
    expect(purchase.totalTimeSeconds).toBeLessThan(1);
  });

  test('a purchase crossing the sale end gets a wait for the end, then pays full price on time', async () => {
    const { research, level, levels, fullPrice, saleWait } = await purchaseAtItsLevel(friday + 3600, 3 * 86400, 5 * 86400);

    const store = await startEarningPlan(saturday - saleWait / 2, 100, levels);
    const unsplit = researchPurchaseAt(research, level, store.currentSnapshot, getSimulationContext());
    const startedAt = store.currentSnapshot.lastStepTime;
    await buyWithWaits(store, research, level);
    await store.recalculateFrom(0);

    const types = addedTypes(store);
    expect(types[0]).toBe('wait_for_research_sale_end');
    expect(types).not.toContain('wait_for_time');
    expect(types[types.length - 1]).toBe('buy_research');
    const firstWait = store.actions.find(a => a.type === 'wait_for_research_sale_end')!;
    expect(absoluteEnd(store, firstWait)).toBeCloseTo(saturday, 3);
    expect(firstWait.endState.activeSales.research).toBe(false);

    const purchase = store.actions[store.actions.length - 1];
    expect(purchase.cost).toBeCloseTo(fullPrice, 6);
    expect(purchase.endState.lastStepTime - startedAt).toBeCloseTo(unsplit.waitSeconds, 0);
  });

  test('a purchase saving past a whole sale gets a wait for each boundary, then pays the later sale price', async () => {
    const start = saturday + 3600;
    // Owning the level raises earnings, so a level that saves past the next sale is found by measuring.
    const findLongPurchase = async () => {
      for (const research of getCommonResearches()) {
        for (let level = 0; level < research.levels; level++) {
          setActivePinia(createPinia());
          const measured = await startEarningPlan(start, 100, { [research.id]: level });
          const snapshot = measured.currentSnapshot;
          const salePrice = getDiscountedVirtuePrice(
            research,
            level,
            researchCostModifiersAt(snapshot, getSimulationContext()),
            true
          );
          const saleWait = getTimeToSave(salePrice, snapshot, boostTransitionsFrom(snapshot, start));
          if (saleWait > 7 * 86400 && saleWait < 60 * 86400) return { research, level, salePrice };
        }
      }
      throw new Error('no research level saves past the next sale');
    };
    const { research, level, salePrice } = await findLongPurchase();
    const levels = { [research.id]: level };

    setActivePinia(createPinia());
    const store = await startEarningPlan(start, 100, levels);
    await buyWithWaits(store, research, level);
    await store.recalculateFrom(0);

    expect(store.actions.filter(a => a.type === 'wait_for_research_sale').length).toBeGreaterThanOrEqual(2);
    const saleEnd = store.actions.find(a => a.type === 'wait_for_research_sale_end' && absoluteEnd(store, a) > nextFriday)!;
    expect(absoluteEnd(store, saleEnd)).toBeCloseTo(getNextSaleEnd(nextFriday), 3);
    const purchase = store.actions[store.actions.length - 1];
    expect(purchase.type).toBe('buy_research');
    expect(purchase.cost).toBeCloseTo(salePrice, 6);
    expect(purchase.endState.activeSales.research).toBe(true);
    expect(purchase.totalTimeSeconds).toBeLessThan(1);
  });

  test('a purchase crossing no sale boundary adds no waits, and a second pass adds nothing', async () => {
    const { research, level, levels, fullWait } = await purchaseAtItsLevel(friday - 2 * 86400, 600, 3600);

    const before = await startEarningPlan(friday - fullWait - 3600, 100, levels);
    await buyWithWaits(before, research, level);
    expect(addedTypes(before)).toEqual(['buy_research']);

    setActivePinia(createPinia());
    const crossing = await startEarningPlan(friday - fullWait / 2, 100, levels);
    await buyWithWaits(crossing, research, level);
    const context = getSimulationContext();
    const next = crossing.actions.find(a => a.type === 'wait_for_research_sale')!;
    expect(eventCrossingsForPurchase(research, level, next.endState, context)).toBeNull();
  });

  test('money ready just before a boundary buys on its own side of it', async () => {
    const { research, level, levels, fullWait, saleWait } = await purchaseAtItsLevel(friday - 2 * 86400, 600, 3600);
    const probe = await startEarningPlan(friday - 2 * 86400, 100, levels);
    const context = getSimulationContext();
    const planTime = (absolute: number) => context.planStartOffset + absolute - context.ascensionStartTime;

    const justBeforeFriday = { ...probe.currentSnapshot, lastStepTime: planTime(friday - fullWait - 2) };
    expect(eventCrossingsForPurchase(research, level, justBeforeFriday, context)).toBeNull();
    const justBeforeSaturday = { ...probe.currentSnapshot, lastStepTime: planTime(saturday - saleWait - 2) };
    expect(eventCrossingsForPurchase(research, level, justBeforeSaturday, context)).toBeNull();
  });

  test('adding to a past group inserts the waits ahead of the purchase, in order', async () => {
    const { research, level, levels, salePrice, fullWait } = await purchaseAtItsLevel(friday - 2 * 86400, 3600, 86400);

    const store = await startEarningPlan(friday - fullWait / 2, 100, levels);
    store.pushAction(shiftAction());
    const groupId = store.actions[0].id;
    store.editingGroupId = groupId;
    store.startBatch();
    await buyWithWaits(store, research, level);
    await store.commitBatch();
    const types = store.actions.map(a => a.type);
    const waitAt = types.indexOf('wait_for_research_sale');
    expect(waitAt).toBeGreaterThan(0);
    expect(types[waitAt + 1]).toBe('buy_research');
    expect(types.filter(t => t === 'wait_for_research_sale')).toHaveLength(1);
    expect(store.actions[waitAt + 1].cost).toBeCloseTo(salePrice, 6);
  });

  function shiftAction() {
    return {
      id: generateActionId(),
      timestamp: Date.now(),
      type: 'notification',
      payload: { message: 'later action' },
      cost: 0,
      dependsOn: [],
    } as never;
  }

  test('waits for a saved span are named for the event, and a long save covers 2x earnings too', async () => {
    const start = saturday + 3600;
    const longSave = async () => {
      for (const research of getCommonResearches()) {
        for (let level = 0; level < research.levels; level++) {
          setActivePinia(createPinia());
          const measured = await startEarningPlan(start, 100, { [research.id]: level });
          const snapshot = measured.currentSnapshot;
          const price = getDiscountedVirtuePrice(research, level, researchCostModifiersAt(snapshot, getSimulationContext()), true);
          const wait = getTimeToSave(price, snapshot, boostTransitionsFrom(snapshot, start));
          if (wait > 7 * 86400 && wait < 60 * 86400) return { research, level };
        }
      }
      throw new Error('no research level saves past the next sale');
    };
    const { research, level } = await longSave();
    setActivePinia(createPinia());
    const store = await startEarningPlan(start, 100, { [research.id]: level });
    await buyWithWaits(store, research, level);
    await store.recalculateFrom(0);

    const types = addedTypes(store);
    expect(types).toContain('wait_for_earnings_boost');
    expect(types).toContain('wait_for_earnings_boost_end');
    expect(types).toContain('toggle_earnings_boost');
    expect(types).not.toContain('wait_for_time');
    for (const type of ['wait_for_research_sale_end', 'wait_for_earnings_boost_end'] as const) {
      const row = store.actions.find(a => a.type === type)!;
      expect(getExecutor(type).getDisplayName(row.payload as never)).toMatch(/Ends/);
    }

    // The toggles land on the calendar, and the plan ends up where the boost math said it would.
    for (const toggle of store.actions.filter(a => a.type === 'toggle_earnings_boost')) {
      expect(toggle.endState.earningsBoost.active).toBe(isEarningsBoostActive(absoluteEnd(store, toggle) + BOUNDARY_EPSILON_SECONDS));
    }
  });

  test('a purchase crossing only 2x earnings gets its waits, and its time to buy counts the boost', async () => {
    const monday = getNextEarningsBoostStart(friday);
    const flatProbe = await startEarningPlan(monday - 86400);
    const { research, level } = findPurchase(flatProbe, 2 * 3600, 6 * 3600);
    setActivePinia(createPinia());
    const measured = await startEarningPlan(monday - 86400, 100, { [research.id]: level });
    const measuredSnapshot = measured.currentSnapshot;
    const price = getDiscountedVirtuePrice(research, level, researchCostModifiersAt(measuredSnapshot, getSimulationContext()), false);
    const flatWait = getTimeToSave(price, measuredSnapshot);
    expect(flatWait).toBeGreaterThan(600);

    setActivePinia(createPinia());
    const start = monday - flatWait / 2;
    const store = await startEarningPlan(start, 100, { [research.id]: level });
    const shown = researchPurchaseAt(research, level, store.currentSnapshot, getSimulationContext());
    expect(shown.waitSeconds).toBeLessThan(flatWait * 0.9);
    const startedAt = store.currentSnapshot.lastStepTime;

    await buyWithWaits(store, research, level);
    await store.recalculateFrom(0);

    expect(addedTypes(store)).toEqual(['wait_for_earnings_boost', 'toggle_earnings_boost', 'buy_research']);
    const purchase = store.actions[store.actions.length - 1];
    expect(purchase.cost).toBeCloseTo(shown.price, 6);
    expect(purchase.endState.lastStepTime - startedAt).toBeCloseTo(shown.waitSeconds, 0);
    expect(purchase.endState.earningsBoost.active).toBe(true);
  });

  test('a sale end wait recalculates from the calendar, and shrinks to nothing outside the sale', async () => {
    const store = await startEarningPlan(friday + 3600);
    const add = (totalTimeSeconds: number) =>
      store.pushAction({
        id: generateActionId(),
        timestamp: Date.now(),
        type: 'wait_for_research_sale_end',
        payload: { totalTimeSeconds },
        cost: 0,
        dependsOn: [],
      } as never);
    add(1);
    await store.recalculateFrom(0);
    const wait = store.actions[store.actions.length - 1];
    expect(absoluteEnd(store, wait)).toBeCloseTo(saturday, 3);

    add(5000);
    await store.recalculateFrom(0);
    expect(store.actions[store.actions.length - 1].totalTimeSeconds).toBe(0);
  });

  // Pushes every remaining level the way the buttons do, returning the total time they take.
  function buyAllLevels(store: ReturnType<typeof useActionsStore>, research: CommonResearch) {
    let seconds = 0;
    for (let level = 0; level < research.levels; level++) {
      const { price } = researchPurchaseAt(research, level, store.currentSnapshot, getSimulationContext());
      seconds += buy(store, research, level, price).totalTimeSeconds;
    }
    return seconds;
  }

  test('game view max times match what buying every level takes across the boundary', async () => {
    const research = getCommonResearches().find(r => r.tier === 1 && r.levels > 1)!;
    await startEarningPlan(friday - 2 * 86400);
    const views = useResearchViews();
    views.currentView.value = 'game';
    const wholeRun = views.gameViewTimes.value.researchSeconds[research.id];
    expect(wholeRun).toBeGreaterThan(0);

    setActivePinia(createPinia());
    const store = await startEarningPlan(friday - wholeRun / 2);
    const crossing = useResearchViews();
    crossing.currentView.value = 'game';
    const shown = crossing.gameViewTimes.value.researchSeconds[research.id];

    expect(shown).toBeLessThan(wholeRun);
    expect(buyAllLevels(store, research)).toBeCloseTo(shown, 2);
  });

  test('the cheapest view shows the price and wait each purchase is charged, through the crossing', async () => {
    await startEarningPlan(friday - 2 * 86400);
    const probeViews = useResearchViews();
    probeViews.currentView.value = 'cheapest';
    const probeRows = probeViews.sortedResearches.value;
    // Long enough to straddle Friday despite the start time's whole-minute rounding.
    const crossingIndex = probeRows.findIndex(r => r.timeToBuySeconds! > 600);
    const probeRow = probeRows[crossingIndex];

    setActivePinia(createPinia());
    const store = await startEarningPlan(friday - probeRow.buyToHereSeconds! + probeRow.timeToBuySeconds! / 2);
    const views = useResearchViews();
    views.currentView.value = 'cheapest';
    const rows = views.sortedResearches.value.slice(0, crossingIndex + 1);

    expect(rows[crossingIndex].research.id).toBe(probeRow.research.id);
    expect(rows[crossingIndex].price).toBeLessThan(probeRow.price);
    expect(rows[crossingIndex].duringSale).toBe(true);

    for (const row of rows) {
      const action = buy(store, row.research, row.targetLevel! - 1, row.price);
      expect(action.cost).toBeCloseTo(row.price, 6);
      expect(action.totalTimeSeconds).toBeCloseTo(row.timeToBuySeconds!, 3);
    }
  });
});
