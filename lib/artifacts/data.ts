import { ei } from '../proto';
import { iconURL } from '../utils';
import type { Family, Tier } from './data-json';
import data from './data-json';
import type { ArtifactParameters, CraftingLevelInfo, SpaceshipParameters } from '../eiafx-config-json';
import config from '../eiafx-config-json';

export default data;
export type { Family as AfxFamily, Tier as AfxTier, Recipe, Effect, CraftingPriceParams } from './data-json';

import Name = ei.ArtifactSpec.Name;
import Level = ei.ArtifactSpec.Level;
import Type = ei.ArtifactSpec.Type;

export type PlayerCraftingLevel = { level: number; rarityMult: number };
type configType = {
  missionParameters: SpaceshipParameters[];
  artifactParameters: ArtifactParameters[];
  craftingLevelInfos: CraftingLevelInfo[];
};

export const allPossibleTiers = data.artifact_families.map(f => f.tiers).flat();
export const afxCraftingLevelInfos = config.craftingLevelInfos;

const familyAfxIdToFamily: Map<Name, Family> = new Map(data.artifact_families.map(f => [f.afx_id, f]));

const itemAfxIdToFile: Map<Name, string> = new Map(
  data.artifact_families
    .map(f => f.tiers)
    .flat()
    .map(t => [t.afx_id, t.icon_filename])
);
const itemAfxIdToFamilyId: Map<Name, Name> = new Map(
  data.artifact_families
    .map(f => f.tiers)
    .flat()
    .map(t => [t.afx_id, t.family.afx_id])
);
const itemAfxIdToFamilyName: Map<Name, string> = new Map(
  data.artifact_families
    .map(f => f.tiers)
    .flat()
    .map(t => [t.afx_id, t.family.name])
);
const itemIdToTier: Map<string, Tier> = new Map(
  data.artifact_families
    .map(f => f.tiers)
    .flat()
    .map(t => [t.id, t])
);
const itemAfxIdToType: Map<Name, Type> = new Map(
  data.artifact_families
    .map(f => f.tiers)
    .flat()
    .map(t => [t.afx_id, t.afx_type])
);
const itemIdtoName: Map<Name, string> = new Map(
  data.artifact_families
    .map(f => f.tiers)
    .flat()
    .map(t => [t.afx_id, t.name])
);

export function afxMatchesTarget(afxId: Name, targetId: Name): boolean {
  if (targetId === 10000) {
    return false;
  }
  const afxFamily = itemAfxIdToFamilyName.get(afxId)!;
  const targetFamily = itemAfxIdToFamilyName.get(targetId)!;
  const afxType = itemAfxIdToType.get(afxId)!;
  const targetType = itemAfxIdToType.get(targetId)!;

  if (afxType === Type.STONE_INGREDIENT || targetType === Type.STONE_INGREDIENT) {
    return afxId === targetId;
  }
  return afxFamily === targetFamily;
}
export function getTargetName(afxId: Name): string {
  if (afxId === 10000) {
    return 'Untargeted';
  }
  const familyName = itemAfxIdToFamilyName.get(afxId);
  const type = itemAfxIdToType.get(afxId)!;
  if (type === Type.STONE_INGREDIENT) {
    return itemIdtoName.get(afxId) ?? 'Not Found';
  }
  return familyName ?? `Not Found 2: ${afxId}`;
}

export function getTargetId(afxName: string) {
  for (const id of itemIdtoName.keys()) {
    if (getTargetName(id).toLowerCase() == afxName.toLowerCase()) {
      return id;
    }
  }
  return 10000;
}

export function getArtifactName(afxId: Name): string {
  return itemIdtoName.get(afxId)!;
}

export function getImageUrlFromId(afxId: Name, size?: number): string {
  return iconURL(`egginc/${itemAfxIdToFile.get(afxId)!}`, size ?? 32);
}

export function getArtifactFamilyProps(afxId: Name): Family {
  return familyAfxIdToFamily.get(afxId)!;
}

