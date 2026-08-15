// Pins for the loot-data accessors. The real loot.json weighs ~80MB and is
// refreshed by update-loot-data.sh, so these specs swap in a hand-built
// three-mission dataset: assertions stay exact and don't churn when the live
// data is re-scraped. Mission and item ids are real ones so that
// getMissionTypeFromId / getArtifactTierPropsFromId resolve against lib.

import { describe, expect, it, vi } from 'vitest';
import { ei, getMissionTypeFromId, itemExpectedFullConsumption, targets, type ShipsConfig } from 'lib';

import type { lootjson, MissionLevelLootStore } from '@/lib/loot-json';
import lootFixture from '@/lib/loot-json';
import {
  getMaxLegendaryCount,
  getMissionLevelLootAverageConsumptionValue,
  getMissionLootData,
  getTierLootData,
  hasMissionLootData,
  legendaryDataIsSparse,
  MIN_LEGENDARY_OBSERVATIONS,
  missionDataNotEnough,
} from '@/lib/loot';

const Name = ei.ArtifactSpec.Name;
const Level = ei.ArtifactSpec.Level;
const Rarity = ei.ArtifactSpec.Rarity;
const Ship = ei.MissionInfo.Spaceship;
const Duration = ei.MissionInfo.DurationType;

// Mocking the actual loot data to ensure tests are minimally brittle against updated loot tables
vi.mock('@/lib/loot-json', async () => {
  const { ei } = await import('lib');
  const Name = ei.ArtifactSpec.Name;
  const Level = ei.ArtifactSpec.Level;
  const item = (
    itemId: string,
    afxId: ei.ArtifactSpec.Name,
    afxLevel: ei.ArtifactSpec.Level,
    counts: [number, number, number, number]
  ) => ({ itemId, afxId, afxLevel, counts });

  const data: lootjson = {
    missions: [
      {
        afxShip: ei.MissionInfo.Spaceship.CHICKEN_ONE,
        afxDurationType: ei.MissionInfo.DurationType.SHORT,
        missionId: 'chicken-one-short',
        levels: [
          {
            level: 0,
            targets: [
              {
                targetAfxId: Name.UNKNOWN,
                totalDrops: 100,
                items: [
                  item('lunar-totem-1', Name.LUNAR_TOTEM, Level.INFERIOR, [90, 8, 2, 0]),
                  item('puzzle-cube-1', Name.PUZZLE_CUBE, Level.INFERIOR, [50, 0, 0, 0]),
                ],
              },
            ],
          },
          {
            level: 1,
            targets: [
              {
                targetAfxId: Name.UNKNOWN,
                totalDrops: 200,
                items: [item('lunar-totem-1', Name.LUNAR_TOTEM, Level.INFERIOR, [180, 0, 0, 0])],
              },
            ],
          },
        ],
      },
      {
        afxShip: ei.MissionInfo.Spaceship.HENERPRISE,
        afxDurationType: ei.MissionInfo.DurationType.EPIC,
        missionId: 'henerprise-extended',
        levels: [
          {
            level: 0,
            targets: [
              {
                targetAfxId: Name.LUNAR_TOTEM,
                totalDrops: 1000,
                items: [
                  item('lunar-totem-3', Name.LUNAR_TOTEM, Level.NORMAL, [800, 150, 40, 10]),
                  item('lunar-totem-1', Name.LUNAR_TOTEM, Level.INFERIOR, [5, 0, 0, 0]),
                ],
              },
              {
                targetAfxId: Name.PUZZLE_CUBE,
                totalDrops: 500,
                items: [
                  item('lunar-totem-3', Name.LUNAR_TOTEM, Level.NORMAL, [10, 0, 0, 3]),
                  item('gold-meteorite-1', Name.GOLD_METEORITE, Level.INFERIOR, [0, 0, 0, 5]),
                ],
              },
            ],
          },
          {
            level: 1,
            targets: [
              {
                targetAfxId: Name.LUNAR_TOTEM,
                totalDrops: 2000,
                items: [
                  item('lunar-totem-3', Name.LUNAR_TOTEM, Level.NORMAL, [1600, 300, 80, 20]),
                  item('gold-meteorite-2', Name.GOLD_METEORITE, Level.LESSER, [0, 0, 0, 4]),
                ],
              },
            ],
          },
        ],
      },
      {
        afxShip: ei.MissionInfo.Spaceship.ATREGGIES,
        afxDurationType: ei.MissionInfo.DurationType.EPIC,
        missionId: 'atreggies-extended',
        levels: [
          {
            level: 0,
            targets: [
              {
                targetAfxId: Name.UNKNOWN,
                totalDrops: 50,
                items: [item('lunar-totem-3', Name.LUNAR_TOTEM, Level.NORMAL, [40, 0, 0, 0])],
              },
            ],
          },
        ],
      },
    ],
  };
  return { default: data };
});

