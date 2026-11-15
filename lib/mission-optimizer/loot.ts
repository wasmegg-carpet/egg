import {
  ei,
  getArtifactTierPropsFromId,
  getMissionTypeFromId,
  itemExpectedFullConsumption,
  MissionType,
  targets,
  type ShipsConfig,
} from '../index';

import type { lootjson, MissionLevelLootStore, MissionLootStore } from './loot-json';
import data from './loot-json';

const lootdata = data as lootjson;

export { lootdata, type ItemMissionLootStore };

export function hasMissionLootData(missionId: string): boolean {
  if (/atreggies/.test(missionId)) {
    return lootdata.missions.map(m => m.missionId).includes(missionId);
  }
  return true;
}

export function getMissionLootData(missionId: string): MissionLootStore {
  for (const missionLoot of lootdata.missions) {
    if (missionLoot.missionId === missionId) {
      return missionLoot;
    }
  }
  throw new Error(`there's no mission with id ${missionId}`);
}

export function getMissionLevelLootAverageConsumptionValue(
  levelLoot: MissionLevelLootStore,
  target: ei.ArtifactSpec.Name
): [number, number] {
  const loot = levelLoot.targets.find(x => x.targetAfxId == target);
  if (loot === undefined || loot.totalDrops === 0) {
    return [0, 0];
  }
  const total = [0, 0];
  for (const item of loot.items) {
    item.counts.forEach((count, afxRarity) => {
      if (count > 0) {
        const consValue = itemExpectedFullConsumption(item.afxId, item.afxLevel, afxRarity);
        total[0] += count * consValue[0];
        total[1] += count * consValue[1];
      }
    });
  }
  return [total[0] / loot.totalDrops, total[1] / loot.totalDrops];
}

type ItemLootStore = {
  missions: ItemMissionLootStore[];
};

type ItemMissionLootStore = {
  afxShip: ei.MissionInfo.Spaceship;
  targetAfxId: ei.ArtifactSpec.Name;
  afxDurationType: ei.MissionInfo.DurationType;
  missionId: string;
  levels: ItemMissionLevelLootStore[];
};

type ItemMissionLevelLootStore = {
  level: number;
  totalDrops: number;
  counts: [number, number, number, number];
};

export function getTierLootData(itemId: string, enabledTargets: ShipsConfig['targets']): ItemLootStore {
  const item = getArtifactTierPropsFromId(itemId);
  const result: ItemLootStore = {
    missions: [],
  };
  for (const missionLoot of lootdata.missions) {
    const mission = getMissionTypeFromId(missionLoot.missionId);
    const withinRange = mission.params.minQuality <= item.quality && item.quality <= mission.maxBoostedMaxQuality();
    const validTargets = mission.isFTL ? targets : [ei.ArtifactSpec.Name.UNKNOWN];
    for (const target of validTargets) {
      if (!enabledTargets[target] && item.afx_id != target) {
        continue;
      }
      const store: ItemMissionLootStore = {
        targetAfxId: target,
        afxShip: missionLoot.afxShip,
        afxDurationType: missionLoot.afxDurationType,
        missionId: missionLoot.missionId,
        levels: [],
      };
      let dropped = false;
      for (const levelLoot of missionLoot.levels) {
        let counts: [number, number, number, number] | undefined;
        for (const targetLoot of levelLoot.targets.filter(x => x.targetAfxId === target)) {
          for (const itemLoot of targetLoot.items) {
            if (itemLoot.itemId === itemId) {
              counts = itemLoot.counts;
              break;
            }
          }
          store.levels.push({
            level: levelLoot.level,
            totalDrops: targetLoot.totalDrops,
            counts: counts ?? [0, 0, 0, 0],
          });
        }
        if (counts && counts.some(x => x > 0)) {
          dropped = true;
        }
      }
      if (withinRange || dropped) {
        result.missions.push(store);
      }
    }
  }
  return result;
}

export function missionDataNotEnough(mission: MissionType, totalDrops: number) {
  return totalDrops / mission.defaultCapacity < 20;
}

// Legendary drop rates come from counts[3] / totalDrops, and counts[3] is
// often a single observation across tens of thousands of drops — far too
// noisy to trust. Buckets below this minimum get zeroed by the optimizer.
export const MIN_LEGENDARY_OBSERVATIONS = 5;

let _maxLegendaryByItemId: Map<string, number> | null = null;

function maxLegendaryByItemId(): Map<string, number> {
  if (_maxLegendaryByItemId) return _maxLegendaryByItemId;
  const result = new Map<string, number>();
  for (const m of lootdata.missions) {
    for (const level of m.levels) {
      for (const tgt of level.targets) {
        for (const item of tgt.items) {
          const cur = result.get(item.itemId) ?? 0;
          if (item.counts[3] > cur) result.set(item.itemId, item.counts[3]);
        }
      }
    }
  }
  _maxLegendaryByItemId = result;
  return result;
}

export function getMaxLegendaryCount(itemId: string): number {
  return maxLegendaryByItemId().get(itemId) ?? 0;
}

export function legendaryDataIsSparse(itemId: string): boolean {
  return (
    getArtifactTierPropsFromId(itemId).available_from_missions &&
    getMaxLegendaryCount(itemId) < MIN_LEGENDARY_OBSERVATIONS
  );
}
