// `sourceTag` is what makes staging a visit twice replace the first attempt instead of stacking a
// second copy on it. It is one optional string on `BaseAction`, and every path a plan takes copies
// actions rather than rebuilding them — but "rather than rebuilding them" is the kind of claim that
// stops being true quietly, and the failure it would cause (a duplicated launch, months into a
// plan) is not one the player would attribute to this. So the paths are exercised.

// The actions store reads localStorage as it is constructed, and the test environment is node.
const noopStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
(globalThis as { localStorage?: Storage }).localStorage ??= noopStorage as unknown as Storage;

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { createBaseEngineState, getSimulationContext } from '@/engine/adapter';
import { simulate } from '@/engine/simulate';
import { exportPlanData, importPlanLogic } from '@/stores/actions/io';
import { createEmptySnapshot } from '@/types';
import type { Action } from '@/types';

const TAG = 'humility-plan:shift_a1b2c3d';

function taggedAction(): Action {
  return {
    id: 'store_tagged',
    index: 0,
    timestamp: 1,
    type: 'store_fuel',
    payload: { egg: 'curiosity', amount: 10, timeSeconds: 0 },
    cost: 0,
    dependsOn: [],
    dependents: [],
    sourceTag: TAG,
  } as unknown as Action;
}

describe('the tag staged actions carry', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('survives simulation, which rebuilds every other field on the action', () => {
    const simulated = simulate([taggedAction()], getSimulationContext(), createBaseEngineState(createEmptySnapshot()));
    expect(simulated[0].sourceTag).toBe(TAG);
  });

  it('survives the file round trip, and so the library round trip, which is the same JSON', () => {
    const exported = exportPlanData([taggedAction()], createEmptySnapshot());
    const imported = importPlanLogic(JSON.stringify(exported));
    // By id, not by position: the import prepends a `start_ascension` when a plan does not open
    // with one, so the tagged action is not where it was put.
    expect(imported.actions.find((a: Action) => a.id === 'store_tagged')?.sourceTag).toBe(TAG);
  });
});