function enabledTargets(...enabled: ei.ArtifactSpec.Name[]): ShipsConfig['targets'] {
  const config = Object.fromEntries(targets.map(t => [t, false])) as ShipsConfig['targets'];
  for (const t of enabled) {
    config[t] = true;
  }
  return config;
}

describe('hasMissionLootData', () => {
  it('checks atreggies missions against the dataset', () => {
    expect(hasMissionLootData('atreggies-extended')).toBe(true);
    expect(hasMissionLootData('atreggies-short')).toBe(false);
  });

  it('assumes every non-atreggies mission has data, even when absent', () => {
    expect(hasMissionLootData('chicken-one-short')).toBe(true);
    expect(hasMissionLootData('henerprise-short')).toBe(true);
  });
});

describe('getMissionLootData', () => {
  it('returns the store for a known mission', () => {
    expect(getMissionLootData('henerprise-extended')).toBe(lootFixture.missions[1]);
  });

  it('throws for an unknown mission', () => {
    expect(() => getMissionLootData('voyegger-short')).toThrow("there's no mission with id voyegger-short");
  });
});

describe('getMissionLevelLootAverageConsumptionValue', () => {
  const levelStore = (
    targetAfxId: ei.ArtifactSpec.Name,
    totalDrops: number,
    items: MissionLevelLootStore['targets'][number]['items']
  ): MissionLevelLootStore => ({ level: 0, targets: [{ targetAfxId, totalDrops, items }] });

  it('returns [0, 0] when the target has no loot entry', () => {
    const store = levelStore(Name.UNKNOWN, 10, []);
    expect(getMissionLevelLootAverageConsumptionValue(store, Name.LUNAR_TOTEM)).toEqual([0, 0]);
  });

  it('returns [0, 0] when the target has no recorded drops', () => {
    const store = levelStore(Name.LUNAR_TOTEM, 0, []);
    expect(getMissionLevelLootAverageConsumptionValue(store, Name.LUNAR_TOTEM)).toEqual([0, 0]);
  });

  it('averages consumption value over total drops', () => {
    // Current lib consumption values: common lunar-totem-1 -> [2 gold, 0 fill],
    // common gold-meteorite-1 -> [0 gold, 5 fill].
    const store = levelStore(Name.UNKNOWN, 10, [
      { itemId: 'lunar-totem-1', afxId: Name.LUNAR_TOTEM, afxLevel: Level.INFERIOR, counts: [3, 0, 0, 0] },
      { itemId: 'gold-meteorite-1', afxId: Name.GOLD_METEORITE, afxLevel: Level.INFERIOR, counts: [2, 0, 0, 0] },
    ]);
    expect(getMissionLevelLootAverageConsumptionValue(store, Name.UNKNOWN)).toEqual([0.6, 1]);
  });

  it('weights each rarity bucket by its observed count', () => {
    const store = levelStore(Name.LUNAR_TOTEM, 4, [
      { itemId: 'lunar-totem-3', afxId: Name.LUNAR_TOTEM, afxLevel: Level.NORMAL, counts: [2, 1, 0, 0] },
    ]);
    const [gold, fill] = getMissionLevelLootAverageConsumptionValue(store, Name.LUNAR_TOTEM);
    const common = itemExpectedFullConsumption(Name.LUNAR_TOTEM, Level.NORMAL, Rarity.COMMON);
    const rare = itemExpectedFullConsumption(Name.LUNAR_TOTEM, Level.NORMAL, Rarity.RARE);
    expect(gold).toBeCloseTo((2 * common[0] + rare[0]) / 4, 12);
    expect(fill).toBeCloseTo((2 * common[1] + rare[1]) / 4, 12);
  });
});

