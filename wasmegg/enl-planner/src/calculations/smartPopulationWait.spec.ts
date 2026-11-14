import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createBaseEngineState, getSimulationContext } from 'lib/planners/engine/adapter';
import { computeSnapshot } from 'lib/planners/engine/compute';
import type { EngineState } from '@/engine/types';
import { useInitialStateStore } from '@/stores/initialState';
import { optimizeIHR } from '@/lib/artifacts/optimizeArtifacts';
import { simulate } from 'lib/planners/engine/simulate';
import { createSimAction, type Action } from '@/types';
import { getCommonResearches } from '@/calculations/commonResearch';
import {
  planSmartPopulationWait,
  wormholeDampeningNeeded,
  describeSlotSwap,
  alignLoadout,
  smartWaitOps,
  changedSlotIndexes,
  DIAMOND_POPULATION,
  type SmartWaitOp,
  type SmartWaitStep,
  type SmartWaitTarget,
} from './smartPopulationWait';

describe('smart wait for population', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    setActivePinia(createPinia());
    useInitialStateStore().setSoulEggs(1e21);
  });

  function farm(over: Partial<EngineState> = {}): EngineState {
    return {
      ...createBaseEngineState(null),
      habIds: [18, 18, 18, 18],
      vehicles: Array.from({ length: 10 }, () => ({ vehicleId: 9, trainLength: 1 })),
      population: 1e6,
      researchLevels: {
        internal_hatchery1: 10,
        internal_hatchery2: 10,
        internal_hatchery3: 15,
        hab_capacity1: 8,
        microlux: 10,
        grav_plating: 25,
        wormhole_dampening: 10,
      },
      ...over,
    };
  }

  /** The default farm's plan with sets only, worked out once: each search takes a second or so. */
  const baseState = () => ({ ...farm(), artifactSets: { earnings: null, elr: null }, activeArtifactSet: null });
  const plans = new Map<string, ReturnType<typeof planSmartPopulationWait>>();
  const basePlan = (target: SmartWaitTarget = 'nah') => {
    if (!plans.has(target)) {
      plans.set(
        target,
        planSmartPopulationWait(baseState(), getSimulationContext(), { swapBeamWidth: 100, research: false, target })
      );
    }
    return plans.get(target)!;
  };
  const waitsOf = (step: SmartWaitStep) => step.events.flatMap(e => (e.kind === 'wait' ? [e.wait] : []));
  const purchasesOf = (plan: { steps: SmartWaitStep[] }) =>
    plan.steps.flatMap(step => step.events.flatMap(e => (e.kind === 'purchase' ? [e.purchase] : [])));

  /** Ops as engine actions: research purchases become their chains' purchases, priced as planned. */
  const opsAsActions = (ops: SmartWaitOp[]) =>
    ops.flatMap(op =>
      op.kind === 'action'
        ? [createSimAction(op.action.type, op.action.payload as never) as Action]
        : op.purchase.items.flatMap(item =>
            'research' in item
              ? [
                  createSimAction(
                    'buy_research',
                    { researchId: item.research.id, fromLevel: item.currentLevel, toLevel: item.targetLevel },
                    item.price
                  ) as Action,
                ]
              : item.steps.map(step => createSimAction(step.type, step.payload as never, step.cost) as Action)
          )
    );
  const played = (state: EngineState, ops: SmartWaitOp[]) => {
    const result = simulate(opsAsActions(ops), getSimulationContext(), state);
    return {
      end: result[result.length - 1].endState,
      seconds: result.reduce((sum, a) => sum + (a.totalTimeSeconds || 0), 0),
    };
  };

  test('starts on the max IHR set, then swaps for room until no set holds more', async () => {
    const state = baseState();
    const context = getSimulationContext();
    const plan = await basePlan();
    if (!plan.ok) throw new Error(plan.reason);

    // Starts as fast as the Max IHR set (on a tie in IHR, the set with bigger habs: here the
    // gusset carrying the life stones the Max IHR set had on another artifact).
    const maxIhr = optimizeIHR(state, context);
    if (!maxIhr.ok) throw new Error(maxIhr.reason);
    expect(plan.steps[0].ihr).toBeCloseTo(maxIhr.offlineIHR, 6);
    expect(plan.steps.length).toBeGreaterThan(1);

    for (let i = 1; i < plan.steps.length; i++) {
      const [prev, step] = [plan.steps[i - 1], plan.steps[i]];
      expect(waitsOf(prev)).toHaveLength(1);
      expect(step.startPopulation).toBe(prev.habCapacity);
      expect(step.habCapacity).toBeGreaterThan(prev.habCapacity);
      // Each swap trades IHR for room, so the rate never goes up.
      expect(step.ihr).toBeLessThanOrEqual(prev.ihr * (1 + 1e-9));
      expect(step.changedSlots.length).toBeGreaterThan(0);
      expect(step.endSeconds).toBeCloseTo(prev.endSeconds + waitsOf(step)[0].seconds, 6);
    }
    expect(plan.finalPopulation).toBe(plan.steps[plan.steps.length - 1].habCapacity);

    // Nothing holds more than the final habs.
    const end = { ...state, population: plan.finalPopulation };
    expect(optimizeIHR(end, context, { habCapacityAbove: plan.finalPopulation }).ok).toBe(false);

    // The last set is a gusset with all clarity.
    const gusset = plan.steps[plan.steps.length - 1].loadout.find(s => s.artifactId?.includes('gusset'));
    expect(gusset?.stones.every(s => s?.startsWith('clarity-stone'))).toBe(true);
  }, 30000);

  test('the actions it adds take the plan to the final population in the planned time', async () => {
    const state = baseState();
    const plan = await basePlan();
    if (!plan.ok) throw new Error(plan.reason);
    const ops = smartWaitOps(plan, state);
    const types = ops.map(op => (op.kind === 'action' ? op.action.type : 'purchase'));
    expect(types[0]).toBe('update_artifact_set');
    expect(types[1]).toBe('equip_artifact_set');
    expect(types.filter(t => t === 'equip_artifact_set')).toHaveLength(1);

    const { end, seconds } = played(state, ops);
    expect(end.population).toBeCloseTo(plan.finalPopulation, -2);
    expect(seconds).toBeCloseTo(plan.totalSeconds, 0);
  }, 30000);

  test('marks EnD on the way to NAH, and an EnD target stops there', async () => {
    const state = baseState();
    const nah = await basePlan('nah');
    const end = await basePlan('end');
    if (!nah.ok || !end.ok) throw new Error('no plan');
    expect(nah.end!.seconds).toBeLessThan(nah.totalSeconds);

    expect(end.reachesTarget).toBe(true);
    expect(end.finalPopulation).toBe(DIAMOND_POPULATION);
    expect(end.totalSeconds).toBeCloseTo(nah.end!.seconds, 3);
    expect(end.end!.seconds).toBeCloseTo(end.totalSeconds, 3);

    const ops = smartWaitOps(end, state);
    const last = ops[ops.length - 1];
    expect(last.kind === 'action' && last.action.type).toBe('wait_for_population');
    const { end: after, seconds } = played(state, ops);
    expect(after.population).toBeCloseTo(DIAMOND_POPULATION, -2);
    expect(seconds).toBeCloseTo(end.totalSeconds, 0);
  }, 30000);

  test('nothing to do for EnD once the farm has 10B', async () => {
    const plan = await planSmartPopulationWait(farm({ population: 11e9 }), getSimulationContext(), {
      swapBeamWidth: 100,
      research: false,
      target: 'end',
    });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.steps).toEqual([]);
    expect(plan.totalSeconds).toBe(0);
    expect(plan.reachesTarget).toBe(true);
  }, 30000);

  /**
   * Every common research bought but the last few levels of hatchery research and Wormhole
   * Dampening, with epic hatchery research so the habs fill in weeks rather than years.
   */
  const researchFarm = (wormholeDampening: number) => {
    const store = useInitialStateStore();
    // A NAH-sized Soul Egg count: the last Wormhole Dampening levels cost ~1e61.
    store.setSoulEggs(1e33);
    store.setEpicResearchLevel('epic_internal_incubators', 20);
    store.setEpicResearchLevel('int_hatch_calm', 20);
    const levels: Record<string, number> = {};
    for (const r of getCommonResearches()) levels[r.id] = r.levels;
    levels.internal_hatchery4 -= 3;
    levels.internal_hatchery5 -= 5;
    levels.neural_linking -= 5;
    levels.wormhole_dampening = wormholeDampening;
    return {
      ...farm({ researchLevels: levels }),
      artifactSets: { earnings: null, elr: null },
      activeArtifactSet: null,
    };
  };

  test('NAH buys every Wormhole Dampening level and hatchery research that gets there sooner', async () => {
    const state = researchFarm(20);
    const context = getSimulationContext();
    const t0 = performance.now();
    const plan = await planSmartPopulationWait(state, context, { swapBeamWidth: 100, target: 'nah' });
    const elapsedMs = performance.now() - t0;
    const without = await planSmartPopulationWait(state, context, {
      swapBeamWidth: 100,
      research: false,
      target: 'nah',
    });
    if (!plan.ok || !without.ok) throw new Error('no plan');

    const purchases = purchasesOf(plan);
    expect(purchases.some(p => p.kind === 'ihr')).toBe(true);
    expect(purchases.filter(p => p.kind === 'wd')).toHaveLength(25 - 20);
    expect(plan.reachesNah).toBe(true);
    for (const p of purchases) {
      expect(p.items[p.items.length - 1]).toMatchObject({ research: { id: p.researchId }, targetLevel: p.toLevel });
    }
    // Hatchery research gets to EnD sooner on the way.
    expect(plan.end!.seconds).toBeLessThan(without.end!.seconds);

    // Played through the engine, the plan ends at the planned research and population.
    const { end } = played(state, smartWaitOps(plan, state));
    expect(end.researchLevels.wormhole_dampening).toBe(25);
    expect(end.population).toBeCloseTo(plan.finalPopulation, -3);
    expect(elapsedMs).toBeLessThan(15000);
  }, 60000);

  test('EnD buys only the Wormhole Dampening 10B needs', async () => {
    // No gusset owned, so 10B takes Wormhole Dampening.
    const inventory = {
      artifacts: { 'the-chalice-4-3': 1, 'light-of-eggendil-4-3': 1 },
      stones: { 'clarity-stone-4': 3, 'life-stone-4': 3 },
    };
    const state = researchFarm(12);
    const context = getSimulationContext();
    const plan = await planSmartPopulationWait(state, context, { swapBeamWidth: 100, target: 'end', inventory });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.wormholeDampeningGoal).toBeGreaterThan(12);
    expect(plan.wormholeDampeningGoal).toBeLessThan(25);
    expect(purchasesOf(plan).filter(p => p.kind === 'wd')).toHaveLength(plan.wormholeDampeningGoal - 12);
    expect(plan.reachesTarget).toBe(true);
    expect(plan.finalPopulation).toBe(DIAMOND_POPULATION);

    const { end } = played(state, smartWaitOps(plan, state));
    expect(end.researchLevels.wormhole_dampening).toBe(plan.wormholeDampeningGoal);
    expect(end.population).toBeCloseTo(DIAMOND_POPULATION, -3);
  }, 60000);

  test('EnD buys extra Wormhole Dampening when it lets a faster set hold 10B', async () => {
    // From no Wormhole Dampening the Max IHR set holds under 10B, so the fewest levels (none) mean
    // finishing on a slower gusset set; three more let the Max IHR set hold 10B itself.
    const inventory = {
      artifacts: { 'the-chalice-4-3': 1, 'gusset-4-3': 1, 'lunar-totem-4-3': 1 },
      stones: { 'clarity-stone-4': 4, 'life-stone-4': 6 },
    };
    const state = researchFarm(0);
    const context = getSimulationContext();
    const options = { swapBeamWidth: 100, target: 'end' as const, inventory };
    const plan = await planSmartPopulationWait(state, context, options);
    const fewest = await planSmartPopulationWait(state, context, { ...options, wormholeDampeningGoal: 'fewest' });
    if (!plan.ok || !fewest.ok) throw new Error('no plan');

    expect(fewest.wormholeDampeningGoal).toBe(0);
    expect(fewest.steps.length).toBeGreaterThan(1);
    expect(plan.wormholeDampeningGoal).toBeGreaterThan(0);
    expect(plan.steps).toHaveLength(1); // no swap: the Max IHR set holds 10B
    expect(plan.reachesTarget).toBe(true);
    expect(plan.totalSeconds).toBeLessThan(fewest.totalSeconds - 3600);
  }, 60000);

  test('notes the Wormhole Dampening levels a short Diamond needs', async () => {
    // No gusset owned, and low hab research: the habs top out well short of 10B.
    const inventory = {
      artifacts: { 'the-chalice-4-3': 1, 'light-of-eggendil-4-3': 1 },
      stones: { 'clarity-stone-4': 3, 'life-stone-4': 3 },
    };
    const state = farm({
      researchLevels: { internal_hatchery1: 10, internal_hatchery2: 10, internal_hatchery3: 15, wormhole_dampening: 3 },
    });
    const context = getSimulationContext();
    const plan = await planSmartPopulationWait(state, context, {
      inventory,
      swapBeamWidth: 100,
      research: false,
      target: 'end',
    });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.reachesTarget).toBe(false);
    expect(plan.finalPopulation).toBeLessThan(DIAMOND_POPULATION);
    const note = plan.wormholeDampening!;
    expect(note.currentLevel).toBe(3);
    expect(note.allBestHabs).toBe(true);
    expect(note.levelsNeeded).toBeGreaterThan(0);

    // Checked against the engine: every other hab research maxed, WD at the levels named.
    const capAt = (wd: number) =>
      computeSnapshot(
        {
          ...state,
          artifactLoadout: [],
          researchLevels: {
            ...state.researchLevels,
            hab_capacity1: 8,
            microlux: 10,
            grav_plating: 25,
            wormhole_dampening: wd,
          },
        },
        context,
        { freezePopulation: true }
      ).habCapacity;
    expect(capAt(3 + note.levelsNeeded!)).toBeGreaterThanOrEqual(DIAMOND_POPULATION);
    expect(capAt(3 + note.levelsNeeded! - 1)).toBeLessThan(DIAMOND_POPULATION);
  }, 30000);

  test('no note once the final habs hold Diamond; NAH only with every hab research', async () => {
    const plan = await basePlan();
    expect(plan.ok && plan.finalPopulation).toBeGreaterThanOrEqual(DIAMOND_POPULATION);
    expect(plan.ok && plan.wormholeDampening).toBeNull();
    // Wormhole Dampening 10 of 25 and no research bought: full habs, but not NAH.
    expect(plan.ok && plan.reachesNah).toBe(false);

    // All hab research and a T4L gusset with three T4 clarity: the habs' absolute max.
    const maxed = farm();
    maxed.researchLevels = { ...maxed.researchLevels, wormhole_dampening: 25 };
    const nah = await planSmartPopulationWait(maxed, getSimulationContext(), { swapBeamWidth: 100, research: false });
    expect(nah.ok && nah.reachesNah).toBe(true);
    expect(nah.ok && nah.finalPopulation).toBe(nah.ok && nah.nahPopulation);
  }, 30000);

  test('keeps artifacts in their slots, so a swap lists only what changes', () => {
    const slot = (artifactId: string | null, stones: string[] = []) => ({ artifactId, stones });
    const prev = [
      slot('the-chalice-4-3', ['clarity-stone-4', 'clarity-stone-4', 'clarity-stone-4']),
      slot('light-of-eggendil-4-3', ['life-stone-4', 'life-stone-4', 'life-stone-4']),
      slot('lunar-totem-4-3', ['clarity-stone-4', 'life-stone-4', 'life-stone-4']),
      slot('demeters-necklace-4-3', ['clarity-stone-4', 'life-stone-4', 'life-stone-4']),
    ];
    // The search lists the gusset first and shuffles stone order.
    const next = [
      slot('gusset-4-3', ['clarity-stone-4', 'life-stone-4', 'life-stone-4']),
      prev[0],
      prev[1],
      slot('lunar-totem-4-3', ['life-stone-4', 'clarity-stone-4', 'life-stone-4']),
    ];
    const aligned = alignLoadout(prev, next);
    expect(aligned.map(s => s.artifactId)).toEqual([
      'the-chalice-4-3',
      'light-of-eggendil-4-3',
      'lunar-totem-4-3',
      'gusset-4-3',
    ]);
    expect(changedSlotIndexes(prev, aligned)).toEqual([3]);

    // Standard permit: an artifact in a slot that doesn't count isn't matched, and nothing lands there.
    const standard = alignLoadout(
      [slot(null), slot(null), slot('gusset-4-3')],
      [slot('gusset-4-3'), slot('the-chalice-4-3')],
      2
    );
    expect(
      standard
        .slice(0, 2)
        .map(s => s.artifactId)
        .sort()
    ).toEqual(['gusset-4-3', 'the-chalice-4-3']);
  });

  test('every swap after the first changes one or two slots', async () => {
    const plan = await basePlan();
    if (!plan.ok) throw new Error(plan.reason);
    for (const step of plan.steps.slice(1)) expect(step.changedSlots.length).toBeLessThanOrEqual(2);
  }, 30000);

  test('describes a stone swap and an artifact swap', () => {
    const gusset = (stones: string[]) => ({ artifactId: 'gusset-4-3', stones });
    expect(
      describeSlotSwap(
        gusset(['clarity-stone-4', 'life-stone-4', 'life-stone-4']),
        gusset(['clarity-stone-4', 'clarity-stone-4', 'life-stone-4'])
      )
    ).toBe('T4L Gusset: T4 Life stone → T4 Clarity stone');
    expect(describeSlotSwap({ artifactId: 'demeters-necklace-4-3', stones: [] }, gusset([]))).toMatch(
      /^T4L Gusset replaces T4L/
    );
  });

  test('reports when even max Wormhole Dampening falls short', () => {
    const state = farm({ habIds: [18, 18, null, null] });
    const note = wormholeDampeningNeeded(state, getSimulationContext(), []);
    expect(note.levelsNeeded).toBeNull();
    expect(note.allBestHabs).toBe(false);
  });
});
