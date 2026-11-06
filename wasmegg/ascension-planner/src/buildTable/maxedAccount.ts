/**
 * The idealized account the build table is simulated on: the maxed sets below, plenty of T4 stones
 * of each family, all epic research and every colleggtible maxed.
 *
 * Seven T4L artifacts: the lunar totem sits in both sets (sets are swapped, never worn together).
 * Delivery is `fixed`, so H1 keeps this structure and only places stones; C1 sockets the earnings
 * set from the lunar/shell pool.
 */
import { colleggtibleDefs, modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import { getArtifact } from '@/lib/artifacts/data';
import { epicResearchDefs } from 'lib/planners/epicResearch';
import { createEmptyStonePool, withEmptyStones, type AutoLoadoutInputs } from '@/auto/loadout';
import type { EngineState, SimulationContext } from '@/auto/types';

export const MAXED_EARNINGS = ['lunar-totem-4-3', 'puzzle-cube-4-3', 'demeters-necklace-4-3', 'tungsten-ankh-4-3'];
export const MAXED_DELIVERY = ['quantum-metronome-4-3', 'interstellar-compass-4-3', 'gusset-4-3', 'lunar-totem-4-3'];

/** Enough to fill every stone slot of four 3-slot artifacts from one family. */
const STONES_PER_FAMILY = 12;

/** `delivery`: the fixed delivery structure; the maxed set unless the Table Builder picks another. */
export function maxedLoadoutInputs(delivery: string[] = MAXED_DELIVERY): AutoLoadoutInputs {
  for (const id of [...MAXED_EARNINGS, ...delivery])
    if (!getArtifact(id)) throw new Error(`unknown artifact id ${id}`);
  const stones = createEmptyStonePool();
  for (const family of ['lunar', 'shell', 'quantum', 'tachyon'] as const) stones[family][4] = STONES_PER_FAMILY;
  return {
    earnings: withEmptyStones(MAXED_EARNINGS.map(artifactId => ({ artifactId, stones: [] }))),
    delivery: { mode: 'fixed', artifactIds: [...delivery] },
    stones,
  };
}

/** The cell-independent context; `contextAt` adds each cell's start time. */
export function maxedContext(delivery: string[] = MAXED_DELIVERY, deferForEarnings = false): SimulationContext {
  return {
    epicResearchLevels: Object.fromEntries(epicResearchDefs.map(r => [r.id, r.maxLevel])),
    colleggtibleModifiers: modifiersFromColleggtibleTiers(Object.fromEntries(colleggtibleDefs.map(d => [d.id, 3]))),
    ascensionStartTime: 0,
    planStartOffset: 0,
    assumeDoubleEarnings: true,
    deferForEarningsMode: deferForEarnings,
    loadoutInputs: maxedLoadoutInputs(delivery),
  };
}

/** Permanent progress only; `startStateAt` lays the TE and the reset farm over it. */
export function maxedBaseState(): EngineState {
  return {
    currentEgg: 'curiosity',
    shiftCount: 0,
    te: 0,
    // Only shift costs read this, never timing.
    soulEggs: 1e30,
    bankValue: 0,
    habIds: [0, null, null, null],
    vehicles: [{ vehicleId: 0, trainLength: 1 }],
    researchLevels: {},
    siloCount: 1,
    tankLevel: 0,
    // Tables are built for Pro permit only; the Chain Finder and Table Builder warn Standard players.
    proPermit: true,
    artifactLoadout: [],
    activeArtifactSet: null,
    artifactSets: { earnings: null, elr: null },
    fuelTankAmounts: {} as EngineState['fuelTankAmounts'],
    eggsDelivered: {} as EngineState['eggsDelivered'],
    teEarned: {} as EngineState['teEarned'],
    population: 0,
    lastStepTime: 0,
    activeSales: { research: false, hab: false, vehicle: false },
    earningsBoost: { active: false, multiplier: 1 },
  };
}
