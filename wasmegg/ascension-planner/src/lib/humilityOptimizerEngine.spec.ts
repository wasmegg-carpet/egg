// The inline optimizer's request: sleep and the 2x capacity event reach the solve the way the explorer sends
// them, and the panel's settings keep them across a reload.

// The store reads localStorage as it is constructed, keyed under the page's path, and the test environment is
// node: a plain object stands in for both, as `lib/utils.ts` indexes storage rather than calling its methods.
const storage: Record<string, string> = {};
const STORED = '/_humility_optimizer';
Object.assign(globalThis, { window: { location: { pathname: '/' } }, localStorage: storage });

import { readFileSync } from 'node:fs';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { beforeEach, describe, expect, it } from 'vitest';

import { Inventory, newShipsConfig } from 'lib';
import { MAX_DOUBLE_CAPACITY_SECONDS } from 'lib/mission-optimizer/capacity';
import type { PlayerData } from 'lib/mission-optimizer/player-data';
import { sliceHumilityVisits } from 'lib/mission-optimizer/plan/read';
import type { PlanSave } from 'lib/mission-optimizer/plan/schema';

import { newVisitSettings, type OptimizerVisitSettings } from './humilityOptimizer';
import { buildRequest } from './humilityOptimizerEngine';
import { useHumilityOptimizerStore } from '@/stores/humilityOptimizer';

const FIXTURES = new URL('../../../artifact-explorer/tests/fixtures/', import.meta.url).pathname;
const [visit] = sliceHumilityVisits(JSON.parse(readFileSync(FIXTURES + 'ascension-plan.json', 'utf8')) as PlanSave);

const player: PlayerData = {
  shipsConfig: newShipsConfig(),
  inventory: new Inventory({ inventoryItems: [] }),
  totalCraftingXp: 0,
  tankLevel: null,
  tankFuels: null,
  goldenEggs: 0,
};

const asked = (patch: Partial<OptimizerVisitSettings>): OptimizerVisitSettings => ({
  ...newVisitSettings(),
  targetIds: ['puzzle-cube-4'],
  duration: '3d',
  ...patch,
});

describe('the request the panel sends', () => {
  it('asks neither window by default, so the request is the one it always was', () => {
    const { input } = buildRequest(visit, asked({}), player)!;
    expect('sleepSeconds' in input).toBe(false);
    expect('eventWindowSeconds' in input).toBe(false);
  });

  it('passes sleep and the event window through, the event capped as the explorer caps it', () => {
    const { input } = buildRequest(
      visit,
      asked({ sleepHours: 8, doubleCapacityEnabled: true, doubleCapacityRemaining: '3d' }),
      player
    )!;
    expect(input.sleepSeconds).toBe(8 * 3600);
    expect(input.eventWindowSeconds).toBe(MAX_DOUBLE_CAPACITY_SECONDS);
  });

  it('poses no question while the event is on with no time left typed', () => {
    expect(buildRequest(visit, asked({ doubleCapacityEnabled: true, doubleCapacityRemaining: 'soon' }), player)).toBe(
      null
    );
  });
});

describe("the panel's stored settings", () => {
  beforeEach(() => {
    for (const key of Object.keys(storage)) delete storage[key];
    setActivePinia(createPinia());
  });

  it('loads a visit saved before the schedule settings existed with them off', () => {
    const { sleepHours: _s, doubleCapacityEnabled: _e, doubleCapacityRemaining: _r, ...older } = asked({});
    storage[STORED] = JSON.stringify({ version: 1, template: older, visits: { [visit.visitId]: older } });
    const settings = useHumilityOptimizerStore().settingsFor(visit);
    expect(settings).toMatchObject({ sleepHours: 0, doubleCapacityEnabled: false, doubleCapacityRemaining: '48h' });
    expect(settings.targetIds).toEqual(['puzzle-cube-4']);
  });

  it('keeps what was set for a visit, carries it to the next one, and clamps it on reload', async () => {
    const store = useHumilityOptimizerStore();
    store.update(visit, { sleepHours: 30, doubleCapacityEnabled: true, doubleCapacityRemaining: '5h' });
    expect(store.settingsFor({ ...visit, visitId: 'another' })).toMatchObject({
      doubleCapacityEnabled: true,
      doubleCapacityRemaining: '5h',
    });
    // A reload reads it back through the same normalization.
    await nextTick();
    setActivePinia(createPinia());
    expect(useHumilityOptimizerStore().settingsFor(visit)).toMatchObject({
      sleepHours: 16,
      doubleCapacityEnabled: true,
    });
  });
});
