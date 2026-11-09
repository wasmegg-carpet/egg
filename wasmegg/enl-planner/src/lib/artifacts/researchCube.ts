/**
 * "Assume cube used for research purchases": research is priced as if the player swaps this puzzle
 * cube in right before each purchase and their saved set back afterwards. The planner doesn't know
 * the player's inventory, so the default is the best there is: T4L with three T4 clarity stones.
 */
import { getArtifact, getArtifactsByFamily, getStone } from './data';
import { puzzleCubeFactor } from './calculator';

export interface ResearchCubeSetting {
  enabled: boolean;
  artifactId: string | null;
  stones: (string | null)[];
}

const PUZZLE_CUBE_FAMILY = 'puzzle-cube';
const CLARITY_FAMILY = 'clarity-stone';

/** Puzzle cubes, strongest discount first. */
export function puzzleCubeOptions() {
  return [...getArtifactsByFamily(PUZZLE_CUBE_FAMILY)].sort(
    (a, b) => a.effectDelta - b.effectDelta || b.slots - a.slots
  );
}

export function defaultResearchCube(): ResearchCubeSetting {
  const best = puzzleCubeOptions()[0];
  return { enabled: true, artifactId: best.id, stones: Array(best.slots).fill(`${CLARITY_FAMILY}-4`) };
}

/** The cube's clarity: its clarity stones added up (non-clarity stones do nothing for price). */
export function researchCubeClarity(setting: ResearchCubeSetting): number {
  const slots = getArtifact(setting.artifactId)?.slots ?? 0;
  return setting.stones.slice(0, slots).reduce((total, id) => {
    const stone = getStone(id);
    return stone?.familyId === CLARITY_FAMILY ? total + stone.effectDelta : total;
  }, 0);
}

/** Research price multiplier from the cube alone; 1 when it has no clarity (it does nothing). */
export function researchCubeMultiplier(setting: ResearchCubeSetting): number {
  const cube = getArtifact(setting.artifactId);
  const clarity = researchCubeClarity(setting);
  if (!cube || clarity === 0) return 1;
  return puzzleCubeFactor(cube.effectDelta, clarity);
}

/** The multiplier research pricing should use instead of the equipped set's, or null when off. */
export function researchCubeOverride(setting: ResearchCubeSetting | undefined): number | null {
  return setting?.enabled ? researchCubeMultiplier(setting) : null;
}
