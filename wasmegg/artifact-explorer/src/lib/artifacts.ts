import { AfxTier, allPossibleTiers, ei, getArtifactTierProps } from 'lib';
import Name = ei.ArtifactSpec.Name;
import Level = ei.ArtifactSpec.Level;
import Rarity = ei.ArtifactSpec.Rarity;
import eiafxConfig from 'lib/eiafx-config-json';
import { cmpArtifactTiers } from 'lib/mission-optimizer/artifact-catalog';
import { capitalize } from '@/utils';

export { cmpArtifactTiers };

export interface ArtifactLike extends AfxTier {
  afx_rarity: Rarity;
  rarity: string;
}

export function newArtifact(tier: AfxTier, afxRarity: Rarity): ArtifactLike {
  return {
    ...tier,
    afx_rarity: afxRarity,
    rarity: capitalize(Rarity[afxRarity]),
  };
}

export function cmpArtifacts(a1: ArtifactLike, a2: ArtifactLike): number {
  const cmp = cmpArtifactTiers(a1, a2);
  if (cmp !== 0) {
    return cmp;
  }
  return a1.afx_rarity - a2.afx_rarity;
}

export const artifactTiers = allPossibleTiers.sort(cmpArtifactTiers);
export const artifacts = eiafxConfig.artifactParameters
  .map(params => ({
    ...newArtifact(getArtifactTierProps(Name[params.spec.name], Level[params.spec.level]), Rarity[params.spec.rarity]),
    params,
  }))
  .sort(cmpArtifacts);
