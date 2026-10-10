import { ArtifactEffect, ArtifactModifier, ArtifactModifiers, EquippedArtifact } from './types';
import { getArtifact, getStone } from './options';

/**
 * Calculate all artifact modifiers from an equipped loadout.
 */
export function calculateArtifactModifiers(loadout: EquippedArtifact[]): ArtifactModifiers {
  const effectsByTarget: Record<string, ArtifactEffect[]> = {};

  for (const slot of loadout) {
    const artifact = getArtifact(slot.artifactId);
    if (artifact) {
      const target = artifact.effectTarget;
      if (!effectsByTarget[target]) effectsByTarget[target] = [];
      effectsByTarget[target].push({
        source: 'artifact',
        label: artifact.label,
        effect: artifact.effect,
        effectDelta: artifact.effectDelta,
        effectTarget: target,
      });

      for (const stoneId of slot.stones) {
        const stone = getStone(stoneId);
        if (stone) {
          const stoneTarget = stone.effectTarget;
          if (!effectsByTarget[stoneTarget]) effectsByTarget[stoneTarget] = [];
          effectsByTarget[stoneTarget].push({
            source: 'stone',
            label: stone.label,
            effect: stone.effect,
            effectDelta: stone.effectDelta,
            effectTarget: stoneTarget,
          });
        }
      }
    }
  }

  function calcModifier(target: string): ArtifactModifier {
    const effects = effectsByTarget[target] || [];
    const totalMultiplier = effects.reduce((acc, e) => acc * (1 + e.effectDelta), 1);
    return {
      effectTarget: target,
      effects,
      totalMultiplier,
      isMultiplicative: true,
    };
  }

  return {
    eggValue: calcModifier('egg value'),
    habCapacity: calcModifier('hab capacity'),
    shippingRate: calcModifier('shipping rate'),
    awayEarnings: calcModifier('away earnings'),
    eggLayingRate: calcModifier('egg laying rate'),
    internalHatcheryRate: calcModifier('internal hatchery rate'),
    researchCost: calcModifier('research cost'),
  };
}

/**
 * Create empty artifact modifiers (all multipliers = 1).
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
  };
}

/**
 * Create an empty artifact loadout (4 empty slots).
 */
export function createEmptyLoadout(): EquippedArtifact[] {
  return [
    { artifactId: null, stones: [] },
    { artifactId: null, stones: [] },
    { artifactId: null, stones: [] },
    { artifactId: null, stones: [] },
  ];
}