describe('getTierLootData', () => {
  it('collects per-level counts, zero-filling levels where the item never dropped', () => {
    // lunar-totem-1 (quality 0.7) is within chicken-one-short's window and
    // below henerprise-extended's, but it drops there in the fixture, so the
    // henerprise store is kept anyway (withinRange || dropped).
    const result = getTierLootData('lunar-totem-1', enabledTargets(Name.UNKNOWN));
    expect(result.missions).toEqual([
      {
        targetAfxId: Name.UNKNOWN,
        afxShip: Ship.CHICKEN_ONE,
        afxDurationType: Duration.SHORT,
        missionId: 'chicken-one-short',
        levels: [
          { level: 0, totalDrops: 100, counts: [90, 8, 2, 0] },
          { level: 1, totalDrops: 200, counts: [180, 0, 0, 0] },
        ],
      },
      {
        targetAfxId: Name.LUNAR_TOTEM,
        afxShip: Ship.HENERPRISE,
        afxDurationType: Duration.EPIC,
        missionId: 'henerprise-extended',
        levels: [
          { level: 0, totalDrops: 1000, counts: [5, 0, 0, 0] },
          { level: 1, totalDrops: 2000, counts: [0, 0, 0, 0] },
        ],
      },
    ]);
  });

  it("always includes the item's own family target, even when disabled", () => {
    // With every target disabled (UNKNOWN included), untargeted missions are
    // filtered out entirely and FTL ships only report the item's own family.
    // The atreggies store survives on quality range alone, with no levels.
    const result = getTierLootData('lunar-totem-3', enabledTargets());
    expect(result.missions.map(m => [m.missionId, m.targetAfxId, m.levels])).toEqual([
      [
        'henerprise-extended',
        Name.LUNAR_TOTEM,
        [
          { level: 0, totalDrops: 1000, counts: [800, 150, 40, 10] },
          { level: 1, totalDrops: 2000, counts: [1600, 300, 80, 20] },
        ],
      ],
      ['atreggies-extended', Name.LUNAR_TOTEM, []],
    ]);
  });

  it('omits levels with no data for an enabled target', () => {
    // henerprise level 1 has no puzzle-cube-targeted records, so the
    // puzzle-cube store only lists level 0.
    const result = getTierLootData('lunar-totem-3', enabledTargets(Name.PUZZLE_CUBE));
    expect(result.missions.map(m => [m.missionId, m.targetAfxId, m.levels.length])).toEqual([
      ['henerprise-extended', Name.PUZZLE_CUBE, 1],
      ['henerprise-extended', Name.LUNAR_TOTEM, 2],
      ['atreggies-extended', Name.PUZZLE_CUBE, 0],
      ['atreggies-extended', Name.LUNAR_TOTEM, 0],
    ]);
    expect(result.missions[0].levels[0]).toEqual({ level: 0, totalDrops: 500, counts: [10, 0, 0, 3] });
  });
});

describe('missionDataNotEnough', () => {
  it('requires 20 full ships worth of drops', () => {
    const chickenOne = getMissionTypeFromId('chicken-one-short'); // capacity 4
    expect(missionDataNotEnough(chickenOne, 79)).toBe(true);
    expect(missionDataNotEnough(chickenOne, 80)).toBe(false);

    const henerprise = getMissionTypeFromId('henerprise-extended'); // capacity 56
    expect(missionDataNotEnough(henerprise, 1119)).toBe(true);
    expect(missionDataNotEnough(henerprise, 1120)).toBe(false);
  });
});

describe('legendary observation counts', () => {
  it('finds the max legendary count across all missions, levels and targets', () => {
    // lunar-totem-3 legendary counts in the fixture: 10, 3, 20, 0.
    expect(getMaxLegendaryCount('lunar-totem-3')).toBe(20);
    expect(getMaxLegendaryCount('lunar-totem-1')).toBe(0);
  });

  it('returns 0 for an item absent from the dataset', () => {
    expect(getMaxLegendaryCount('book-of-basan-4')).toBe(0);
  });

  it('flags items below MIN_LEGENDARY_OBSERVATIONS as sparse', () => {
    expect(MIN_LEGENDARY_OBSERVATIONS).toBe(5);
    expect(legendaryDataIsSparse('gold-meteorite-1')).toBe(false); // exactly 5
    expect(legendaryDataIsSparse('gold-meteorite-2')).toBe(true); // 4
    expect(legendaryDataIsSparse('lunar-totem-3')).toBe(false); // 20
    expect(legendaryDataIsSparse('puzzle-cube-1')).toBe(true); // 0
  });

  it('does not flag items that cannot drop from missions', () => {
    // T4 Book of Basan and T4 Tachyon Deflector are craft-only
    // (available_from_missions is false): zero observations is structural,
    // not sparse data.
    expect(legendaryDataIsSparse('book-of-basan-4')).toBe(false);
    expect(legendaryDataIsSparse('tachyon-deflector-4')).toBe(false);
  });
});
