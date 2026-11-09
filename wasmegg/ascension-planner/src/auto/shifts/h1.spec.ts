import { describe, expect, test } from 'vitest';
import { modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import { runH1 } from './h1';
import type { EngineState, SimulationContext } from '../types';
import { buildLoadoutInputsFromBackup, type AutoLoadoutInputs } from '../loadout';
import { AfxName as N, AfxRarity as R, invArtifact, invStone, syntheticBackup } from '../loadout/testBackup';

function fakeState(): EngineState {
  return {
    currentEgg: 'resilience',
    shiftCount: 0,
    te: 0,
    soulEggs: 1e30,
    bankValue: 0,
    habIds: [0, null, null, null],
    vehicles: [{ vehicleId: 0, trainLength: 1 }],
    researchLevels: { comfortable_nests: 50, hen_house_ac: 50 },
    siloCount: 1,
    tankLevel: 0,
    artifactLoadout: [],
    activeArtifactSet: 'earnings',
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

function fakeContext(overrides: Partial<SimulationContext> = {}): SimulationContext {
  return {
    epicResearchLevels: {},
    colleggtibleModifiers: modifiersFromColleggtibleTiers({}),
    ascensionStartTime: 0,
    planStartOffset: 0,
    assumeDoubleEarnings: false,
    deferForEarningsMode: false,
    ...overrides,
  };
}

const backup = () =>
  syntheticBackup([
    invArtifact(N.QUANTUM_METRONOME, 4, R.RARE),
    invArtifact(N.QUANTUM_METRONOME, 3, R.EPIC),
    invArtifact(N.INTERSTELLAR_COMPASS, 4, R.EPIC),
    invStone(N.QUANTUM_STONE, 4, 2),
    invStone(N.TACHYON_STONE, 4, 2),
  ]);

describe('runH1 with loadout inputs', () => {
  test('a fixed delivery set equips exactly those artifacts, with stones from the input pool', () => {
    const inputs: AutoLoadoutInputs = {
      ...buildLoadoutInputsFromBackup(backup()),
      delivery: { mode: 'fixed', artifactIds: ['quantum-metronome-3-2', null, null, null] },
    };

    const result = runH1(fakeState(), fakeContext({ loadoutInputs: inputs }));

    const elr = result.endState.artifactSets.elr!;
    expect(elr.map(s => s.artifactId)).toEqual(['quantum-metronome-3-2', null, null, null]);
    expect(elr[0].stones).toHaveLength(2);
    expect(elr[0].stones.every(s => s && /^(quantum|tachyon)-stone-4$/.test(s))).toBe(true);
    expect(result.endState.activeArtifactSet).toBe('elr');
  });

  test('works without a backup when inputs are given, and searches auto candidates', () => {
    const inputs = buildLoadoutInputsFromBackup(backup());
    const result = runH1(fakeState(), fakeContext({ loadoutInputs: inputs, rawBackup: undefined }));
    const ids = result.endState.artifactSets.elr!.map(s => s.artifactId);
    expect(ids.some(id => id?.startsWith('quantum-metronome-'))).toBe(true);
    expect(ids).toContain('interstellar-compass-4-2');
  });

  test('zero stones in the pool leaves every socket empty', () => {
    const inputs = buildLoadoutInputsFromBackup(backup());
    for (const tier of [2, 3, 4] as const) {
      inputs.stones.quantum[tier] = 0;
      inputs.stones.tachyon[tier] = 0;
    }
    const result = runH1(fakeState(), fakeContext({ loadoutInputs: inputs }));
    const stones = result.endState.artifactSets.elr!.flatMap(s => s.stones);
    expect(stones.every(s => s === null)).toBe(true);
  });
});
