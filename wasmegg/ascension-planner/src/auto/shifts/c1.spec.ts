import { describe, expect, test } from 'vitest';
import { modifiersFromColleggtibleTiers } from 'lib/collegtibles';
import { runC1 } from './c1';
import type { EngineState, SimulationContext } from '../types';
import type { ArtifactSlotPayload } from '@/types';

const EARNINGS_LOADOUT: ArtifactSlotPayload[] = [
  { artifactId: 'lunar_totem', stones: [] },
  { artifactId: null, stones: [] },
  { artifactId: null, stones: [] },
  { artifactId: null, stones: [] },
];

const ELR_LOADOUT: ArtifactSlotPayload[] = [
  { artifactId: 'metronome', stones: [] },
  { artifactId: null, stones: [] },
  { artifactId: null, stones: [] },
  { artifactId: null, stones: [] },
];

function fakeState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    currentEgg: 'curiosity',
    shiftCount: 0,
    te: 0,
    soulEggs: 1e20,
    bankValue: 0,
    habIds: [0, null, null, null],
    vehicles: [{ vehicleId: 0, trainLength: 1 }],
    researchLevels: {},
    siloCount: 1,
    tankLevel: 0,
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
    ...overrides,
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

// C1 runs at the start of EVERY ascension in a chain (see runC1K1I1Segment/deriveNextStartState in
// ascension.ts), so it must never trust an inherited `activeArtifactSet` — whether from a bad store
// default (the reported bug: player-ID resubmission defaults to 'elr') or from a chain continuation
// whose base state was itself ELR-active for some other reason.
describe('runC1 forces earnings gear on entry', () => {
  test('switches from ELR to the already-known earnings set, with no extra "update" action needed', () => {
    const state = fakeState({
      activeArtifactSet: 'elr',
      artifactLoadout: ELR_LOADOUT,
      artifactSets: { earnings: EARNINGS_LOADOUT, elr: ELR_LOADOUT },
    });
    const context = fakeContext();

    const result = runC1(state, context, 0);

    expect(result.endState.activeArtifactSet).toBe('earnings');
    expect(result.endState.artifactLoadout).toEqual(EARNINGS_LOADOUT);
    const equipActions = result.actions.filter(a => a.type === 'equip_artifact_set');
    expect(equipActions).toHaveLength(1);
    const updateActions = result.actions.filter(a => a.type === 'update_artifact_set');
    expect(updateActions).toHaveLength(0);
  });

  test('a null activeArtifactSet (fresh/legacy state) with a known earnings set also gets switched', () => {
    const state = fakeState({
      activeArtifactSet: null,
      artifactLoadout: [],
      artifactSets: { earnings: EARNINGS_LOADOUT, elr: null },
    });
    const context = fakeContext();

    const result = runC1(state, context, 0);

    expect(result.endState.activeArtifactSet).toBe('earnings');
    expect(result.endState.artifactLoadout).toEqual(EARNINGS_LOADOUT);
  });

  test('already on earnings: still equips explicitly (mandatory, not just a state-change guard), but skips the redundant update', () => {
    const state = fakeState({
      activeArtifactSet: 'earnings',
      artifactLoadout: EARNINGS_LOADOUT,
      artifactSets: { earnings: EARNINGS_LOADOUT, elr: ELR_LOADOUT },
    });
    const context = fakeContext();

    const result = runC1(state, context, 0);

    expect(result.endState.activeArtifactSet).toBe('earnings');
    expect(result.endState.artifactLoadout).toEqual(EARNINGS_LOADOUT);
    const equipActions = result.actions.filter(a => a.type === 'equip_artifact_set');
    expect(equipActions).toHaveLength(1);
    const updateActions = result.actions.filter(a => a.type === 'update_artifact_set');
    expect(updateActions).toHaveLength(0); // set was already known — nothing new to record
  });

  test('ELR-active with no known earnings set and no backup to compute one: left alone rather than equipping empty gear', () => {
    const state = fakeState({
      activeArtifactSet: 'elr',
      artifactLoadout: ELR_LOADOUT,
      artifactSets: { earnings: null, elr: ELR_LOADOUT },
    });
    const context = fakeContext(); // no rawBackup

    const result = runC1(state, context, 0);

    expect(result.endState.activeArtifactSet).toBe('elr');
    expect(result.endState.artifactLoadout).toEqual(ELR_LOADOUT);
  });
});
