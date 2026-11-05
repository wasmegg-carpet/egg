import { ArtifactEffect, ArtifactModifier, ArtifactModifiers, EquippedArtifact } from './types';
import { getArtifact, getStone } from './data';

const CLARITY_STONE_FAMILY = 'clarity-stone';
const LIGHT_OF_EGGENDIL_FAMILY = 'light-of-eggendil';

/**
 * How much of an artifact's effects (its stones' too) count on an enlightenment farm: artifacts
 * do nothing there without clarity stones, each adding its share (stacking), and Light of Eggendil
 * always counts in full. Same rule as lib/artifacts/effects.ts and artifact-sandbox.
 */
export function clarityMultiplier(slot: EquippedArtifact): number {
  const artifact = getArtifact(slot.artifactId);
  if (!artifact) return 0;
  if (artifact.familyId === LIGHT_OF_EGGENDIL_FAMILY) return 1;
  return slot.stones.reduce((total, stoneId) => {
    const stone = getStone(stoneId);
    return stone?.familyId === CLARITY_STONE_FAMILY ? total + stone.effectDelta : total;
  }, 0);
}

/** One puzzle cube's research price multiplier: `delta` is its listed effect (−0.6 for T4L). */
export function puzzleCubeFactor(delta: number, clarity: number): number {
  return clarity <= 1 ? 1 + delta * clarity : (1 + delta) / clarity;
}

/**
 * Calculate all artifact modifiers from an equipped loadout, as they work on an enlightenment farm.
 */
export function calculateArtifactModifiers(loadout: EquippedArtifact[]): ArtifactModifiers {
  const effectsByTarget: Record<string, ArtifactEffect[]> = {};
  const add = (target: string, effect: ArtifactEffect) => {
    if (!effectsByTarget[target]) effectsByTarget[target] = [];
    effectsByTarget[target].push(effect);
  };

  for (const slot of loadout) {
    const artifact = getArtifact(slot.artifactId);
    if (!artifact) continue;

    const clarity = clarityMultiplier(slot);
    if (clarity === 0) continue;

    add(artifact.effectTarget, {
      source: 'artifact',
      label: artifact.label,
      effect: artifact.effect,
      effectDelta: artifact.effectDelta * clarity,
      effectTarget: artifact.effectTarget,
      clarity,
    });

    for (const stoneId of slot.stones) {
      const stone = getStone(stoneId);
      if (!stone || stone.familyId === CLARITY_STONE_FAMILY) continue;
      add(stone.effectTarget, {
        source: 'stone',
        label: stone.label,
        effect: stone.effect,
        effectDelta: stone.effectDelta * clarity,
        effectTarget: stone.effectTarget,
        clarity,
      });
    }
  }

  function calcModifier(targets: string | string[]): ArtifactModifier {
    const list = Array.isArray(targets) ? targets : [targets];
    const effects = list.flatMap(target => effectsByTarget[target] || []);
    return {
      effectTarget: list[0],
      effects,
      totalMultiplier: effects.reduce((acc, e) => acc * (1 + e.effectDelta), 1),
      isMultiplicative: true,
    };
  }

  /** Added to a base bonus rather than multiplied: `totalMultiplier` holds the sum here. */
  function calcAdditive(target: string): ArtifactModifier {
    const effects = effectsByTarget[target] || [];
    return {
      effectTarget: target,
      effects,
      totalMultiplier: effects.reduce((acc, e) => acc + e.effectDelta, 0),
      isMultiplicative: false,
    };
  }

  /**
   * Research cost, Artifact Sandbox's rule: past 100% clarity a puzzle cube divides by the clarity
   * instead of scaling its discount (T4L −60% with three T4 clarity stones is 0.4 / 3, not 1 − 1.8).
   */
  function calcResearchCost(): ArtifactModifier {
    const effects = effectsByTarget['research cost'] || [];
    return {
      effectTarget: 'research cost',
      effects,
      totalMultiplier: effects.reduce((acc, e) => acc * puzzleCubeFactor(e.effectDelta / e.clarity, e.clarity), 1),
      isMultiplicative: true,
    };
  }

  return {
    // Light of Eggendil's target is its own, but it's egg value all the same.
    eggValue: calcModifier(['egg value', 'enlightenment egg value']),
    habCapacity: calcModifier('hab capacity'),
    shippingRate: calcModifier('shipping rate'),
    awayEarnings: calcModifier('away earnings'),
    eggLayingRate: calcModifier('egg laying rate'),
    internalHatcheryRate: calcModifier('internal hatchery rate'),
    researchCost: calcResearchCost(),
    soulEggBonus: calcAdditive('bonus per Soul Egg'),
    prophecyEggBonus: calcAdditive('Egg of Prophecy bonus'),
  };
}

/**
 * Create empty artifact modifiers (all multipliers = 1)
 */
export function createEmptyArtifactModifiers(): ArtifactModifiers {
  const emptyModifier = (target: string, isMultiplicative = false): ArtifactModifier => ({
    effectTarget: target,
    effects: [],
    totalMultiplier: 1,
    isMultiplicative,
  });

  return {
    eggValue: emptyModifier('egg value'),
    habCapacity: emptyModifier('hab capacity'),
    shippingRate: emptyModifier('shipping rate'),
    awayEarnings: emptyModifier('away earnings', true),
    eggLayingRate: emptyModifier('egg laying rate'),
    internalHatcheryRate: emptyModifier('internal hatchery rate'),
    researchCost: emptyModifier('research cost'),
    soulEggBonus: { ...emptyModifier('bonus per Soul Egg'), totalMultiplier: 0 },
    prophecyEggBonus: { ...emptyModifier('Egg of Prophecy bonus'), totalMultiplier: 0 },
  };
}

/**
 * How many artifacts can be active at once: 4 with Pro permit, 2 with Standard.
 * `proPermit` undefined means Pro (plans and snapshots from before Standard was supported).
 */
export function artifactSlotCount(proPermit?: boolean): number {
  return proPermit === false ? 2 : 4;
}

/**
 * The loadout as it counts: slots past `artifactSlotCount(proPermit)` become empty. The array keeps
 * its length, so callers that index all 4 slots still work.
 */
export function activeSlots<T extends EquippedArtifact>(loadout: T[], proPermit?: boolean): T[] {
  const count = artifactSlotCount(proPermit);
  if (loadout.length <= count) return loadout;
  return loadout.map((slot, i) => (i < count ? slot : ({ ...slot, artifactId: null, stones: [] } as T)));
}

/**
 * Create an empty artifact loadout (4 empty slots)
 */
export function createEmptyLoadout(): EquippedArtifact[] {
  return [
    { artifactId: null, stones: [] },
    { artifactId: null, stones: [] },
    { artifactId: null, stones: [] },
    { artifactId: null, stones: [] },
  ];
}