export function getArtifactTierProps(afxId: Name, afxLevel: Level): Tier {
  const familyId = itemAfxIdToFamilyId.get(afxId)!;
  const type = itemAfxIdToType.get(afxId)!;
  let tierNumber = afxLevel;
  if (type === Type.STONE) {
    tierNumber = afxLevel + 1;
  }
  if (type === Type.STONE_INGREDIENT) {
    tierNumber = 0;
  }
  const tier = familyAfxIdToFamily.get(familyId)?.tiers[tierNumber];
  if (tier === undefined) {
    throw new Error(`there's no artifact tier with id ${afxId} and level ${afxLevel}`);
  }
  if (tier.afx_id !== afxId || tier.afx_level !== afxLevel) {
    throw new Error(`the impossible happened: getArtifactTierProps(${afxId}, ${afxLevel}) returned wrong item`);
  }
  return tier;
}

export function getArtifactTierPropsFromId(id: string): Tier {
  const tier = itemIdToTier.get(id);
  if (tier === undefined) {
    throw new Error(`there's no artifact tier with id ${id}`);
  }
  return tier;
}

// returns a valid crafting level if given a level outside the bounds
export function validateCraftingLevel(level: number) {
  if (level >= afxCraftingLevelInfos.length) {
    return afxCraftingLevelInfos.length;
  } else if (level <= 0) {
    return 1;
  } else {
    return level;
  }
}

export function getCraftingInfoFromLevel(level: number ): PlayerCraftingLevel {
  const clampedLevel = validateCraftingLevel(level);

  const { rarityMult } = afxCraftingLevelInfos[clampedLevel - 1];
  return { level:clampedLevel, rarityMult};
}

export function getXPFromCraftingLevel(level: number) {
  if (level > afxCraftingLevelInfos.length) {
    return 0;
  }
  if (level <= 0) {
    return afxCraftingLevelInfos[0].xpRequired!;
  }

  const levels = afxCraftingLevelInfos.slice(0, level - 1);
  return levels.map(x => x.xpRequired!).reduce((sum, levelXp) => sum + levelXp);
}

export function getCraftingLevelFromXp(craftingXp: number): PlayerCraftingLevel {
  let levelBaseXp = 0;
  const numLevels = afxCraftingLevelInfos.length;

  for (let level = 1; level <= numLevels; ++level) {
    const { xpRequired, rarityMult } = afxCraftingLevelInfos[level - 1];

    if (xpRequired == null || rarityMult == null) {
      console.error(`crafting level ${level} doesn't have valid xpRequired and rarityMult data`);
      return { level: 1, rarityMult: 1 };
    }

    const levelTargetXp = levelBaseXp + xpRequired;

    if (craftingXp < levelTargetXp || level == numLevels) {
      return { level, rarityMult };
    }

    levelBaseXp += xpRequired;
  }

  return { level: 1, rarityMult: 1 };
}

export function updateData(newconfig: configType) {
  const newdata = data;
  for (const fam of newdata.artifact_families) {
    for (let tier of fam.tiers) {
      const artis = newconfig.artifactParameters.filter(
        x => tier.afx_id == Name[x.spec.name] && tier.afx_level == Level[x.spec.level]
      );
      console.log(artis.length);
      tier = artifactsToTier(artis, tier);
    }
  }
  return newdata;
}

function artifactsToTier(artis: ArtifactParameters[], tier: Tier): Tier {
  const arti = artis[0];
  if (tier.effects != null) {
    for (let i = 0; i < artis.length; i++) {
      if (i < tier.effects?.length) {
        tier.effects[i].odds_multiplier = artis[i].oddsMultiplier;
      } else if (i > 0) {
        tier.effects[i] = {
          ...tier.effects[i - 1],
          odds_multiplier: artis[i].oddsMultiplier,
        };
      }
    }
  }
  if (tier.recipe) {
    tier.recipe.crafting_price = {
      base: arti.craftingPrice,
      low: arti.craftingPriceLow,
      domain: arti.craftingPriceDomain,
      curve: arti.craftingPriceCurve,
      initial: Math.floor(arti.craftingPrice),
      minimum: Math.floor(arti.craftingPriceLow),
    };
  }
  tier.available_from_missions = arti.baseQuality < 16.48;
  tier.base_crafting_prices = artis.map(x => x.craftingPrice);
  tier.craftable = ei.ArtifactSpec.Level[arti.spec.level] != 0;
  tier.possible_afx_rarities = artis.map(x => ei.ArtifactSpec.Rarity[x.spec.rarity]);
  tier.odds_multiplier = arti.oddsMultiplier;
  tier.quality = arti.baseQuality;
  tier.crafting_xp = arti.craftingXp;

  return tier;
}
