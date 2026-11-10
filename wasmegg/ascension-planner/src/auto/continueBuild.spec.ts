import { describe, expect, test } from 'vitest';
import { runAscensionFromC3Variant, runUntilShift } from './ascension';
import { runContinueBuild } from './continueBuild';
import { simulate } from 'lib/planners/engine/simulate';
import { countTEThresholdsPassed } from '@/lib/truthEggs';
import { detectBuildStep } from './buildStep';
import { socketEarningsStones } from './loadout';
import { maxedBaseState, maxedContext } from '@/buildTable/maxedAccount';
import { contextAt, startStateAt, variantsFrom } from '@/buildTable/cell';
import type { EngineState } from './types';

const EARNINGS_LOADOUT = [
  { artifactId: 'lunar-totem-4-3', stones: ['lunar-stone-4', 'lunar-stone-4', 'lunar-stone-4'] },
  { artifactId: 'puzzle-cube-4-3', stones: ['shell-stone-4', 'shell-stone-4', 'shell-stone-4'] },
];
const DELIVERY_LOADOUT = [
  { artifactId: 'quantum-metronome-4-3', stones: ['tachyon-stone-4', 'tachyon-stone-4', 'tachyon-stone-4'] },
  { artifactId: 'gusset-4-3', stones: ['quantum-stone-4', 'quantum-stone-4', 'quantum-stone-4'] },
];

function farm(overrides: Partial<EngineState>): EngineState {
  return { ...maxedBaseState(), artifactLoadout: EARNINGS_LOADOUT, ...overrides };
}

const ALL_HYPERLOOPS = Array.from({ length: 17 }, () => ({ vehicleId: 11, trainLength: 1 }));
const FLEET_MAXED = {
  vehicle_reliablity: 2, excoskeletons: 2, traffic_management: 2, egg_loading_bots: 2, autonomous_vehicles: 5,
};

describe('detectBuildStep', () => {
  test('a delivery set or Humility means the build is done', () => {
    expect(detectBuildStep(farm({ artifactLoadout: DELIVERY_LOADOUT }))).toBeNull();
    expect(detectBuildStep(farm({ currentEgg: 'humility' }))).toBeNull();
  });

  test('a compass or metronome counts as delivery when the stones are mixed', () => {
    const mixed = [{ artifactId: 'interstellar-compass-4-3', stones: ['lunar-stone-4', 'quantum-stone-4', null] }];
    expect(detectBuildStep(farm({ artifactLoadout: mixed }))).toBeNull();
  });

  test('Integrity is I1, Resilience is R1', () => {
    expect(detectBuildStep(farm({ currentEgg: 'integrity' }))).toBe('I1');
    expect(detectBuildStep(farm({ currentEgg: 'resilience' }))).toBe('R1');
  });

  test('Kindness is K2 with 17 vehicle slots available, else K1', () => {
    expect(detectBuildStep(farm({ currentEgg: 'kindness' }))).toBe('K1');
    expect(detectBuildStep(farm({ currentEgg: 'kindness', researchLevels: FLEET_MAXED }))).toBe('K2');
  });

  test('Curiosity is C1 before Autonomous Vehicles is maxed, C2 before 17 Hyperloops, else C3', () => {
    expect(detectBuildStep(farm({ researchLevels: { ...FLEET_MAXED, autonomous_vehicles: 4 } }))).toBe('C1');
    const sixteen = [...ALL_HYPERLOOPS.slice(1), { vehicleId: 10, trainLength: 1 }];
    expect(detectBuildStep(farm({ researchLevels: FLEET_MAXED, vehicles: sixteen }))).toBe('C2');
    expect(detectBuildStep(farm({ researchLevels: FLEET_MAXED, vehicles: ALL_HYPERLOOPS }))).toBe('C3');
  });
});

