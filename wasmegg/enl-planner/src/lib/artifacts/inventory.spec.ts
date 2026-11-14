import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { allPossibleTiers } from 'lib/artifacts/data';
import type { ei } from 'lib';
import { createBaseEngineState, getSimulationContext } from 'lib/planners/engine/adapter';
import type { EngineState } from '@/engine/types';
import { useInitialStateStore } from '@/stores/initialState';
import { inventoryFromBackup, inventoryOverages, type PlayerInventory } from './inventory';
import { optimizeIHR, optimizeOfflineEarnings } from './optimizeArtifacts';
import { defaultResearchCube, ownedPuzzleCubes, researchCubeMultiplier } from './researchCube';
import type { EquippedArtifact } from './types';

function spec(family: string, tier: number, rarity = 0): ei.IArtifactSpec {
  const t = allPossibleTiers.find(x => x.family.id === family && x.tier_number === tier)!;
  return { name: t.afx_id, level: t.afx_level, rarity };
}

function countStones(loadout: EquippedArtifact[]) {
  const counts: Record<string, number> = {};
  for (const slot of loadout) for (const id of slot.stones) if (id) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

function expectWithin(loadout: EquippedArtifact[], inventory: PlayerInventory) {
  for (const slot of loadout) if (slot.artifactId) expect(inventory.artifacts[slot.artifactId]).toBeGreaterThan(0);
  for (const [id, used] of Object.entries(countStones(loadout))) {
    expect(used).toBeLessThanOrEqual(inventory.stones[id] ?? 0);
  }
}

describe('reading the inventory from a backup', () => {
  test('counts loose and socketed stones, and each artifact version separately', () => {
    const backup: ei.IBackup = {
      artifactsDb: {
        inventoryItems: [
          { itemId: 1, quantity: 5, artifact: { spec: spec('clarity-stone', 4) } },
          { itemId: 2, quantity: 1, artifact: { spec: spec('shell-stone', 3) } },
          {
            itemId: 3,
            quantity: 1,
            artifact: {
              spec: spec('puzzle-cube', 4, 3),
              stones: [spec('clarity-stone', 4), spec('clarity-stone', 3)],
            },
          },
          { itemId: 4, quantity: 2, artifact: { spec: spec('puzzle-cube', 4, 0) } },
        ],
      },
    };
    expect(inventoryFromBackup(backup)).toEqual({
      artifacts: { 'puzzle-cube-4-3': 1, 'puzzle-cube-4-0': 2 },
      stones: { 'clarity-stone-4': 6, 'clarity-stone-3': 1, 'shell-stone-3': 1 },
    });
  });

  test('is unknown when the backup has no artifact data', () => {
    expect(inventoryFromBackup({})).toBeNull();
  });
});

describe('inventory overages', () => {
  const loadout: EquippedArtifact[] = [
    { artifactId: 'lunar-totem-4-3', stones: ['clarity-stone-4', 'clarity-stone-4', null] },
    { artifactId: null, stones: ['clarity-stone-4'] },
  ];

  test('reports only stones past what is owned, ignoring empty artifact slots', () => {
    const artifacts = { 'lunar-totem-4-3': 1 };
    const inventory = { artifacts, stones: { 'clarity-stone-4': 1 } };
    expect(inventoryOverages(loadout, inventory)).toEqual([
      { id: 'clarity-stone-4', label: expect.stringContaining('Clarity'), used: 2, owned: 1 },
    ]);
    expect(inventoryOverages(loadout, { artifacts, stones: { 'clarity-stone-4': 2 } })).toEqual([]);
    expect(inventoryOverages(loadout, null)).toEqual([]);
  });

  test('reports an artifact the player does not have', () => {
    expect(inventoryOverages(loadout, { artifacts: {}, stones: { 'clarity-stone-4': 2 } })).toEqual([
      { id: 'lunar-totem-4-3', label: expect.stringMatching(/lunar totem/i), used: 1, owned: 0 },
    ]);
  });
});

describe('optimizing with an inventory', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    setActivePinia(createPinia());
    useInitialStateStore().setSoulEggs(1e21);
  });

  function farm(over: Partial<EngineState> = {}): EngineState {
    return {
      ...createBaseEngineState(null),
      habIds: [18, 18, 18, 18],
      vehicles: Array.from({ length: 10 }, () => ({ vehicleId: 9, trainLength: 1 })),
      population: 1e7,
      ...over,
    };
  }

  test('uses only owned artifacts and never more of a stone than owned', () => {
    const inventory: PlayerInventory = {
      artifacts: { 'lunar-totem-4-3': 1, 'demeters-necklace-4-3': 1, 'tungsten-ankh-3-1': 1, 'beak-of-midas-1-0': 3 },
      stones: { 'clarity-stone-4': 1, 'clarity-stone-3': 1, 'clarity-stone-2': 1, 'shell-stone-3': 2, 'lunar-stone-2': 1 },
    };
    const result = optimizeOfflineEarnings(farm(), getSimulationContext(), { inventory });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectWithin(result.loadout, inventory);
    expect(countStones(result.loadout)['clarity-stone-4']).toBe(1);
    // Every artifact in the set has clarity, or it would do nothing.
    const clarityIds = ['clarity-stone-4', 'clarity-stone-3', 'clarity-stone-2'];
    for (const slot of result.loadout) {
      if (slot.artifactId) expect(slot.stones.some(s => s && clarityIds.includes(s))).toBe(true);
    }
  });

  test('leaves sockets empty when stones run out', () => {
    const inventory: PlayerInventory = {
      artifacts: { 'lunar-totem-4-3': 1 },
      stones: { 'clarity-stone-4': 1 },
    };
    const result = optimizeOfflineEarnings(farm(), getSimulationContext(), { inventory });
    expect(result.ok && result.loadout[0]).toEqual({
      artifactId: 'lunar-totem-4-3',
      stones: ['clarity-stone-4', null, null],
    });
  });

  test('skips artifacts that would have no clarity, except Light of Eggendil', () => {
    const inventory: PlayerInventory = {
      artifacts: { 'lunar-totem-4-3': 1, 'light-of-eggendil-4-3': 1 },
      stones: { 'shell-stone-4': 1 },
    };
    const result = optimizeOfflineEarnings(farm(), getSimulationContext(), { inventory });
    expect(result.ok && result.loadout.filter(s => s.artifactId).map(s => s.artifactId)).toEqual([
      'light-of-eggendil-4-3',
    ]);
  });

  test('fails rather than invent a gusset the player does not have', () => {
    const state = farm({ population: 1e30 });
    const inventory: PlayerInventory = { artifacts: {}, stones: {} };
    expect(optimizeOfflineEarnings(state, getSimulationContext(), { inventory }).ok).toBe(false);
  });

  test('stays quick with a large mixed inventory', () => {
    const artifacts: Record<string, number> = {};
    for (const family of ['lunar-totem', 'demeters-necklace', 'tungsten-ankh', 'light-of-eggendil', 'the-chalice', 'quantum-metronome', 'interstellar-compass', 'beak-of-midas']) {
      for (const version of ['4-3', '4-2', '3-3', '3-2']) artifacts[`${family}-${version}`] = 1;
    }
    const stones: Record<string, number> = {};
    for (const family of ['clarity-stone', 'shell-stone', 'lunar-stone', 'tachyon-stone', 'quantum-stone', 'prophecy-stone', 'soul-stone', 'life-stone']) {
      stones[`${family}-4`] = 2;
      stones[`${family}-3`] = 3;
      stones[`${family}-2`] = 5;
    }
    const inventory = { artifacts, stones };
    const t0 = performance.now();
    const result = optimizeIHR(farm(), getSimulationContext(), { inventory });
    const elapsed = performance.now() - t0;
    expect(result.ok).toBe(true);
    if (result.ok) expectWithin(result.loadout, inventory);
    expect(elapsed).toBeLessThan(6000);
  }, 20000);
});

