/**
 * "Assume cube used for research purchases": research is priced as if the player swaps this puzzle
 * cube in right before each purchase and their saved set back afterwards. The default is the best
 * the player has; with no inventory that's the best there is, T4L with three T4 clarity stones. The
 * cube can reuse stones from the artifact set, because they can be moved over for each purchase.
 */
import { getArtifact, getArtifactsByFamily, getStone, getStonesByFamily } from './data';
import { puzzleCubeFactor } from './calculator';
import { ownedStoneCount, ownsArtifact, type PlayerInventory } from './inventory';

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

/** The cubes the player has, strongest discount first. */
export function ownedPuzzleCubes(inventory: PlayerInventory | null | undefined) {
  return puzzleCubeOptions().filter(cube => ownsArtifact(inventory, cube.id));
}

/** The best the player can put together: each owned cube filled with their strongest clarity stones. */
export function defaultResearchCube(inventory: PlayerInventory | null = null): ResearchCubeSetting {
  const clarityStones = [...getStonesByFamily(CLARITY_FAMILY)].sort((a, b) => b.tier - a.tier);
  let best: ResearchCubeSetting = { enabled: true, artifactId: null, stones: [] };
  let bestMultiplier = Infinity;
  for (const cube of ownedPuzzleCubes(inventory)) {
    const stones: (string | null)[] = [];
    for (const stone of clarityStones) {
      const room = cube.slots - stones.length;
      const take = Math.min(room, ownedStoneCount(inventory, stone.id));
      for (let i = 0; i < take; i++) stones.push(stone.id);
    }
    while (stones.length < cube.slots) stones.push(null);
    const setting = { enabled: true, artifactId: cube.id, stones };
    const multiplier = researchCubeMultiplier(setting);
    if (multiplier < bestMultiplier) {
      best = setting;
      bestMultiplier = multiplier;
    }
  }
  return best;
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
