// Recipe DAG construction and launch option enumeration for the optimizer.

import { missions } from '@/lib/filter';
import {
  ei,
  getArtifactTierPropsFromId,
  getArtifactName,
  getMissionTypeFromId,
  ShipsConfig,
  type MissionType,
} from 'lib';

import type { DAGChildRef, DAGNode, LaunchOption, RecipeDAG } from './types';
import { getMissionLootData, MIN_LEGENDARY_OBSERVATIONS } from '@/lib';
import { sum } from '@/utils';
import { Ingredient } from 'lib/artifacts/data-json';

export function generateRecipeDag(id: string, recipeDag: RecipeDAG) {
  if (recipeDag.has(id)) return;

  const artifactData = getArtifactTierPropsFromId(id);

  const artifactIngredients = artifactData.recipe?.ingredients ?? [];

  const dagNode: DAGNode = {
    id,
    isLeaf: !artifactData.craftable,
    children: artifactIngredients.map(
      (ingredient: Ingredient): DAGChildRef => ({
        nodeId: ingredient.id,
        quantity: ingredient.count,
      })
    ),
    legendaryCraftProbability: 0, // buildRecipeDag fills this in for the root
  };

  recipeDag.set(id, dagNode);

  for (const ingredient of artifactIngredients) {
    generateRecipeDag(ingredient.id, recipeDag);
  }
}

// Every visible ship crossed with its applicable mission targets, costed per single ship.
// `launchPeriodSeconds` floors each mission's effective duration, penalising short missions without banning them.
export function enumerateLaunchOptions(
  playerConfig: ShipsConfig,
  dag: RecipeDAG,
  launchPeriodSeconds = 0
): LaunchOption[] {
  const options: LaunchOption[] = [];

  // Targeting boosts a whole family, so family is the right granularity here.
  const dagAfxIds = new Set<ei.ArtifactSpec.Name>();
  for (const nodeId of dag.keys()) {
    dagAfxIds.add(getArtifactTierPropsFromId(nodeId).afx_id);
  }

  for (const mission of missions) {
    if (!playerConfig.shipVisibility[mission.shipType]) continue;

    const missionData = getMissionLootData(mission.missionTypeId);
    const levelLootData = missionData.levels[playerConfig.shipLevels[mission.shipType]];
    const missionType = getMissionTypeFromId(missionData.missionId);
    const missionCapacity = missionType.boostedCapacity(playerConfig);
    const maxMissionCapacity = missionType.maxBoostedCapacity();

    const applicableTargets = mission.isFTL
      ? levelLootData.targets
      : levelLootData.targets.filter(target => target.targetAfxId === ei.ArtifactSpec.Name.UNKNOWN);

    // Targets outside the DAG are interchangeable, so keep one representative:
    // the one with the most recorded drops.
    let bestNonDagTarget: (typeof applicableTargets)[number] | undefined;
    for (const target of applicableTargets) {
      if (target.targetAfxId === ei.ArtifactSpec.Name.UNKNOWN) continue;
      if (dagAfxIds.has(target.targetAfxId)) continue;
      if (bestNonDagTarget === undefined || target.totalDrops > bestNonDagTarget.totalDrops) {
        bestNonDagTarget = target;
      }
    }

    for (const target of applicableTargets) {
      const minTotalLaunches = target.totalDrops / maxMissionCapacity;

      // missionDataNotEnough is too conservative here: it divides by the base
      // launch capacity, overestimating the expected launch count.
      if (minTotalLaunches < 20 && !playerConfig.showNodata) continue;

      if (target.targetAfxId !== ei.ArtifactSpec.Name.UNKNOWN && !dagAfxIds.has(target.targetAfxId)) {
        if (target !== bestNonDagTarget) continue;
      }

      const option = makeLaunchOption(mission, target.targetAfxId, playerConfig, launchPeriodSeconds);
      for (const item of target.items) {
        const expectedDropsPerShip = (sum(item.counts) / target.totalDrops) * missionCapacity;
        option.supplyVector.set(item.itemId, expectedDropsPerShip);

        if (dag.has(item.itemId)) {
          // Zero out legendary counts below the observation minimum — a single
          // legendary across tens of thousands of drops gives a misleadingly
          // precise rate.
          const observed = item.counts[3];
          const legendaryCount = observed >= MIN_LEGENDARY_OBSERVATIONS || playerConfig.showNodata ? observed : 0;
          const legendaryRate = (legendaryCount / target.totalDrops) * missionCapacity;

          option.yieldVector.set(item.itemId, expectedDropsPerShip);
          option.legendaryYieldVector.set(item.itemId, legendaryRate);
        }
      }

      options.push(option);
    }
  }

  return options;
}

function makeLaunchOption(
  mission: MissionType,
  target: ei.ArtifactSpec.Name,
  playerConfig: ShipsConfig,
  launchPeriodSeconds = 0
): LaunchOption {
  const id = `${mission.missionTypeId}::${target}`;
  const fuelUse = mission.virtueFuels;

  const nonHumilityFuelUse = fuelUse.filter(x => x.egg !== ei.Egg.HUMILITY);

  const rawTime = mission.boostedDurationSeconds(playerConfig);

  return {
    id,
    ship: mission,
    target: getArtifactName(target),
    targetAfxId: target,
    actualFuel: nonHumilityFuelUse.reduce((agg, current) => agg + current.amount, 0),
    actualTime: Math.max(rawTime, launchPeriodSeconds),
    rawTime,
    fuelByEgg: nonHumilityFuelUse.reduce((agg, current) => agg.set(current.egg, current.amount), new Map()),
    cost: mission.virtueGemCost,
    supplyVector: new Map(),
    yieldVector: new Map(),
    legendaryYieldVector: new Map(),
  };
}