describe('default research cube with an inventory', () => {
  test('uses the owned cube and fills it with the best clarity stones owned', () => {
    const inventory: PlayerInventory = {
      artifacts: { 'puzzle-cube-3-1': 1 },
      stones: { 'clarity-stone-4': 1, 'clarity-stone-2': 4 },
    };
    const setting = defaultResearchCube(inventory);
    expect(setting.artifactId).toBe('puzzle-cube-3-1');
    expect(ownedPuzzleCubes(inventory).map(c => c.id)).toEqual(['puzzle-cube-3-1']);
    expect(setting.stones[0]).toBe('clarity-stone-4');
    expect(setting.stones.filter(s => s === 'clarity-stone-4')).toHaveLength(1);
  });

  test('picks the cube that gives the lowest price with the stones available', () => {
    const inventory: PlayerInventory = {
      artifacts: { 'puzzle-cube-4-3': 1, 'puzzle-cube-4-0': 1 },
      stones: { 'clarity-stone-4': 3 },
    };
    const setting = defaultResearchCube(inventory);
    expect(setting.artifactId).toBe('puzzle-cube-4-3');
    expect(researchCubeMultiplier(setting)).toBeCloseTo(0.4 / 3, 10);
  });

  test('no cube owned means no cube', () => {
    expect(defaultResearchCube({ artifacts: {}, stones: { 'clarity-stone-4': 3 } }).artifactId).toBeNull();
  });
});
