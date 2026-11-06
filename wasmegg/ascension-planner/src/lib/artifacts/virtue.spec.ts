import { describe, expect, it } from 'vitest';
import { modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import { calculateHabCapacity_Full } from 'lib/planners/calculations/habCapacity';
import { calculateLayRate } from 'lib/planners/calculations/layRate';
import { calculateShippingCapacity } from 'lib/planners/calculations/shippingCapacity';
import { calculateArtifactModifiers } from './calculator';
import { getArtifact } from './data';
import type { EquippedArtifact } from './types';
import { getOptimalELRSetFromPool, type DeliveryPool, type DeliveryPoolStone } from './virtue';

const SET = ['quantum-metronome-4-3', 'interstellar-compass-4-3', 'gusset-4-3', 'lunar-totem-4-3'];
const colleggtibleModifiers = modifiersFromColleggtibleTiers({});
const epicResearchLevels = {};
const habIds = [18, null, null, null];
const vehicles = [
  { vehicleId: 11, trainLength: 5 },
  { vehicleId: 9, trainLength: 2 },
];

const flat = (set: EquippedArtifact[]) => set.flatMap(slot => slot.stones).sort();

/** The placement rule the search follows, with every slot's rates worked out from scratch. */
function placedFromScratch(commonResearch: Record<string, number>, pool: DeliveryPool): (string | null)[] {
  const loadout: EquippedArtifact[] = SET.map(artifactId => ({
    artifactId,
    stones: new Array(getArtifact(artifactId)!.slots).fill(null),
  }));
  const rates = () => {
    const mods = calculateArtifactModifiers(loadout);
    const population = calculateHabCapacity_Full({
      habIds,
      researchLevels: commonResearch,
      habCapMultiplier: colleggtibleModifiers.habCap,
      artifactMultiplier: mods.habCapacity.totalMultiplier,
      artifactEffects: mods.habCapacity.effects,
    }).totalFinalCapacity;
    const lay = calculateLayRate({
      researchLevels: commonResearch,
      epicComfyNestsLevel: 0,
      elrMultiplier: colleggtibleModifiers.elr,
      population,
      artifactMultiplier: mods.eggLayingRate.totalMultiplier,
      artifactEffects: mods.eggLayingRate.effects,
    }).totalRatePerSecond;
    const ship = calculateShippingCapacity({
      vehicles,
      researchLevels: commonResearch,
      transportationLobbyistLevel: 0,
      shippingCapMultiplier: colleggtibleModifiers.shippingCap,
      artifactMultiplier: mods.shippingRate.totalMultiplier,
      artifactEffects: mods.shippingRate.effects,
    }).totalFinalCapacity;
    return { lay, ship };
  };
  const tachyon = pool.tachyon.map(s => ({ ...s }));
  const quantum = pool.quantum.map(s => ({ ...s }));
  const take = (stones: DeliveryPoolStone[]) => {
    const stone = stones.find(s => s.count > 0);
    if (stone) stone.count--;
    return stone?.id ?? null;
  };
  for (const slot of loadout) {
    for (let i = 0; i < slot.stones.length; i++) {
      const { lay, ship } = rates();
      slot.stones[i] = lay < ship ? take(tachyon) ?? take(quantum) : take(quantum) ?? take(tachyon);
    }
  }
  return flat(loadout);
}

describe('getOptimalELRSetFromPool stone placement', () => {
  const plenty: Pick<DeliveryPool, 'tachyon' | 'quantum'> = {
    tachyon: [{ id: 'tachyon-stone-4', tier: 4, count: 12 }],
    quantum: [{ id: 'quantum-stone-4', tier: 4, count: 12 }],
  };
  const mixed: Pick<DeliveryPool, 'tachyon' | 'quantum'> = {
    tachyon: [
      { id: 'tachyon-stone-4', tier: 4, count: 1 },
      { id: 'tachyon-stone-3', tier: 3, count: 2 },
      { id: 'tachyon-stone-2', tier: 2, count: 1 },
    ],
    quantum: [
      { id: 'quantum-stone-3', tier: 3, count: 2 },
      { id: 'quantum-stone-2', tier: 2, count: 1 },
    ],
  };

  it.each([
    ['no research, plenty of stones', {}, plenty],
    ['laying research, plenty of stones', { comfy_nests: 50, timeline_diversion: 50 }, plenty],
    ['shipping research, plenty of stones', { hyper_portalling: 25, neural_net_refine: 25 }, plenty],
    ['no research, a few mixed-tier stones', {}, mixed],
    ['laying research, a few mixed-tier stones', { comfy_nests: 50, timeline_diversion: 50 }, mixed],
    ['shipping research, a few mixed-tier stones', { hyper_portalling: 25, neural_net_refine: 25 }, mixed],
  ])('matches working every slot out from scratch: %s', (_label, commonResearch, stones) => {
    const pool: DeliveryPool = { candidates: SET, ...stones };
    const set = getOptimalELRSetFromPool(pool, {
      forcedArtifacts: SET,
      proPermit: true,
      habIds,
      vehicles,
      commonResearch,
      epicResearchLevels,
      colleggtibleModifiers,
    });
    expect(flat(set)).toEqual(placedFromScratch(commonResearch, pool));
  });
});
