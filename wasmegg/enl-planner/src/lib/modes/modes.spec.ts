import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ei } from 'lib';
import { allPossibleTiers } from 'lib/artifacts/data';
import { useActionsStore } from '@/stores/actions';
import { useFuelTankStore } from '@/stores/fuelTank';
import { useInitialStateStore } from '@/stores/initialState';
import { FUEL_EGGS } from '@/types';
import { initContinueCurrent } from './continueCurrent';
import { initPlanFuture } from './planFuture';

const backupRef = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('./fetchBackup', () => ({
  fetchPlayerBackup: async () => ({ backup: backupRef.current, pHash: 'hash' }),
}));

const necklace = allPossibleTiers.find(t => t.family.id === 'demeters-necklace' && t.tier_number === 4)!;
const clarity = allPossibleTiers.find(t => t.family.id === 'clarity-stone' && t.tier_number === 4)!;

function syntheticBackup(eggType: number) {
  const now = Date.now() / 1000;
  return {
    userName: 'test',
    approxTime: now,
    game: {
      soulEggsD: 1e21,
      eggsOfProphecy: 150,
      permitLevel: 1,
      epicResearch: [
        { id: 'soul_eggs', level: 140 },
        { id: 'prophecy_bonus', level: 5 },
      ],
    },
    virtue: { eovEarned: [40, 30, 20, 10, 5], shiftCount: 12, afx: { tankFuels: Array(25).fill(9e12) } },
    artifacts: { tankLevel: 3, tankFuels: FUEL_EGGS.map((_, i) => (i === 3 ? 5e9 : i === 18 ? 7e9 : 0)) },
    artifactsDb: {
      inventoryItems: [
        {
          itemId: 7,
          artifact: {
            spec: { name: necklace.afx_id, level: necklace.afx_level, rarity: 3 },
            stones: [{ name: clarity.afx_id, level: clarity.afx_level, rarity: 0 }],
          },
        },
      ],
      activeArtifactSets: [{ slots: [{ occupied: true, itemId: 7 }] }],
      virtueAfxDb: { inventoryItems: [], activeArtifacts: { slots: [] } },
      missionInfos: [],
    },
    farms: [
      {
        eggType,
        numChickens: 5e6,
        cashEarned: 1e30,
        cashSpent: 4e29,
        silosOwned: 3,
        habs: [18, 18, 17, 19],
        vehicles: [11, 10],
        trainLength: [5, 1],
        commonResearch: [{ id: 'comfy_nests', level: 50 }],
        lastStepTime: now,
      },
    ],
    contracts: { archive: [], contracts: [] },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  setActivePinia(createPinia());
});

describe('planning a new farm from a backup', () => {
  test('brings the account along and starts the farm from nothing', async () => {
    backupRef.current = syntheticBackup(ei.Egg.EDIBLE);
    await initPlanFuture('EI0000000000000000');
    const store = useInitialStateStore();
    expect(store.soulEggs).toBe(1e21);
    expect(store.prophecyEggs).toBe(150);
    expect(store.truthEggs).toBe(105);
    expect(store.initialTankLevel).toBe(3);
    // Starts with the max offline earnings set, not what the backup has equipped
    const ids = store.artifactLoadout.map(s => s.artifactId);
    expect(ids).toContain('lunar-totem-4-3');
    expect(ids).toContain('light-of-eggendil-4-3');
    expect(store.activeArtifactSet).toBe('earnings');
    expect(store.currentFarmState).toBeNull();

    const first = useActionsStore().currentSnapshot;
    expect(first.soulEggs).toBe(1e21);
    expect(first.prophecyEggs).toBe(150);
    expect(first.te).toBe(105);
    expect(first.researchLevels).toEqual({});
    expect(first.offlineEarnings).toBeGreaterThan(0);
  });

  test('reads the regular fuel tank, ignoring virtue fuel', async () => {
    backupRef.current = syntheticBackup(ei.Egg.EDIBLE);
    await initPlanFuture('EI0000000000000000');
    const tank = useFuelTankStore();
    expect(tank.tankLevel).toBe(3);
    expect(tank.fuelAmounts.rocket_fuel).toBe(5e9);
    expect(tank.fuelAmounts.enlightenment).toBe(7e9);
    expect(tank.totalFuel).toBe(12e9);
  });
});

describe('continuing an enlightenment farm', () => {
  test('picks up the farm as it is in the backup', async () => {
    backupRef.current = syntheticBackup(ei.Egg.ENLIGHTENMENT);
    await initContinueCurrent('EI0000000000000000');
    const snapshot = useActionsStore().currentSnapshot;
    expect(snapshot.habIds).toEqual([18, 18, 17, null]);
    expect(snapshot.vehicles[0]).toEqual({ vehicleId: 11, trainLength: 5 });
    expect(snapshot.siloCount).toBe(3);
    expect(snapshot.researchLevels.comfy_nests).toBe(50);
    expect(snapshot.population).toBeGreaterThanOrEqual(5e6);
    expect(snapshot.bankValue).toBeGreaterThan(0);
  });

  test('explains itself when the save is on another egg', async () => {
    backupRef.current = syntheticBackup(ei.Egg.CURIOSITY);
    await expect(initContinueCurrent('EI0000000000000000')).rejects.toThrow(/not on the Enlightenment egg/);
  });
});