describe('runContinueBuild', () => {
  const TE = 200;
  const START = 1_793_368_800; // 2026-10-30 08:00 America/Denver
  const TARGET = 230;

  /** The fastest regular build variant from `state` (an empty farm at TE), as the generator runs it. */
  function bestRegular(state: EngineState, start: number) {
    const context = contextAt(maxedContext(), start);
    const preC3 = runUntilShift(state, context, 'C3');
    return variantsFrom(preC3, context, TE)
      .map(v => runAscensionFromC3Variant(state, preC3, v, context, start, 'a', TARGET))
      .reduce((a, b) => (a.summary.totalDurationSeconds <= b.summary.totalDurationSeconds ? a : b));
  }

  test('from C1 on a fresh farm wearing the earnings set, it matches the regular build', () => {
    const inputs = maxedContext().loadoutInputs!;
    const fresh = startStateAt(maxedBaseState(), TE);
    const wearing = { ...fresh, artifactLoadout: socketEarningsStones(inputs.earnings, inputs.stones) };
    const regular = bestRegular(fresh, START);

    const continued = runContinueBuild(
      wearing, contextAt(maxedContext(), START), 'C1', START, 'c', TARGET, undefined, false
    )!;

    expect(continued.summary.continueFromStep).toBe('C1');
    expect(continued.summary.strategyLabel).toMatch(/^Continue from C1, \d-sale build$/);
    expect(continued.actions[0].type).toBe('start_ascension');
    expect(continued.summary.endTE).toBe(TARGET);
    expect(continued.summary.endTime).toBeCloseTo(regular.summary.endTime, -1);
  }, 240000);

  test('from I1 on a farm with no research, the opening falls back to a second round and still finishes', () => {
    const inputs = maxedContext().loadoutInputs!;
    const onIntegrity: EngineState = {
      ...startStateAt(maxedBaseState(), TE),
      currentEgg: 'integrity',
      artifactLoadout: socketEarningsStones(inputs.earnings, inputs.stones),
    };

    const continued = runContinueBuild(
      onIntegrity, contextAt(maxedContext(), START), 'I1', START, 'c', TARGET, undefined, false
    )!;

    const names = continued.actions.flatMap(a => (a.type === 'shift' ? [a.payload.autoShiftName] : []));
    // Already on Integrity, so I1 has no shift; then a second C/K/I round and the rest of the build.
    expect(names.slice(0, 6)).toEqual(['C1', 'K1', 'I1', 'C2', 'K2', 'R1']);
    expect(names).toEqual(expect.arrayContaining(['H1', 'K3']));
    expect(continued.summary.endTE).toBe(TARGET);
  }, 240000);

  test('replays from the farm it started on, as a library plan loaded in the manual planner does', () => {
    const inputs = maxedContext().loadoutInputs!;
    const fresh = startStateAt(maxedBaseState(), TE);
    const before = runUntilShift(fresh, contextAt(maxedContext(), START), 'K2');
    const resumeAt = START + before.elapsedSeconds;
    const loadout = socketEarningsStones(inputs.earnings, inputs.stones);
    const farmNow: EngineState = { ...before.state, lastStepTime: 0, artifactLoadout: loadout };
    const context = contextAt(maxedContext(), resumeAt);
    const plan = runContinueBuild(farmNow, context, 'K2', resumeAt, 'c', TARGET, undefined, false)!;

    // A loaded plan's engine starts from an empty farm with the save's eggs and gear; the start
    // action puts the farm on it.
    const empty: EngineState = { ...fresh, eggsDelivered: { ...farmNow.eggsDelivered }, artifactLoadout: loadout };
    const replay = (actions: typeof plan.actions) =>
      simulate(JSON.parse(JSON.stringify(actions)), { ...context, loadoutInputs: undefined }, empty).at(-1)!.endState;

    const simulated = plan.actions.at(-1)!.endState;
    const replayed = replay(plan.actions);
    expect(replayed.researchLevels).toEqual(simulated.researchLevels);
    expect(replayed.habIds).toEqual(simulated.habIds);
    expect(replayed.vehicles).toEqual(simulated.vehicles);
    expect(replayed.siloCount).toBe(simulated.siloCount);
    expect(replayed.lastStepTime).toBeCloseTo(simulated.lastStepTime, -2);
    const teOf = (eggs: Record<string, number>) =>
      Object.values(eggs).reduce((n, d) => n + countTEThresholdsPassed(d || 0), 0);
    expect(teOf(replayed.eggsDelivered)).toBe(plan.summary.endTE);

    // Without the farm on the start action, the replay starts from nothing and goes wrong.
    const bare = JSON.parse(JSON.stringify(plan.actions));
    delete bare[0].payload.initialFarmState;
    expect(replay(bare).researchLevels).not.toEqual(simulated.researchLevels);
  }, 240000);

  test.each(['K2', 'R1', 'C3'] as const)('resuming at %s mid-build lands where the regular build does', step => {
    const inputs = maxedContext().loadoutInputs!;
    const fresh = startStateAt(maxedBaseState(), TE);
    const regular = bestRegular(fresh, START);

    // The regular build's farm just before `step`, wearing its earnings set.
    const before = runUntilShift(fresh, contextAt(maxedContext(), START), step);
    const resumeAt = START + before.elapsedSeconds;
    const farmNow: EngineState = {
      ...before.state,
      lastStepTime: 0,
      artifactLoadout: socketEarningsStones(inputs.earnings, inputs.stones),
    };

    const continued = runContinueBuild(
      farmNow, contextAt(maxedContext(), resumeAt), step, resumeAt, 'c', TARGET, undefined, false
    )!;

    expect(continued.summary.continueFromStep).toBe(step);
    expect(continued.summary.endTE).toBe(TARGET);
    expect(continued.summary.endTime).toBeCloseTo(regular.summary.endTime, -1);
  }, 240000);
});
