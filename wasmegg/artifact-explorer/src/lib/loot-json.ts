import { ei } from 'lib';
import data from '../../data/loot.json';

export default data as lootjson;

export type lootjson = {
  missions: MissionLootStore[];
};

export type MissionLootStore = {
  afxShip: ei.MissionInfo.Spaceship;
  afxDurationType: ei.MissionInfo.DurationType;
  missionId: string;
  levels: MissionLevelLootStore[];
};

export type MissionLevelLootStore = {
  level: number;
  targets: MissionTargetLootStore[];
};

export type MissionTargetLootStore = {
  totalDrops: number;
  targetAfxId: ei.ArtifactSpec.Name;
  items: ArtifactTierLootStore[];
};

export type ArtifactTierLootStore = {
  afxId: ei.ArtifactSpec.Name;
  afxLevel: ei.ArtifactSpec.Level;
  itemId: string;
  counts: [number, number, number, number];
};
