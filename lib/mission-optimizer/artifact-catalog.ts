// The artifact lists the optimizer's target picker chooses from. Shared so the artifact explorer and the
// ascension planner offer exactly the same targets, in the same order, under the same names.

import { allPossibleTiers, ei, useSearch, type AfxTier } from '../index';

export function cmpArtifactTiers(a1: AfxTier, a2: AfxTier): number {
  if (a1.family.sort_key < a2.family.sort_key) {
    return -1;
  }
  if (a1.family.sort_key > a2.family.sort_key) {
    return 1;
  }
  if (a1.tier_number < a2.tier_number) {
    return -1;
  }
  if (a1.tier_number > a2.tier_number) {
    return 1;
  }
  return 0;
}

// Sorted on a copy: `allPossibleTiers` belongs to lib, and this module must not depend on who sorted it first.
export const artifacts = [...allPossibleTiers].sort(cmpArtifactTiers).map(artifact => ({
  ...artifact,
  display: `${artifact.name} (T${artifact.tier_number})`,
}));

// Tiers that exist at legendary rarity: the only ones a "chance of a legendary" can be asked about.
export const legendaryArtifacts = artifacts.filter(
  artifact => artifact.effects?.some(rarity => rarity.afx_rarity === ei.ArtifactSpec.Rarity.LEGENDARY) ?? false
);

export const artifactIdToArtifact = new Map(artifacts.map(artifact => [artifact.id, artifact]));

const { search: searchArtifacts } = useSearch(artifacts, 'id', ['display']);
const { search: searchLegendaryArtifacts } = useSearch(legendaryArtifacts, 'id', ['display']);
export { searchArtifacts, searchLegendaryArtifacts };
