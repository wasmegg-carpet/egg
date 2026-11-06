/**
 * The ascension in progress comes from the backup as it is, whatever the stores were changed to after
 * loading: pending TE rolled into claimed (`rollUpPendingTE`), the farm caught up to the plan start
 * (`catchUpFarmState`).
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ei } from 'lib';
import { useInitialStateStore } from '@/stores/initialState';
import { TE_BREAKPOINTS } from '@/lib/truthEggs';
import { readCurrentAscension } from './currentAscension';
import { epicResearchDefs } from 'lib/planners/epicResearch';

const BACKUP_TIME = 1_792_470_300; // Mon 19 Oct 2026, 11:25 PM Central
const FARM_STEP = BACKUP_TIME - 36 * 3600; // the farm's own last step, older than the backup

/** A virtue save on integrity: per egg [curiosity, integrity, humility, resilience, kindness]. */
function backup(): ei.IBackup {
  // 201 claimed; integrity's eggs are 6 thresholds past what it claimed.
  const claimed = [45, 38, 40, 40, 38];
  const delivered = claimed.map((n, i) => TE_BREAKPOINTS[n - 1 + (i === 1 ? 6 : 0)] * 1.0001);
  return {
    approxTime: BACKUP_TIME,
    game: { soulEggsD: 1e30, epicResearch: [] },
    virtue: { eovEarned: claimed, eggsDelivered: delivered, shiftCount: 40 },
    farms: [
      {
        eggType: 51,
        habs: [18, 18, 18, 18],
        habPopulation: [2.5e9, 2.5e9, 2.5e9, 2.5e9],
        vehicles: Array(17).fill(11),
        trainLength: Array(17).fill(10),
        silosOwned: 10,
        commonResearch: [
          { id: 'comfy_nests', level: 50 },
          { id: 'hen_house_ac', level: 50 },
          { id: 'improved_genetics', level: 30 },
        ],
        lastStepTime: FARM_STEP,
      },
    ],
  } as unknown as ei.IBackup;
}

// The stores read and write localStorage, which Node lacks (newer Node declares it, unset without
// --localstorage-file).
if (!(globalThis as { localStorage?: unknown }).localStorage) {
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, String(v)),
      removeItem: (k: string) => void items.delete(k),
      clear: () => items.clear(),
    },
  });
}

describe('readCurrentAscension', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('reads claimed and pending TE and the sync time from the backup, not the stores', () => {
    const b = backup();
    const store = useInitialStateStore();
    store.loadFromBackup('EI1234567890123456', b);
    // What the page does to the stores after loading: pending rolled into claimed, farm caught up.
    store.initialTeEarned = { ...store.initialTeEarned, integrity: store.initialTeEarned.integrity + 6 };
    store.initialTePending = { ...store.initialTePending, integrity: 0 };
    store.currentFarmState!.lastStepTime = FARM_STEP - 86400;

    const now = BACKUP_TIME + 3600;
    const c = readCurrentAscension(b, now)!;
    expect(c.claimedTE).toBe(201);
    expect(c.pendingAtBackup).toBe(6);
    expect(c.pendingTE).toBeGreaterThanOrEqual(6);
    expect(c.egg).toBe('integrity');
    expect(c.lastSync).toBe(BACKUP_TIME);
    expect(c.elr).toBeGreaterThan(0);
    // One hour of laying since the backup, on integrity.
    expect(c.catchUpEggs).toBeCloseTo(c.elr * 3600, 0);
    expect(c.delivered[2]).toBeCloseTo((b.virtue!.eggsDelivered![1] as number) + c.catchUpEggs, 0);
  });

  it("takes epic research from the backup, not the stores (Chain Finder's own fetch may be all that's loaded)", () => {
    // No save loaded into the stores: their epic research is all zero.
    const now = BACKUP_TIME + 3600;
    const without = readCurrentAscension(backup(), now)!.elr;
    const b = backup();
    b.game!.epicResearch = epicResearchDefs.map(r => ({ id: r.id, level: r.maxLevel }));
    const withEpic = readCurrentAscension(b, now)!.elr;
    expect(withEpic).toBeGreaterThan(without * 1.5);
  });

  it('is null without a virtue farm', () => {
    const b = { ...backup(), farms: [] } as ei.IBackup;
    expect(readCurrentAscension(b, BACKUP_TIME)).toBeNull();
  });
});
