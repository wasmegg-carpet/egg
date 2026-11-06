import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { calculateArtifactModifiers } from './calculator';
import { defaultResearchCube, researchCubeMultiplier, researchCubeOverride } from './researchCube';
import { researchCostModifiersAt } from '@/engine/researchSale';
import { createBaseEngineState, getSimulationContext } from '@/engine/adapter';
import { computeSnapshot } from '@/engine/compute';
import { useInitialStateStore } from '@/stores/initialState';

const cube = (stones: (string | null)[], artifactId = 'puzzle-cube-4-3') => ({ enabled: true, artifactId, stones });

describe('research puzzle cube', () => {
  test('defaults to on, T4L with three T4 clarity stones', () => {
    expect(defaultResearchCube()).toEqual(cube(['clarity-stone-4', 'clarity-stone-4', 'clarity-stone-4']));
  });

  test("follows Artifact Sandbox: scaled up to 100% clarity, divided past it", () => {
    expect(researchCubeMultiplier(cube(['clarity-stone-4', null, null]))).toBeCloseTo(0.4, 10);
    expect(researchCubeMultiplier(cube(['clarity-stone-3', null, null]))).toBeCloseTo(0.7, 10);
    expect(researchCubeMultiplier(cube(['clarity-stone-4', 'clarity-stone-4', null]))).toBeCloseTo(0.2, 10);
    expect(researchCubeMultiplier(defaultResearchCube())).toBeCloseTo(0.4 / 3, 10);
    expect(researchCubeMultiplier(cube([null, null, null]))).toBe(1);
  });

  test('an equipped cube with lots of clarity never goes negative', () => {
    const mods = calculateArtifactModifiers([
      { artifactId: 'puzzle-cube-4-3', stones: ['clarity-stone-4', 'clarity-stone-4', 'clarity-stone-4'] },
    ]);
    expect(mods.researchCost.totalMultiplier).toBeCloseTo(0.4 / 3, 10);
  });

  test('off means no override', () => {
    expect(researchCubeOverride({ ...defaultResearchCube(), enabled: false })).toBeNull();
  });
});

describe('research pricing with the cube setting', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    setActivePinia(createPinia());
  });

  test('replaces the equipped set when on, and leaves it alone when off', () => {
    const store = useInitialStateStore();
    const snapshot = computeSnapshot(createBaseEngineState(null), getSimulationContext());
    expect(researchCostModifiersAt(snapshot, getSimulationContext()).puzzleCubeMultiplier).toBeCloseTo(0.4 / 3, 10);
    store.setResearchCube({ enabled: false });
    expect(researchCostModifiersAt(snapshot, getSimulationContext()).puzzleCubeMultiplier).toBe(1);
  });
});
