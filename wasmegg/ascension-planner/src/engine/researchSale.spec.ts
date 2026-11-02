import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { getNextSaleEnd, getNextSaleStart, isResearchSaleActive, BOUNDARY_EPSILON_SECONDS } from '@/lib/events';
import { hasStaleResearchSaleFlags, isResearchSaleAtSimTime } from './researchSale';
import { useActionsStore } from '@/stores/actions';
import { useVirtueStore } from '@/stores/virtue';
import { computeSnapshot } from './compute';
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
