import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createBaseEngineState, getSimulationContext } from '@/engine/adapter';
import { computeSnapshot } from '@/engine/compute';
import type { EngineState } from '@/engine/types';
import { useInitialStateStore } from '@/stores/initialState';
import { optimizeOfflineEarnings, optimizeIHR } from './optimizeArtifacts';
import type { EquippedArtifact } from './types';

describe('max offline earnings loadout', () => {
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
      population: 1e7,
      ...over,
    };
  }
  const offline = (state: EngineState, loadout: EquippedArtifact[]) =>
    computeSnapshot({ ...state, artifactLoadout: loadout }, getSimulationContext(), { freezePopulation: true });

  test('beats a hand-picked earnings set and matches a much wider search', () => {
    const state = farm();
    const context = getSimulationContext();
    const t0 = performance.now();
    const result = optimizeOfflineEarnings(state, context);
    const elapsed = performance.now() - t0;
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const handPicked: EquippedArtifact[] = [
      { artifactId: 'light-of-eggendil-4-3', stones: ['shell-stone-4', 'shell-stone-4', 'shell-stone-4'] },
      { artifactId: 'lunar-totem-4-3', stones: ['clarity-stone-4', 'clarity-stone-4', 'lunar-stone-4'] },
      { artifactId: 'demeters-necklace-4-3', stones: ['clarity-stone-4', 'clarity-stone-4', 'shell-stone-4'] },
      { artifactId: 'tungsten-ankh-4-3', stones: ['clarity-stone-4', 'clarity-stone-4', 'shell-stone-4'] },
    ];
    expect(result.offlineEarnings).toBeGreaterThanOrEqual(offline(state, handPicked).offlineEarnings);
    expect(offline(state, result.loadout).offlineEarnings).toBeCloseTo(result.offlineEarnings, -1);

    const wide = optimizeOfflineEarnings(state, context, { beamWidth: 8000 });
    expect(wide.ok && wide.offlineEarnings).toBeCloseTo(result.offlineEarnings, -1);
    expect(elapsed).toBeLessThan(3000);
  });

  test('keeps a gusset when the population needs it', () => {
    const base = farm({ population: 0 });
    const cap = computeSnapshot({ ...base, artifactLoadout: [] }, getSimulationContext(), { skipGrowth: true }).habCapacity;
    const state = { ...base, population: cap * 1.2 };
    const result = optimizeOfflineEarnings(state, getSimulationContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loadout.some(s => s.artifactId?.startsWith('gusset'))).toBe(true);
    expect(offline(state, result.loadout).habCapacity).toBeGreaterThanOrEqual(state.population);
  });

  test('fills only two slots on a Standard permit', () => {
    const result = optimizeOfflineEarnings(farm({ proPermit: false }), getSimulationContext());
    expect(result.ok && result.loadout.filter(s => s.artifactId).length).toBe(2);
  });

  test('max IHR puts clarity in the Chalice and earns with the other slots', () => {
    // Enough hatchery research to be clear of the 500/min manual-hatching floor.
    const state = farm({ researchLevels: { internal_hatchery1: 10, internal_hatchery2: 10, internal_hatchery3: 15 } });
    const context = getSimulationContext();
    const result = optimizeIHR(state, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const chalice = result.loadout.find(s => s.artifactId?.startsWith('the-chalice'));
    expect(chalice?.stones).toEqual(['clarity-stone-4', 'clarity-stone-4', 'clarity-stone-4']);
    const noArtifacts = offline(state, []).offlineIHR;
    expect(result.offlineIHR / noArtifacts).toBeGreaterThanOrEqual(2.2 - 1e-9);
    const wide = optimizeIHR(state, context, { beamWidth: 8000 });
    expect(wide.ok && wide.offlineIHR).toBeCloseTo(result.offlineIHR, 3);
    expect(wide.ok && wide.offlineEarnings).toBeCloseTo(result.offlineEarnings, -1);
    // The other slots still earn: well above an IHR-only set.
    expect(result.offlineEarnings).toBeGreaterThan(offline(state, [chalice!]).offlineEarnings * 100);
  });
});
