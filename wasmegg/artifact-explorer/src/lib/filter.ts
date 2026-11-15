import { useSearch } from 'lib';
import {
  artifacts,
  artifactIdToArtifact,
  legendaryArtifacts,
  searchArtifacts,
  searchLegendaryArtifacts,
} from 'lib/mission-optimizer/artifact-catalog';
import { missions } from 'lib/mission-optimizer/missions';
import { parseTankIds } from './tank-ids';
export { missions, artifacts, artifactIdToArtifact, legendaryArtifacts };

export const artifactIds = artifacts.map(artifact => artifact.id);

// The tank route's id list, restricted to ids naming a real artifact: the param
// is hand-editable and an unknown id reaches getArtifactTierPropsFromId(),
// which throws. Selector and planner must drop exactly the same ids.
export function parseKnownTankIds(param: string | undefined | null): string[] {
  return parseTankIds(param).filter(id => artifactIdToArtifact.has(id));
}
export const missionIds = missions.map(mission => mission.missionTypeId);
export const missionIdToMission = new Map(missions.map(mission => [mission.missionTypeId, mission]));

const { search: searchMissions } = useSearch(missions, 'missionTypeId', ['name']);
export { searchArtifacts, searchLegendaryArtifacts, searchMissions };
